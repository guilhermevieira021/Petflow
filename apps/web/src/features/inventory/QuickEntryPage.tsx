import {
  Permission,
  STOCK_EXIT_REASON_LABELS,
  type Paginated,
  type ProductDto,
  type ProductLookupDto,
  type StockEntryResultDto,
  type StockExitReason,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Minus, PackagePlus, PackageSearch, Plus, ScanBarcode, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarcodeScannerInput,
  type BarcodeScannerInputHandle,
  type ScanFeedbackState,
} from '@/components/barcode/BarcodeScannerInput';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseDecimal } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';
import { ProductFormDrawer } from './ProductFormDrawer';
import { StockNav } from './StockNav';

type Mode = 'entrada' | 'saida';
type EntryType = 'IN' | 'RETURN' | 'OUT';

interface Line {
  product: ProductDto;
  quantity: number;
  /** Custo unitario desta compra (entrada), como digitado. */
  unitCost?: string;
  scannedCode: string | null;
  /** Para destacar a ultima linha bipada. */
  touchedAt: number;
}

const COPY: Record<Mode, { title: string; description: string; confirm: string; done: string }> = {
  entrada: {
    title: 'Entrada rápida',
    description: 'Bipe os produtos recebidos. Cada leitura soma 1; confira a lista e confirme tudo de uma vez.',
    confirm: 'Adicionar ao estoque',
    done: 'Entrada registrada',
  },
  saida: {
    title: 'Saída de estoque',
    description: 'Perda, avaria, ajuste ou outro motivo. Vendas feitas no caixa baixam o estoque sozinhas.',
    confirm: 'Registrar saída',
    done: 'Saída registrada',
  },
};

function draftKey(tenantId: string, mode: Mode): string {
  return `petflow:stock-draft:${tenantId}:${mode}`;
}

function loadDraft(key: string): Line[] {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Line[]) : [];
  } catch {
    return [];
  }
}

const EXIT_REASON_ORDER: StockExitReason[] = ['SALE', 'LOSS', 'DAMAGE', 'ADJUSTMENT', 'OTHER'];

const percent = (fraction: number) => `${(fraction * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function costText(value: number | null): string {
  return value == null ? '' : value.toFixed(2).replace('.', ',');
}

function ProductFacts({ product }: { product: ProductDto }) {
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem] text-[var(--color-text-muted)]">
      {product.brandName ? <dd>{product.brandName}</dd> : null}
      {product.category ? <dd>{product.category}</dd> : null}
      {product.sku ? <dd className="tabular">SKU {product.sku}</dd> : null}
      {product.barcode ? <dd className="tabular">{product.barcode}</dd> : null}
    </dl>
  );
}

export function QuickEntryPage({ mode }: { mode: Mode }) {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const scanRef = useRef<BarcodeScannerInputHandle>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedback, setFeedback] = useState<ScanFeedbackState>({ kind: 'idle', at: 0 });
  const [updateCostPrice, setUpdateCostPrice] = useState(true);
  const cache = useRef(new Map<string, ProductLookupDto>());
  const key = draftKey(session.tenant.id, mode);
  const copy = COPY[mode];

  const [lines, setLines] = useState<Line[]>(() => loadDraft(key));
  const [entryType, setEntryType] = useState<EntryType>(mode === 'saida' ? 'OUT' : 'IN');
  const [reason, setReason] = useState('');
  const [exitReason, setExitReason] = useState<StockExitReason>('LOSS');
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ count: number; units: number } | null>(null);
  const [pending, setPending] = useState(0);
  const [search, setSearch] = useState('');
  const canRegister = can(Permission.PRODUCTS_WRITE);

  useEffect(() => {
    try {
      if (lines.length > 0) sessionStorage.setItem(key, JSON.stringify(lines));
      else sessionStorage.removeItem(key);
    } catch {
      // Sem storage (modo privado etc.): a lista so vive nesta tela.
    }
  }, [key, lines]);

  // Lista em andamento: avisa antes de fechar a aba.
  useEffect(() => {
    if (lines.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [lines.length]);

  function addProduct(product: ProductDto, scannedCode: string | null, quantity = 1): void {
    if (!product.trackStock) {
      toast.error(`"${product.name}" não controla estoque. Ative o controle no cadastro do produto.`);
      setFeedback({ kind: 'error', at: Date.now() });
      return;
    }
    setLastResult(null);
    setFeedback({ kind: 'found', at: Date.now() });
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      const rest = current.filter((line) => line.product.id !== product.id);
      return [
        {
          product,
          quantity: Math.round(((existing?.quantity ?? 0) + quantity) * 1000) / 1000,
          unitCost: existing?.unitCost ?? costText(product.costPrice),
          scannedCode: scannedCode ?? existing?.scannedCode ?? null,
          touchedAt: Date.now(),
        },
        ...rest,
      ];
    });
  }

  // "Repor estoque" nos alertas: /estoque/entrada?produto=<id> ja traz o produto.
  useEffect(() => {
    const productId = searchParams.get('produto');
    if (!productId) return;
    setSearchParams({}, { replace: true });
    api
      .get<ProductDto>(`/products/${productId}`)
      .then((product) => addProduct(product, null))
      .catch(() => toast.error('Produto não encontrado.'));
    // So na chegada a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScan(code: string): Promise<void> {
    setUnknownCode(null);
    const cached = cache.current.get(code);
    if (cached?.status === 'FOUND') {
      addProduct(cached.product, code);
      return;
    }
    setPending((value) => value + 1);
    try {
      const result = await api.get<ProductLookupDto>('/products/lookup', { code });
      if (result.status === 'FOUND') {
        cache.current.set(code, result);
        addProduct(result.product, code);
      } else {
        setUnknownCode(result.code);
        setFeedback({ kind: 'not-found', at: Date.now() });
      }
    } catch (error) {
      setFeedback({ kind: 'error', at: Date.now() });
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível buscar o código.');
    } finally {
      setPending((value) => value - 1);
      scanRef.current?.focus();
    }
  }

  const searchQuery = useQuery({
    queryKey: ['products', 'quick-search', search],
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { search, active: 'true', pageSize: 6 }),
    enabled: search.trim().length >= 2,
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<StockEntryResultDto>('/inventory/entries', {
        type: entryType,
        source: lines.some((line) => line.scannedCode) ? 'BARCODE' : 'MANUAL',
        exitReason: entryType === 'OUT' ? exitReason : undefined,
        updateCostPrice: entryType === 'IN' ? updateCostPrice : false,
        reason: reason.trim() || null,
        items: lines.map((line) => {
          const unitCost = entryType === 'IN' && line.unitCost ? parseDecimal(line.unitCost) : NaN;
          return {
            productId: line.product.id,
            quantity: line.quantity,
            scannedCode: line.scannedCode,
            ...(Number.isFinite(unitCost) && unitCost >= 0 ? { unitCost } : {}),
          };
        }),
      }),
    onSuccess: async (result) => {
      setLastResult({ count: result.movements, units: lines.reduce((sum, line) => sum + line.quantity, 0) });
      setLines([]);
      setReason('');
      cache.current.clear();
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`${copy.done}: ${result.movements} ${result.movements === 1 ? 'produto' : 'produtos'}.`);
      scanRef.current?.focus();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível registrar.'),
  });

  function setQuantity(productId: string, raw: string): void {
    const value = parseDecimal(raw);
    setLines((current) =>
      current.map((line) => (line.product.id === productId && Number.isFinite(value) && value > 0 ? { ...line, quantity: value } : line)),
    );
  }

  function step(productId: string, delta: number): void {
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId ? { ...line, quantity: Math.max(1, Math.round((line.quantity + delta) * 1000) / 1000) } : line,
      ),
    );
  }

  const last = lines[0];
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  const sign = entryType === 'OUT' ? -1 : 1;
  const needsDetails = entryType === 'OUT' && exitReason === 'OTHER' && !reason.trim();
  const insufficient = lines.some((line) => line.product.stockQuantity + sign * line.quantity < 0);

  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />
      <StockNav />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Coluna de leitura */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5">
            {mode === 'entrada' ? (
              <SegmentedControl<EntryType>
                label="Tipo de entrada"
                value={entryType}
                onChange={setEntryType}
                options={[
                  { value: 'IN', label: 'Recebimento' },
                  { value: 'RETURN', label: 'Devolução de cliente' },
                ]}
              />
            ) : null}
            <BarcodeScannerInput ref={scanRef} onScan={(code) => void handleScan(code)} busy={pending > 0} feedback={feedback} />
          </Card>

          {unknownCode ? (
            <div role="alert" className="rounded-[var(--radius-lg)] border border-[var(--color-warning)]/40 bg-[var(--color-warning-subtle)] p-5">
              <div className="flex items-start gap-3">
                <PackageSearch aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold">Não encontramos esse produto no seu catálogo.</p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                    Código <strong className="tabular text-[var(--color-text)]">{unknownCode}</strong>. Cadastre agora: o código já vem
                    preenchido.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canRegister && mode === 'entrada' ? (
                      <Button icon={<PackagePlus className="size-4" />} onClick={() => setRegistering(unknownCode)}>
                        Cadastrar produto
                      </Button>
                    ) : (
                      <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
                        {mode === 'saida'
                          ? 'Só é possível dar saída de produtos cadastrados.'
                          : 'Peça a um administrador para cadastrar este produto.'}
                      </p>
                    )}
                    <Button
                      variant="secondary"
                      icon={<X className="size-4" />}
                      onClick={() => {
                        setUnknownCode(null);
                        scanRef.current?.focus();
                      }}
                    >
                      Digitar outro código
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : last ? (
            <div
              key={last.touchedAt}
              aria-live="polite"
              className="pf-flash rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-xs)]"
            >
              <p className="flex items-center gap-1.5 text-[0.75rem] font-medium tracking-wide text-[var(--color-success)] uppercase">
                <CheckCircle2 aria-hidden className="size-3.5" />
                Produto encontrado
              </p>
              <p className="mt-1.5 text-lg leading-snug font-semibold">{last.product.name}</p>
              <ProductFacts product={last.product} />
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-2 py-2.5">
                  <dt className="text-[0.6875rem] text-[var(--color-text-muted)]">Estoque atual</dt>
                  <dd className="tabular text-lg font-semibold">{formatQuantity(last.product.stockQuantity)}</dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] px-2 py-2.5">
                  <dt className="text-[0.6875rem] text-[var(--color-text-muted)]">{entryType === 'OUT' ? 'Saindo' : 'Recebido'}</dt>
                  <dd className="tabular text-lg font-semibold text-[var(--color-brand-text)]">{formatQuantity(last.quantity)}</dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-2 py-2.5">
                  <dt className="text-[0.6875rem] text-[var(--color-text-muted)]">Vai ficar</dt>
                  <dd
                    className={cn(
                      'tabular text-lg font-semibold',
                      last.product.stockQuantity + sign * last.quantity < 0 && 'text-[var(--color-danger)]',
                    )}
                  >
                    {formatQuantity(last.product.stockQuantity + sign * last.quantity)}
                  </dd>
                </div>
              </dl>
              <p className="tabular mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                <span>
                  Custo atual: <strong className="text-[var(--color-text)]">{last.product.costPrice != null ? formatMoney(last.product.costPrice) : 'não informado'}</strong>
                </span>
                <span>
                  Preço: <strong className="text-[var(--color-text)]">{formatMoney(last.product.salePrice)}</strong>
                </span>
                {last.product.margin !== null ? <span>Margem: {percent(last.product.margin)}</span> : null}
              </p>
              {!last.product.active ? (
                <p className="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-[var(--color-warning)]">
                  <AlertTriangle aria-hidden className="size-3.5" /> Produto inativo no cadastro.
                </p>
              ) : null}
            </div>
          ) : lastResult ? (
            <div aria-live="polite" className="rounded-[var(--radius-lg)] border border-[var(--color-success)]/30 bg-[var(--color-success-subtle)] p-5">
              <p className="flex items-center gap-2 text-base font-semibold">
                <CheckCircle2 aria-hidden className="size-5 text-[var(--color-success)]" />
                {copy.done}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {lastResult.count} {lastResult.count === 1 ? 'produto' : 'produtos'} · {formatQuantity(lastResult.units)} unidades.{' '}
                <Link to="/estoque/movimentacoes" className="font-medium text-[var(--color-brand-text)] hover:underline">
                  Ver movimentações
                </Link>
              </p>
            </div>
          ) : null}

          <Card className="p-5">
            <p className="mb-2 text-[0.8125rem] font-medium">Produto sem código? Busque pelo nome</p>
            <SearchInput value={search} onChange={setSearch} placeholder="Nome, SKU ou marca" label="Buscar produto pelo nome" />
            {searchQuery.data && search.trim().length >= 2 ? (
              searchQuery.data.data.length === 0 ? (
                <p className="mt-3 text-[0.8125rem] text-[var(--color-text-muted)]">Nenhum produto encontrado.</p>
              ) : (
                <ul className="mt-2 divide-y divide-[var(--color-border)]">
                  {searchQuery.data.data.map((product) => (
                    <li key={product.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{product.name}</p>
                        <p className="tabular text-[0.75rem] text-[var(--color-text-muted)]">
                          Estoque {product.trackStock ? formatQuantity(product.stockQuantity) : 'sem controle'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Plus className="size-3.5" />}
                        onClick={() => {
                          addProduct(product, null);
                          setSearch('');
                          scanRef.current?.focus();
                        }}
                      >
                        Adicionar
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
        </div>

        {/* Conferencia */}
        <Card className="flex h-fit min-w-0 flex-col overflow-hidden md:sticky md:top-4">
          <CardHeader
            title="Conferência"
            description={lines.length > 0 ? `${lines.length} ${lines.length === 1 ? 'produto' : 'produtos'} · ${formatQuantity(totalUnits)} unidades` : undefined}
            icon={<ScanBarcode className="size-4" />}
            action={
              lines.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setLines([])}>
                  Limpar
                </Button>
              ) : null
            }
          />
          {lines.length === 0 ? (
            <EmptyState
              compact
              icon={<ScanBarcode className="size-5" />}
              title="Nenhum produto na lista"
              description="Bipe o primeiro produto para começar."
            />
          ) : (
            <ul className="max-h-[28rem] divide-y divide-[var(--color-border)] overflow-y-auto">
              {lines.map((line, index) => {
                const after = line.product.stockQuantity + sign * line.quantity;
                return (
                  <li key={line.product.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', index === 0 && 'bg-[var(--color-brand-subtle)]/50')}>
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="truncate text-sm font-semibold">{line.product.name}</p>
                      <p className="tabular text-[0.75rem] text-[var(--color-text-muted)]">
                        Estoque {formatQuantity(line.product.stockQuantity)} → {formatQuantity(after)}
                        {after < 0 ? <Badge tone="danger" className="ml-2">Saldo insuficiente</Badge> : null}
                      </p>
                    </div>
                    {entryType === 'IN' ? (
                      <label className="flex items-center gap-1.5 text-[0.75rem] text-[var(--color-text-muted)]">
                        Custo un.
                        <input
                          value={line.unitCost ?? ''}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((item) => (item.product.id === line.product.id ? { ...item, unitCost: event.target.value } : item)),
                            )
                          }
                          inputMode="decimal"
                          placeholder="R$"
                          aria-label={`Custo unitário de ${line.product.name}`}
                          className="tabular h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-right text-base sm:text-sm"
                        />
                      </label>
                    ) : null}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => step(line.product.id, -1)}
                        aria-label={`Diminuir ${line.product.name}`}
                        className="flex size-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <Minus aria-hidden className="size-4" />
                      </button>
                      <input
                        key={line.quantity}
                        defaultValue={String(line.quantity).replace('.', ',')}
                        onBlur={(event) => setQuantity(line.product.id, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            setQuantity(line.product.id, event.currentTarget.value);
                            scanRef.current?.focus();
                          }
                        }}
                        inputMode="decimal"
                        aria-label={`Quantidade de ${line.product.name}`}
                        className="tabular h-9 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-center text-base font-semibold sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => step(line.product.id, 1)}
                        aria-label={`Aumentar ${line.product.name}`}
                        className="flex size-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <Plus aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLines((current) => current.filter((item) => item.product.id !== line.product.id))}
                        aria-label={`Remover ${line.product.name}`}
                        className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger)]"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-5">
            {entryType === 'OUT' ? (
              <SelectField
                label="Motivo da saída"
                value={exitReason}
                onChange={(event) => setExitReason(event.target.value as StockExitReason)}
                options={EXIT_REASON_ORDER.map((option) => ({ value: option, label: STOCK_EXIT_REASON_LABELS[option] }))}
                required
              />
            ) : null}
            {entryType === 'OUT' && exitReason === 'SALE' ? (
              <p className="rounded-[var(--radius-md)] bg-[var(--color-warning-subtle)] px-3 py-2 text-[0.8125rem]">
                Esta saída baixa o estoque, mas <strong>não entra no Recebido</strong>. Para vender com recebimento, use{' '}
                <Link to="/vendas/nova" className="font-medium text-[var(--color-brand-text)] hover:underline">
                  Nova venda
                </Link>
                .
              </p>
            ) : null}
            {entryType === 'IN' ? (
              <label className="flex items-start gap-2.5 text-[0.8125rem]">
                <input
                  type="checkbox"
                  checked={updateCostPrice}
                  onChange={(event) => setUpdateCostPrice(event.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                />
                Atualizar o custo dos produtos com o custo desta compra
              </label>
            ) : null}
            <TextField
              label={entryType === 'OUT' ? (exitReason === 'OTHER' ? 'Descreva o motivo' : 'Detalhes (opcional)') : 'Observação (opcional)'}
              required={needsDetails}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={entryType === 'IN' ? 'Ex.: NF 1234 — Distribuidora' : entryType === 'RETURN' ? 'Ex.: cliente trocou o tamanho' : ''}
            />
            <Button
              size="lg"
              disabled={lines.length === 0 || needsDetails || insufficient}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
              icon={entryType === 'OUT' ? <Minus className="size-4" /> : <Plus className="size-4" />}
            >
              {copy.confirm}
              {lines.length > 0 ? ` (${formatQuantity(totalUnits)})` : ''}
            </Button>
          </div>
        </Card>
      </div>

      {registering ? (
        <ProductFormDrawer
          open
          scannedCode={registering}
          onClose={() => {
            setRegistering(null);
            scanRef.current?.focus();
          }}
          onSaved={(product) => {
            setUnknownCode(null);
            setLastResult({ count: 1, units: product.stockQuantity });
          }}
        />
      ) : null}
    </>
  );
}
