import { STOCK_MOVEMENT_TYPE_LABELS, type Paginated, type StockMovementDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, EmptyState, ErrorState, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useCurrentSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatQuantity } from '@/lib/format';

const TYPE_TONES: Record<StockMovementDto['type'], BadgeTone> = {
  IN: 'success',
  OUT: 'warning',
  ADJUSTMENT: 'info',
  SALE: 'brand',
  SALE_CANCELLATION: 'neutral',
};

/** Historico de movimentacoes -- de um produto ou do estoque inteiro. */
export function MovementsList({ productId, showProduct = false, pageSize = 15 }: { productId?: string; showProduct?: boolean; pageSize?: number }) {
  const session = useCurrentSession();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['inventory', 'movements', productId ?? 'all', page],
    queryFn: () => api.get<Paginated<StockMovementDto>>('/inventory/movements', { productId, page, pageSize }),
    placeholderData: (previous) => previous,
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-busy="true">
        <span className="sr-only">Carregando movimentações</span>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data || query.data.data.length === 0) {
    return <EmptyState compact icon={<History className="size-5" />} title="Nenhuma movimentação ainda" />;
  }

  return (
    <>
      <ol className="divide-y divide-[var(--color-border)]">
        {query.data.data.map((movement) => (
          <li key={movement.id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={TYPE_TONES[movement.type]}>{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</Badge>
                {showProduct ? (
                  <Link to={`/produtos/${movement.productId}`} className="truncate text-sm font-semibold hover:underline">
                    {movement.productName}
                  </Link>
                ) : null}
                {movement.saleId && movement.saleNumber ? (
                  <Link to={`/vendas/${movement.saleId}`} className="text-[0.8125rem] text-[var(--color-brand-text)] hover:underline">
                    Venda #{movement.saleNumber}
                  </Link>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-[0.75rem] text-[var(--color-text-muted)]">
                {formatDateTime(movement.createdAt, session.tenant.timezone)}
                {movement.userName ? ` · ${movement.userName}` : ''}
                {movement.reason && !movement.saleId ? ` · ${movement.reason}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  'tabular text-sm font-semibold',
                  movement.quantity > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
                )}
              >
                {movement.quantity > 0 ? '+' : ''}
                {formatQuantity(movement.quantity)}
              </p>
              <p className="tabular text-[0.75rem] text-[var(--color-text-subtle)]">saldo {formatQuantity(movement.balanceAfter)}</p>
            </div>
          </li>
        ))}
      </ol>
      <Pagination pagination={query.data.pagination} onPageChange={setPage} />
    </>
  );
}
