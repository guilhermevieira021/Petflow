import { type Paginated, type ProductDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatQuantity } from '@/lib/format';
import { MovementsList } from './MovementsList';
import { InventorySummaryStrip, StockBadge } from './ProductsPage';

/** Visao do estoque: alertas de saldo baixo e o historico completo. */
export function StockPage() {
  const lowStock = useQuery({
    queryKey: ['products', 'low-stock'],
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { lowStock: 'true', active: 'true', pageSize: 50, sort: 'stockQuantity' }),
  });

  return (
    <>
      <PageHeader title="Estoque" description="Alertas de reposição e todas as entradas, saídas e ajustes." />
      <InventorySummaryStrip />

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title="Repor em breve" icon={<AlertTriangle className="size-4" />} />
          {lowStock.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : lowStock.data && lowStock.data.data.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 className="size-5" />} title="Nada abaixo do mínimo" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(lowStock.data?.data ?? []).map((product) => (
                <li key={product.id}>
                  <Link to={`/produtos/${product.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)]">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{product.name}</span>
                      <span className="tabular block text-[0.75rem] text-[var(--color-text-muted)]">
                        Saldo {formatQuantity(product.stockQuantity)} · mínimo {formatQuantity(product.minStock)}
                      </span>
                    </span>
                    <StockBadge product={product} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Movimentações" icon={<History className="size-4" />} />
          <MovementsList showProduct pageSize={20} />
        </Card>
      </div>
    </>
  );
}
