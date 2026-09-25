import { cn } from '@/lib/cn';

/** Simbolo do Petflow (pegada). Usa a cor da marca atual. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-brand)] text-white',
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[70%]" fill="currentColor">
        <ellipse cx="11" cy="11.5" rx="2.5" ry="3.2" />
        <ellipse cx="21" cy="11.5" rx="2.5" ry="3.2" />
        <ellipse cx="6.6" cy="17.4" rx="2.2" ry="2.8" />
        <ellipse cx="25.4" cy="17.4" rx="2.2" ry="2.8" />
        <path d="M16 15.8c3.4 0 6.4 3 6.4 6.1 0 2.3-1.7 3.6-4 3.6-1 0-1.7-.3-2.4-.3s-1.4.3-2.4.3c-2.3 0-4-1.3-4-3.6 0-3.1 3-6.1 6.4-6.1z" />
      </svg>
    </span>
  );
}

/** Marca completa: simbolo + nome. */
export function Logo({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span
        className={cn(
          'text-[1.0625rem] font-semibold tracking-tight',
          tone === 'light' ? 'text-[var(--color-ink-text)]' : 'text-[var(--color-text)]',
        )}
      >
        Petflow
      </span>
    </span>
  );
}
