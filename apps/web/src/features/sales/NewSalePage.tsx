import {
  PAYMENT_METHOD_LABELS,
  Permission,
  type CustomerDto,
  type Paginated,
  type PaymentMethod,
  type ProductDto,
  type ProductLookupDto,
  type SaleDetailDto,
  type ServiceDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Minus,
  MoreHorizontal,
  PackagePlus,
  PackageSearch,
  Plus,
  QrCode,
  Scissors,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarcodeScannerInput,
  type BarcodeScannerInputHandle,
  type ScanFeedbackState,
} from '@/components/barcode/BarcodeScannerInput';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Badge, Card } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ProductFormDrawer } from '@/features/inventory/ProductFormDrawer';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseDecimal } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';
import { CustomerPetSelect } from './CustomerPetSelect';

/**
 * Nova venda = CAIXA (PDV).
 *
 * Fluxo: bipa -> o produto entra no carrinho (bipar de novo soma na mesma
 * linha) -> escolhe a forma de pagamento -> finaliza. A venda, os itens, o
 * pagamento e a baixa de estoque acontecem numa unica transacao no servidor
 * (POST /sales): ou tudo e gravado, ou nada. Estoque insuficiente e avisado
 * aqui antes, e o servidor recusa de qualquer forma.
 */

interface CartItem {
  key: string;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Saldo do produto quando entrou no carrinho (null = nao controla estoque). */
  stock: number | null;
  unit: string;
}

type Tender = 'CASH' | 'PIX' | 'CARD' | 'OTHER';
type CardKind = 'DEBIT_CARD' | 'CREDIT_CARD';

const TENDERS: { value: Tender; label: string; icon: LucideIcon }[] = [
  { value: 'CASH', label: 'Dinheiro', icon: Banknote },
  { value: 'PIX', label: 'Pix', icon: QrCode },
  { value: 'CARD', label: 'Cartão', icon: CreditCard },
  { value: 'OTHER', label: 'Outro', icon: MoreHorizontal },
];

let keyCounter = 0;
const nextKey = () => `item-${(keyCounter += 1)}`;
const toInput = (value: number) => String(value).replace('.', ',');

function draftKey(tenantId: string): string {
  return `petflow:pdv-draft:${tenantId}`;
}

function loadDraft(tenantId: string): CartItem[] {
  try {
    const raw = sessionStorage.getItem(draftKey(tenantId));
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

interface Completed {
  sale: SaleDetailDto;
  methodLabel: string;
  units: number;
}

export function NewSalePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useCurrentSession();
  const { can } = useSession();
  const scanRef = useRef<BarcodeScannerInputHandle>(null);
  const tenantId = session.tenant.id;

  const [items, setItemsState] = useState<CartItem[]>(() => loadDraft(tenantId));
  // Espelho sincrono do carrinho: dois bipes em sequencia rapida precisam ver
  // a quantidade ja somada pelo anterior (senao virariam duas linhas).
  const itemsRef = useRef(items);
  const setItems = useCallback((next: CartItem[] | ((current: CartItem[]) => CartItem[])) => {
    const value = typeof next === 'function' ? next(itemsRef.current) : next;
    itemsRef.current = value;
    setItemsState(value);
  }, []);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ScanFeedbackState>({ kind: 'idle', at: 0 });
  const [pending, setPending] = useState(0);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showServices, setShowServices] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [petId, setPetId] = useState('');
  const [discount, setDiscount] = useState('');
  const [tender, setTender] = useState<Tender>('PIX');
  const [cardKind, setCardKind] = useState<CardKind>('DEBIT_CARD');
  const [paidNow, setPaidNow] = useState<'paid' | 'open'>('paid');
  const [formError, setFormError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);

  // Carrinho sobrevive a um recarregamento acidental da pagina.
  useEffect(() => {
    try {
      if (items.length > 0) sessionStorage.setItem(draftKey(tenantId), JSON.stringify(items));
      else sessionStorage.removeItem(draftKey(tenantId));
    } catch {
      // Sem storage: o carrinho so vive nesta tela.
    }
  }, [items, tenantId]);

  const productsQuery = useQuery({
    queryKey: ['products', 'pos-search', search],
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { search, active: 'true', pageSize: 8 }),
    enabled: can(Permission.PRODUCTS_READ) && search.trim().length >= 2,
  });
  const servicesQuery = useQuery({
    queryKey: ['services', 'pos'],
    queryFn: () => api.get<Paginated<ServiceDto>>('/services', { active: 'true', pageSize: 50 }),
    enabled: showServices,
  });

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let units = 0;
    let invalid = false;
    for (const item of items) {
      const quantity = parseDecimal(item.quantity);
      const price = parseDecimal(item.unitPrice);
      if (!(quantity > 0) || !(price >= 0)) {
        invalid = true;
        continue;
      }
      units += quantity;
      subtotalCents += Math.round(quantity * Math.round(price * 100));
    }
    const discountValue = discount.trim() ? parseDecimal(discount) : 0;
    const discountCents = Number.isFinite(discountValue) ? Math.round(discountValue * 100) : Number.NaN;
    const validDiscount = Number.isFinite(discountCents) && discountCents >= 0 && discountCents <= subtotalCents;
    return {
      subtotal: subtotalCents / 100,
      discount: validDiscount ? discountCents / 100 : 0,
      total: (subtotalCents - (validDiscount ? discountCents : 0)) / 100,
      units,
      invalid: invalid || !validDiscount,
      overStock: items.some((item) => item.stock !== null && parseDecimal(item.quantity) > item.stock),
    };
  }, [items, discount]);

  const focusScanner = useCallback(() => scanRef.current?.focus(), []);

  function addProduct(product: ProductDto): boolean {
    setUnknownCode(null);
    if (!product.active) {
      toast.error(`"${product.name}" está inativo.`);
      setFeedback({ kind: 'error', at: Date.now() });
      return false;
    }
    const existing = itemsRef.current.find((item) => item.productId === product.id);
    const nextQuantity = (existing ? parseDecimal(existing.quantity) || 0 : 0) + 1;
    if (product.trackStock && nextQuantity > product.stockQuantity) {
      toast.error(`Estoque insuficiente. "${product.name}" tem ${formatQuantity(product.stockQuantity)} em estoque.`);
      setFeedback({ kind: 'error', at: Date.now() });
      return false;
    }
    setFeedback({ kind: 'found', at: Date.now() });
    if (existing) {
      setItems((current) =>
        current.map((item) =>
          item.key === existing.key ? { ...item, quantity: toInput(nextQuantity), stock: product.trackStock ? product.stockQuantity : null } : item,
        ),
      );
      setLastKey(existing.key);
    } else {
      const key = nextKey();
      setItems((current) => [
        ...current,
        {
          key,
          productId: product.id,
          serviceId: null,
          description: product.name,
          quantity: '1',
          unitPrice: toInput(product.salePrice),
          stock: product.trackStock ? product.stockQuantity : null,
          unit: product.unit,
        },
      ]);
      setLastKey(key);
    }
    return true;
  }

  async function handleScan(code: string): Promise<void> {
    setFormError(null);
    setPending((value) => value + 1);
    try {
      const result = await api.get<ProductLookupDto>('/products/lookup', { code });
      if (result.status === 'FOUND') addProduct(result.product);
      else {
        setUnknownCode(result.code);
        setFeedback({ kind: 'not-found', at: Date.now() });
      }
    } catch (error) {
      setFeedback({ kind: 'error', at: Date.now() });
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível buscar o código.');
    } finally {
      setPending((value) => value - 1);
      focusScanner();
    }
  }

  function addService(service: ServiceDto): void {
    const key = nextKey();
    setItems((current) => [
      ...current,
      { key, productId: null, serviceId: service.id, description: service.name, quantity: '1', unitPrice: toInput(service.price), stock: null, unit: 'UN' },
    ]);
    setLastKey(key);
    setShowServices(false);
    focusScanner();
  }

  function addFreeItem(): void {
    const key = nextKey();
    setItems((current) => [...current, { key, productId: null, serviceId: null, description: '', quantity: '1', unitPrice: '', stock: null, unit: 'UN' }]);
    setLastKey(key);
  }

  function updateItem(key: string, patch: Partial<CartItem>): void {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function stepQuantity(item: CartItem, delta: number): void {
    const next = Math.max(1, (parseDecimal(item.quantity) || 1) + delta);
    if (delta > 0 && item.stock !== null && next > item.stock) {
      toast.error(`Estoque insuficiente. "${item.description}" tem ${formatQuantity(item.stock)} em estoque.`);
      return;
    }
    updateItem(item.key, { quantity: toInput(next) });
  }

  const method: PaymentMethod = tender === 'CARD' ? cardKind : tender;

  const finalize = useMutation({
    mutationFn: () =>
      api.post<SaleDetailDto>('/sales', {
        customerId: customer?.id ?? null,
        petId: petId || null,
        items: items.map((item) => ({
          productId: item.productId,
          serviceId: item.serviceId,
          description: item.description.trim() || null,
          quantity: parseDecimal(item.quantity),
          unitPrice: parseDecimal(item.unitPrice),
        })),
        discount: totals.discount,
        payment: { method, paid: paidNow === 'paid' },
      }),
    onSuccess: async (sale) => {
      setCompleted({ sale, methodLabel: PAYMENT_METHOD_LABELS[method], units: totals.units });
      setItems([]);
      setDiscount('');
      setCustomer(null);
      setPetId('');
      setShowCustomer(false);
      setUnknownCode(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.message : 'Não foi possível registrar a venda.');
      focusScanner();
    },
  });

  function submit(): void {
    setFormError(null);
    if (items.length === 0) return setFormError('Bipe ou adicione ao menos um item.');
    if (items.some((item) => !item.productId && !item.serviceId && !item.description.trim())) {
      return setFormError('Dê um nome a todos os itens avulsos.');
    }
    if (totals.overStock) return setFormError('Estoque insuficiente. Ajuste as quantidades marcadas.');
    if (totals.invalid) return setFormError('Confira quantidades, valores e desconto.');
    finalize.mutate();
  }

  function newSale(): void {
    setCompleted(null);
    setFormError(null);
    setTimeout(focusScanner, 0);
  }

  // Atalho de caixa: F2 finaliza.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'F2' && !completed) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const productResults = productsQuery.data?.data ?? [];

  if (completed) {
    const { sale } = completed;
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center">
        <CheckCircle2 aria-hidden className="size-14 text-[var(--color-success)]" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Venda concluída.</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Venda #{sale.number} · {sale.status === 'PAID' ? 'recebida' : 'a receber'}
        </p>
        <Card className="mt-6 w-full p-5 text-left">
          <dl className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Total</dt>
              <dd className="tabular text-3xl font-semibold tracking-tight">{formatMoney(sale.total)}</dd>
            </div>
            <div>
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Forma de pagamento</dt>
              <dd className="text-sm font-medium">{completed.methodLabel}</dd>
            </div>
            <div>
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Itens</dt>
              <dd className="text-sm font-medium">
                {formatQuantity(completed.units)} {completed.units === 1 ? 'unidade' : 'unidades'} · {sale.items.length}{' '}
                {sale.items.length === 1 ? 'produto' : 'produtos'}
              </dd>
            </div>
          </dl>
        </Card>
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
          <Button size="lg" className="flex-1" autoFocus onClick={newSale} icon={<Plus className="size-4" />}>
            Nova venda
          </Button>
          <Link
            to={`/vendas/${sale.id}`}
            className="flex h-12 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-strong)] text-sm font-medium hover:bg-[var(--color-surface-hover)]"
          >
            Ver venda #{sale.number}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28 lg:pb-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/vendas"
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft aria-hidden className="size-4" /> Vendas
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Caixa</h1>
        </div>
        <p className="hidden text-[0.75rem] text-[var(--color-text-subtle)] lg:block">
          <kbd className="rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-mono">F2</kbd> finaliza a venda
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ============ LEITOR + CARRINHO ============ */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <BarcodeScannerInput
              ref={scanRef}
              label="Bipe o produto"
              onScan={(code) => void handleScan(code)}
              busy={pending > 0}
              feedback={feedback}
            />
            {unknownCode ? (
              <div role="alert" className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-subtle)] p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <PackageSearch aria-hidden className="size-4 text-[var(--color-warning)]" />
                  Produto não encontrado.
                </p>
                <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                  Código <strong className="tabular text-[var(--color-text)]">{unknownCode}</strong> não está no seu catálogo. Nada foi
                  adicionado ao carrinho.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {can(Permission.PRODUCTS_WRITE) ? (
                    <Button size="sm" icon={<PackagePlus className="size-4" />} onClick={() => setRegistering(unknownCode)}>
                      Cadastrar produto
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setUnknownCode(null);
                      focusScanner();
                    }}
                  >
                    Digitar código novamente
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
              {can(Permission.PRODUCTS_READ) ? (
                <div className="relative min-w-0 flex-1">
                  <SearchInput value={search} onChange={setSearch} placeholder="Sem código? Busque pelo nome" label="Buscar produto pelo nome" />
                  {search.trim().length >= 2 ? (
                    <ul
                      className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]"
                      aria-label="Produtos encontrados"
                    >
                      {productsQuery.isLoading ? (
                        <li className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Buscando…</li>
                      ) : productResults.length === 0 ? (
                        <li className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Nenhum produto ativo encontrado.</li>
                      ) : (
                        productResults.map((product) => (
                          <li key={product.id} className="border-t border-[var(--color-border)] first:border-t-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (addProduct(product)) setSearch('');
                                focusScanner();
                              }}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)]"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{product.name}</span>
                                <span className="block text-[0.75rem] text-[var(--color-text-muted)]">
                                  {product.trackStock ? `Estoque ${formatQuantity(product.stockQuantity)}` : 'Sem controle de estoque'}
                                </span>
                              </span>
                              <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(product.salePrice)}</span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" icon={<Scissors className="size-4" />} onClick={() => setShowServices((value) => !value)}>
                  Serviço
                </Button>
                <Button variant="secondary" icon={<Plus className="size-4" />} onClick={addFreeItem}>
                  Avulso
                </Button>
              </div>
            </div>
            {showServices ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Serviços">
                {(servicesQuery.data?.data ?? []).map((service) => (
                  <li key={service.id}>
                    <button
                      type="button"
                      onClick={() => addService(service)}
                      className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5 text-left hover:border-[var(--color-brand-border)] hover:bg-[var(--color-brand-subtle)]"
                    >
                      <span className="truncate text-sm font-medium">{service.name}</span>
                      <span className="tabular shrink-0 text-sm">{formatMoney(service.price)}</span>
                    </button>
                  </li>
                ))}
                {servicesQuery.data && servicesQuery.data.data.length === 0 ? (
                  <li className="text-sm text-[var(--color-text-muted)]">Nenhum serviço ativo.</li>
                ) : null}
              </ul>
            ) : null}
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                <ShoppingCart aria-hidden className="size-4" /> Carrinho
              </h2>
              {items.length > 0 ? (
                <button type="button" onClick={() => setItems([])} className="text-[0.8125rem] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                  Esvaziar
                </button>
              ) : null}
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">Bipe o primeiro produto para começar.</p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_6.5rem_2.25rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-2 text-[0.75rem] font-medium text-[var(--color-text-muted)] md:grid">
                  <span>Produto</span>
                  <span className="text-center">Qtd.</span>
                  <span className="text-right">Preço un.</span>
                  <span className="text-right">Subtotal</span>
                  <span />
                </div>
                <ul className="divide-y divide-[var(--color-border)]" aria-label="Itens da venda">
                  {items.map((item) => {
                    const quantity = parseDecimal(item.quantity);
                    const price = parseDecimal(item.unitPrice);
                    const lineTotal = quantity > 0 && price >= 0 ? Math.round(quantity * Math.round(price * 100)) / 100 : null;
                    const overStock = item.stock !== null && quantity > item.stock;
                    const free = !item.productId && !item.serviceId;
                    return (
                      <li
                        key={item.key}
                        className={cn(
                          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_6.5rem_2.25rem]',
                          item.key === lastKey && 'bg-[var(--color-brand-subtle)]/60',
                        )}
                      >
                        <div className="col-span-2 min-w-0 md:col-span-1">
                          {free ? (
                            <input
                              value={item.description}
                              onChange={(event) => updateItem(item.key, { description: event.target.value })}
                              placeholder="Descrição do item avulso"
                              aria-label="Descrição do item avulso"
                              maxLength={160}
                              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
                            />
                          ) : (
                            <p className="truncate text-sm font-semibold">{item.description}</p>
                          )}
                          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                            {item.serviceId ? 'Serviço' : item.stock !== null ? `Em estoque: ${formatQuantity(item.stock)}` : free ? 'Item avulso' : 'Produto'}
                          </p>
                          {overStock ? (
                            <Badge tone="danger" className="mt-1">
                              Estoque insuficiente
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex h-9 items-center justify-self-start rounded-[var(--radius-md)] border border-[var(--color-border-strong)] md:justify-self-center">
                          <button
                            type="button"
                            aria-label={`Diminuir ${item.description || 'item'}`}
                            onClick={() => stepQuantity(item, -1)}
                            className="flex size-9 items-center justify-center text-[var(--color-text-muted)]"
                          >
                            <Minus aria-hidden className="size-3.5" />
                          </button>
                          <input
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                            inputMode="decimal"
                            aria-label={`Quantidade de ${item.description || 'item'}`}
                            className="tabular h-full w-12 border-x border-[var(--color-border)] bg-transparent text-center text-base font-semibold focus-visible:outline-none sm:text-sm"
                          />
                          <button
                            type="button"
                            aria-label={`Aumentar ${item.description || 'item'}`}
                            onClick={() => stepQuantity(item, 1)}
                            className="flex size-9 items-center justify-center text-[var(--color-text-muted)]"
                          >
                            <Plus aria-hidden className="size-3.5" />
                          </button>
                        </div>
                        <input
                          value={item.unitPrice}
                          onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          inputMode="decimal"
                          placeholder="0,00"
                          aria-label={`Preço unitário de ${item.description || 'item'}`}
                          className="tabular h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-right text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
                        />
                        <span className="tabular text-right text-sm font-semibold">{lineTotal === null ? '--' : formatMoney(lineTotal)}</span>
                        <button
                          type="button"
                          onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                          aria-label={`Remover ${item.description || 'item'}`}
                          className="flex size-9 items-center justify-center justify-self-end rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger)]"
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>
        </div>

        {/* ============ TOTAL + PAGAMENTO ============ */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card tone="ink" className="p-5">
            <p className="eyebrow text-[var(--color-ink-muted)]">Total</p>
            <p className="tabular mt-1 text-4xl font-semibold tracking-tight" aria-live="polite">
              {formatMoney(Math.max(0, totals.total))}
            </p>
            <p className="mt-1 text-[0.8125rem] text-[var(--color-ink-muted)]">
              {formatQuantity(totals.units)} {totals.units === 1 ? 'unidade' : 'unidades'} · subtotal {formatMoney(totals.subtotal)}
              {totals.discount > 0 ? ` · desconto ${formatMoney(totals.discount)}` : ''}
            </p>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-[0.8125rem] font-medium">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
              {TENDERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={tender === option.value}
                  onClick={() => setTender(option.value)}
                  className={cn(
                    'flex h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border text-sm font-semibold transition-colors',
                    tender === option.value
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-text-inverse)]'
                      : 'border-[var(--color-border-strong)] hover:border-[var(--color-brand-border)]',
                  )}
                >
                  <option.icon aria-hidden className="size-4" />
                  {option.label}
                </button>
              ))}
            </div>
            {tender === 'CARD' ? (
              <SegmentedControl<CardKind>
                label="Tipo de cartão"
                size="sm"
                className="mt-2 w-full"
                value={cardKind}
                onChange={setCardKind}
                options={[
                  { value: 'DEBIT_CARD', label: 'Débito' },
                  { value: 'CREDIT_CARD', label: 'Crédito' },
                ]}
              />
            ) : null}

            <SegmentedControl
              label="Situação do pagamento"
              className="mt-3 w-full"
              size="sm"
              value={paidNow}
              onChange={setPaidNow}
              options={[
                { value: 'paid', label: 'Recebido agora' },
                { value: 'open', label: 'A receber' },
              ]}
            />

            <label className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[0.8125rem] text-[var(--color-text-muted)]">Desconto (R$)</span>
              <input
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="tabular h-9 w-28 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-right text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
              />
            </label>

            {showCustomer ? (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[0.8125rem] font-medium">Cliente</p>
                  <button
                    type="button"
                    aria-label="Remover cliente"
                    onClick={() => {
                      setShowCustomer(false);
                      setCustomer(null);
                      setPetId('');
                    }}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
                <CustomerPetSelect customer={customer} petId={petId} onCustomerChange={setCustomer} onPetChange={setPetId} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomer(true)}
                className="mt-3 flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
              >
                <UserPlus aria-hidden className="size-3.5" /> Identificar cliente (opcional)
              </button>
            )}

            {formError ? (
              <p role="alert" className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[var(--color-danger)]">
                {formError}
              </p>
            ) : null}

            <Button size="lg" className="mt-4 hidden h-14 w-full text-base lg:inline-flex" loading={finalize.isPending} onClick={submit}>
              Finalizar venda
            </Button>
          </Card>
        </div>
      </div>

      {/* Mobile: total e finalizar sempre visiveis */}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom))] z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div>
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">
              Total · {formatQuantity(totals.units)} {totals.units === 1 ? 'un.' : 'un.'}
            </p>
            <p className="tabular text-xl font-semibold">{formatMoney(Math.max(0, totals.total))}</p>
          </div>
          <Button size="lg" loading={finalize.isPending} onClick={submit}>
            Finalizar venda
          </Button>
        </div>
      </div>

      {registering ? (
        <ProductFormDrawer
          open
          scannedCode={registering}
          onClose={() => {
            setRegistering(null);
            focusScanner();
          }}
          onSaved={(product) => {
            setUnknownCode(null);
            addProduct(product);
          }}
        />
      ) : null}
    </div>
  );
}
