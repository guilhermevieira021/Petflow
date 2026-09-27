import { Permission, type InventoryInsightsDto, type InventoryTopProductDto, type ProductDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, History, PackageX, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { MovementsList } from '@/features/inventory/MovementsList';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatQuantity } from '@/lib/format';

function TopList({ items, metric }: { items: InventoryTopProductDto[]; metric: 'sold' | 'turnover' }) {
  if (items.length === 0) {
    return <p className="px-5 py-4 text-[0.8125rem] text-[var(--color-text-muted)]">Nenhuma venda de produto nos últimos 30 dias.</p>;
  }
  return (
    <ol className="divide-y divide-[var(--color-border)]">
      {items.map((item, index) => (
        <li key={item.productId}>
          <Link to={`/produtos/${item.productId}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-hover)]">
            <span className="tabular w-4 text-[0.75rem] text-[var(--color-text-subtle)]">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
            <span className="tabular shrink-0 text-sm font-semibold">
              {metric === 'sold'
                ? `${formatQuantity(item.quantitySold)} ${item.unit === 'UN' ? 'un.' : item.unit.toLowerCase()}`
                : `${Math.round((item.turnover ?? 0) * 100)}%`}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function RestockList({ items }: { items: ProductDto[] }) {
  const { can } = useSession();
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {items.map((product) => (
        <li key={product.id} className="flex items-center gap-3 px-5 py-2.5">
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full', product.stockQuantity <= 0 ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-warning)]')}
          />
          <Link to={`/produtos/${product.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
            {product.name}
          </Link>
          <span className="tabular shrink-0 text-[0.8125rem] text-[var(--color-text-muted)]">
            {product.stockQuantity <= 0 ? 'zerado' : `${formatQuantity(product.stockQuantity)} / mín. ${formatQuantity(product.minStock)}`}
          </span>
          {can(Permission.STOCK_RECEIVE) ? (
            <Link
              to={`/estoque/entrada?produto=${product.id}`}
              className="shrink-0 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
            >
              Repor
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Estoque no painel: so numeros reais do pet shop (sem estimativa inventada).
 * Sem produto cadastrado, mostra o caminho para comecar.
 */
export function InventoryDashboardPanel() {
  const query = useQuery({
    queryKey: ['inventory', 'insights'],
    queryFn: () => api.get<InventoryInsightsDto>('/inventory/insights'),
    staleTime: 30_000,
  });

  if (query.isLoading) return <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />;
  if (!query.data) return null;
  const { summary, topSelling, topTurnover, lowStock, outOfStock, periodDays } = query.data;

  if (summary.activeProducts === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Boxes className="size-5" />}
          title="Estoque ainda vazio"
          description="Cadastre produtos (ou bipe o código na Entrada rápida) para acompanhar estoque, reposição e mais vendidos aqui."
          action={
            <Link to="/estoque/entrada" className="text-sm font-medium text-[var(--color-brand-text)] hover:underline">
              Ir para Entrada rápida
            </Link>
          }
        />
      </Card>
    );
  }

  const restock = [...outOfStock, ...lowStock];
  const cells = [
    { label: 'Valor em estoque (custo)', value: formatMoney(summary.stockCostValue) },
    { label: 'Produtos ativos', value: String(summary.activeProducts) },
    { label: 'Estoque baixo', value: String(summary.lowStockProducts), tone: summary.lowStockProducts > 0 ? 'warning' : undefined },
    { label: 'Zerados', value: String(summary.outOfStockProducts), tone: summary.outOfStockProducts > 0 ? 'danger' : undefined },
  ];

  return (
    <section aria-label="Estoque" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[0.9375rem] font-semibold">Estoque</h2>
        <Link to="/estoque" className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
          Abrir estoque <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      <Card className="@container">
        <dl className="grid grid-cols-2 @2xl:grid-cols-4">
          {cells.map((cell, index) => (
            <div
              key={cell.label}
              className={cn(
                'min-w-0 px-5 py-4',
                index % 2 === 1 && 'border-l border-[var(--color-border)]',
                index >= 2 && 'border-t border-[var(--color-border)] @2xl:border-t-0',
                index === 2 && '@2xl:border-l',
              )}
            >
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{cell.label}</dt>
              <dd
                className={cn(
                  'tabular mt-1 truncate text-lg font-semibold tracking-tight',
                  cell.tone === 'warning' && 'text-[var(--color-warning)]',
                  cell.tone === 'danger' && 'text-[var(--color-danger)]',
                )}
              >
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>
        {summary.productsWithoutCost > 0 ? (
          <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-[0.75rem] text-[var(--color-text-muted)]">
            {summary.productsWithoutCost} {summary.productsWithoutCost === 1 ? 'produto sem custo não entra' : 'produtos sem custo não entram'} no valor em estoque.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Precisa repor" icon={<PackageX className="size-4" />} />
          {restock.length === 0 ? (
            <p className="px-5 py-4 text-[0.8125rem] text-[var(--color-text-muted)]">Tudo acima do mínimo.</p>
          ) : (
            <RestockList items={restock.slice(0, 6)} />
          )}
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Mais vendidos" description={`Últimos ${periodDays} dias`} icon={<TrendingUp className="size-4" />} />
          <TopList items={topSelling} metric="sold" />
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title="Maior giro"
            description="Vendido ÷ (vendido + estoque atual)"
            icon={<TrendingUp className="size-4" />}
          />
          <TopList items={topTurnover} metric="turnover" />
        </Card>
      </div>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader
          title="Últimas movimentações"
          icon={<History className="size-4" />}
          action={
            <Link to="/estoque/movimentacoes" className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
              Histórico completo
            </Link>
          }
        />
        <MovementsList showProduct pageSize={5} />
      </Card>
    </section>
  );
}
