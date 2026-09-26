import {
  PAYMENT_METHOD_LABELS,
  Permission,
  type CustomerDto,
  type Paginated,
  type PaymentMethod,
  type ProductDto,
  type SaleDetailDto,
  type ServiceDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, PackageSearch, Plus, Scissors, ShoppingBag, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatQuantity } from '@/lib/format';
import { parseDecimal } from '@/lib/decimal';
import { CustomerPetSelect } from './CustomerPetSelect';

interface DraftItem {
  key: string;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Saldo do produto no momento em que foi adicionado (so aviso visual). */
  stockHint: number | null;
  unit: string;
}

const METHODS: PaymentMethod[] = ['PIX', 'CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'];

let keyCounter = 0;
const nextKey = () => {
  keyCounter += 1;
  return `item-${keyCounter}`;
};

function formatDecimalInput(value: number): string {
  return String(value).replace('.', ',');
}

export function NewSalePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const [items, setItems] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [petId, setPetId] = useState('');
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [paidNow, setPaidNow] = useState<'paid' | 'open'>('paid');
  const [notes, setNotes] = useState('');
  const [showServices, setShowServices] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['products', 'pos-search', search],
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { search, active: 'true', pageSize: 8 }),
    enabled: can(Permission.PRODUCTS_READ) && search.trim().length >= 1,
  });

  const servicesQuery = useQuery({
    queryKey: ['services', 'pos'],
    queryFn: () => api.get<Paginated<ServiceDto>>('/services', { active: 'true', pageSize: 50 }),
    enabled: showServices,
  });

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let invalid = false;
    for (const item of items) {
      const quantity = parseDecimal(item.quantity);
      const price = parseDecimal(item.unitPrice);
      if (!(quantity > 0) || !(price >= 0)) {
        invalid = true;
        continue;
      }
      subtotalCents += Math.round(quantity * Math.round(price * 100));
    }
    const discountValue = discount.trim() ? parseDecimal(discount) : 0;
    const discountCents = Number.isFinite(discountValue) ? Math.round(discountValue * 100) : Number.NaN;
    return {
      subtotal: subtotalCents / 100,
      discount: Number.isFinite(discountCents) ? discountCents / 100 : 0,
      total: (subtotalCents - (Number.isFinite(discountCents) ? discountCents : 0)) / 100,
      invalid: invalid || !Number.isFinite(discountCents) || discountCents < 0 || discountCents > subtotalCents,
    };
  }, [items, discount]);

  function addProduct(product: ProductDto): void {
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: formatDecimalInput((parseDecimal(item.quantity) || 0) + 1) }
            : item,
        );
      }
      return [
        ...current,
        {
          key: nextKey(),
          productId: product.id,
          serviceId: null,
          description: product.name,
          quantity: '1',
          unitPrice: formatDecimalInput(product.salePrice),
          stockHint: product.trackStock ? product.stockQuantity : null,
          unit: product.unit,
        },
      ];
    });
    setSearch('');
  }

  function addService(service: ServiceDto): void {
    setItems((current) => [
      ...current,
      {
        key: nextKey(),
        productId: null,
        serviceId: service.id,
        description: service.name,
        quantity: '1',
        unitPrice: formatDecimalInput(service.price),
        stockHint: null,
        unit: 'UN',
      },
    ]);
    setShowServices(false);
  }

  function addFreeItem(): void {
    setItems((current) => [
      ...current,
      { key: nextKey(), productId: null, serviceId: null, description: '', quantity: '1', unitPrice: '', stockHint: null, unit: 'UN' },
    ]);
  }

  function updateItem(key: string, patch: Partial<DraftItem>): void {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  const mutation = useMutation({
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
        notes: notes.trim() || null,
        payment: { method, paid: paidNow === 'paid' },
      }),
    onSuccess: async (sale) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
      toast.success(`Venda #${sale.number} registrada${sale.status === 'PAID' ? ' e recebida.' : ' como a receber.'}`);
      navigate(`/vendas/${sale.id}`, { replace: true });
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.message : 'Não foi possível registrar a venda.');
    },
  });

  function submit(): void {
    setFormError(null);
    if (items.length === 0) {
      setFormError('Adicione ao menos um item.');
      return;
    }
    if (items.some((item) => !item.productId && !item.serviceId && !item.description.trim())) {
      setFormError('Dê um nome a todos os itens avulsos.');
      return;
    }
    if (totals.invalid) {
      setFormError('Confira quantidades, valores e desconto.');
      return;
    }
    mutation.mutate();
  }

  const productResults = productsQuery.data?.data ?? [];

  return (
    <div className="pb-24 lg:pb-0">
      <Link
        to="/vendas"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft aria-hidden className="size-4" /> Vendas
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Nova venda</h1>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ============ ITENS ============ */}
        <Card className="min-w-0">
          <CardHeader title="Itens" icon={<ShoppingBag className="size-4" />} />
          <div className="border-b border-[var(--color-border)] p-4">
            {can(Permission.PRODUCTS_READ) ? (
              <div className="relative">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar produto por nome, SKU ou código de barras"
                  label="Buscar produto"
                />
                {search.trim() ? (
                  <ul
                    className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
                    aria-label="Produtos encontrados"
                  >
                    {productsQuery.isLoading ? (
                      <li className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Buscando...</li>
                    ) : productResults.length === 0 ? (
                      <li className="px-4 py-3 text-sm text-[var(--color-text-muted)]">Nenhum produto ativo encontrado.</li>
                    ) : (
                      productResults.map((product) => (
                        <li key={product.id} className="border-t border-[var(--color-border)] first:border-t-0">
                          <button
                            type="button"
                            onClick={() => addProduct(product)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{product.name}</span>
                              <span className="block text-[0.75rem] text-[var(--color-text-muted)]">
                                {product.sku ? `${product.sku} · ` : ''}
                                {product.trackStock ? `Saldo ${formatQuantity(product.stockQuantity)}` : 'Sem controle de estoque'}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<Scissors className="size-4" />} onClick={() => setShowServices((value) => !value)}>
                Serviço
              </Button>
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={addFreeItem}>
                Item avulso
              </Button>
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
          </div>

          {items.length === 0 ? (
            <EmptyState
              compact
              icon={<PackageSearch className="size-5" />}
              title="Nenhum item ainda"
              description="Busque um produto, escolha um serviço ou adicione um item avulso."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((item) => {
                const quantity = parseDecimal(item.quantity);
                const price = parseDecimal(item.unitPrice);
                const lineTotal = quantity > 0 && price >= 0 ? Math.round(quantity * Math.round(price * 100)) / 100 : null;
                const overStock = item.stockHint !== null && quantity > item.stockHint;
                const free = !item.productId && !item.serviceId;
                return (
                  <li key={item.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      {free ? (
                        <label className="block">
                          <span className="text-[0.75rem] text-[var(--color-text-muted)]">Descrição</span>
                          <input
                            value={item.description}
                            onChange={(event) => updateItem(item.key, { description: event.target.value })}
                            placeholder="Ex.: Taxa de entrega"
                            maxLength={160}
                            className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
                          />
                        </label>
                      ) : (
                        <>
                          <p className="truncate text-sm font-semibold">{item.description}</p>
                          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                            {item.serviceId ? 'Serviço' : item.stockHint !== null ? `Saldo atual: ${formatQuantity(item.stockHint)}` : 'Produto'}
                          </p>
                        </>
                      )}
                      {overStock ? (
                        <Badge tone="warning" className="mt-1.5">
                          Acima do saldo em estoque
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-end gap-2">
                      <div>
                        <span className="text-[0.75rem] text-[var(--color-text-muted)]">Qtd.</span>
                        <div className="mt-1 flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border-strong)]">
                          <button
                            type="button"
                            aria-label={`Diminuir quantidade de ${item.description || 'item'}`}
                            onClick={() => updateItem(item.key, { quantity: formatDecimalInput(Math.max(1, (parseDecimal(item.quantity) || 1) - 1)) })}
                            className="flex size-10 items-center justify-center text-[var(--color-text-muted)]"
                          >
                            <Minus aria-hidden className="size-3.5" />
                          </button>
                          <input
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                            inputMode="decimal"
                            aria-label={`Quantidade de ${item.description || 'item'}`}
                            className="tabular h-full w-14 border-x border-[var(--color-border)] text-center text-base focus-visible:outline-none sm:text-sm"
                          />
                          <button
                            type="button"
                            aria-label={`Aumentar quantidade de ${item.description || 'item'}`}
                            onClick={() => updateItem(item.key, { quantity: formatDecimalInput((parseDecimal(item.quantity) || 0) + 1) })}
                            className="flex size-10 items-center justify-center text-[var(--color-text-muted)]"
                          >
                            <Plus aria-hidden className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <label>
                        <span className="text-[0.75rem] text-[var(--color-text-muted)]">Valor unit.</span>
                        <input
                          value={item.unitPrice}
                          onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="tabular mt-1 h-10 w-24 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 text-right text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
                        />
                      </label>
                      <div className="w-24 pb-2.5 text-right">
                        <span className="tabular text-sm font-semibold">{lineTotal === null ? '--' : formatMoney(lineTotal)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                        aria-label={`Remover ${item.description || 'item'}`}
                        className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger)]"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ============ CLIENTE + PAGAMENTO ============ */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24">
          <Card className="p-4">
            <h2 className="mb-3 text-[0.9375rem] font-semibold">Cliente</h2>
            <CustomerPetSelect customer={customer} petId={petId} onCustomerChange={setCustomer} onPetChange={setPetId} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-[0.9375rem] font-semibold">Pagamento</h2>
            <p className="mb-2 text-[0.75rem] text-[var(--color-text-muted)]">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
              {METHODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={method === option}
                  onClick={() => setMethod(option)}
                  className={cn(
                    'h-11 rounded-[var(--radius-md)] border px-3 text-sm font-medium transition-colors',
                    method === option
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-ink-text)]'
                      : 'border-[var(--color-border-strong)] hover:border-[var(--color-text-subtle)]',
                    option === 'OTHER' && 'col-span-2',
                  )}
                >
                  {PAYMENT_METHOD_LABELS[option]}
                </button>
              ))}
            </div>

            <p className="mt-4 mb-2 text-[0.75rem] text-[var(--color-text-muted)]">Situação</p>
            <SegmentedControl
              label="Situação do pagamento"
              value={paidNow}
              onChange={setPaidNow}
              className="w-full"
              options={[
                { value: 'paid', label: 'Recebido agora' },
                { value: 'open', label: 'A receber' },
              ]}
            />

            <label className="mt-4 block">
              <span className="text-[0.75rem] text-[var(--color-text-muted)]">Desconto (R$)</span>
              <input
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="tabular mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-[0.75rem] text-[var(--color-text-muted)]">Observações</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
                className="mt-1 min-h-16 w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 py-2 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:text-sm"
              />
            </label>

            <dl className="mt-4 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Subtotal</dt>
                <dd className="tabular">{formatMoney(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Desconto</dt>
                <dd className="tabular">− {formatMoney(totals.discount)}</dd>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <dt className="font-semibold">Total</dt>
                <dd className="tabular text-2xl font-semibold tracking-tight">{formatMoney(Math.max(0, totals.total))}</dd>
              </div>
            </dl>

            {formError ? (
              <p role="alert" className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[var(--color-danger)]">
                {formError}
              </p>
            ) : null}

            <Button size="lg" className="mt-4 hidden w-full lg:inline-flex" loading={mutation.isPending} onClick={submit}>
              Registrar venda
            </Button>
          </Card>
        </div>
      </div>

      {/* Barra fixa no mobile: total sempre visivel e botao ao alcance do polegar */}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom))] z-20 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div>
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">
              Total · {items.length} {items.length === 1 ? 'item' : 'itens'}
            </p>
            <p className="tabular text-lg font-semibold">{formatMoney(Math.max(0, totals.total))}</p>
          </div>
          <Button size="lg" loading={mutation.isPending} onClick={submit}>
            Registrar venda
          </Button>
        </div>
      </div>
    </div>
  );
}
