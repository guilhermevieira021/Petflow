import type { Paginated } from '@petflow/contracts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({
  pagination,
  onPageChange,
}: {
  pagination: Paginated<unknown>['pagination'];
  onPageChange: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;

  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-3">
      <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
        Mostrando <span className="tabular font-medium text-[var(--color-text)]">{start}</span>
        {'-'}
        <span className="tabular font-medium text-[var(--color-text)]">{end}</span> de{' '}
        <span className="tabular font-medium text-[var(--color-text)]">{pagination.total}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronLeft className="size-4" />}
          disabled={!pagination.hasPrevious}
          onClick={() => onPageChange(pagination.page - 1)}
          aria-label="Pagina anterior"
        >
          Anterior
        </Button>
        <span className="tabular px-2 text-[0.8125rem] text-[var(--color-text-muted)]">
          {pagination.page} / {pagination.totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!pagination.hasNext}
          onClick={() => onPageChange(pagination.page + 1)}
          aria-label="Proxima pagina"
        >
          Proxima
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
