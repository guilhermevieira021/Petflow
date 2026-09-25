import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Campo de busca das listagens. 16px no mobile para o iOS nao dar zoom. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--color-text-subtle)]"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(
          'h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] pr-10 pl-10 sm:h-10',
          'text-base text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] sm:text-sm',
          'shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-150',
          'focus-visible:border-[var(--color-brand)] focus-visible:shadow-[0_0_0_3px_var(--color-brand-subtle)] focus-visible:outline-none',
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpar busca"
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Chip de filtro (liga/desliga). */
export function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-150',
        active
          ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-ink-text)]'
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
      )}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            'tabular rounded-full px-1.5 text-[0.6875rem]',
            active ? 'bg-white/15' : 'bg-[var(--color-surface-sunken)]',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
