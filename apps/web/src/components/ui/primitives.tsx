import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

/* ---------------------------------------------------------------------------
   Card
--------------------------------------------------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--color-border)]',
        'bg-[var(--color-surface)] shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

/* ---------------------------------------------------------------------------
   Badge
--------------------------------------------------------------------------- */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]',
  brand: 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]',
  success: 'bg-[var(--color-success-subtle)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-subtle)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-subtle)] text-[var(--color-info)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-xs)] px-2 py-0.5',
        'text-[0.75rem] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Skeleton
--------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('skeleton rounded-[var(--radius-sm)] h-4 w-full', className)}
    />
  );
}

/**
 * Regiao de carregamento. `aria-busy` + texto para leitor de tela evitam que
 * quem usa leitor fique diante de um silencio sem explicacao.
 */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Empty state
--------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div
          aria-hidden
          className="mb-4 flex size-11 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-text-subtle)]"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Erro de carregamento
--------------------------------------------------------------------------- */

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <h3 className="text-[0.9375rem] font-semibold">Nao foi possivel carregar</h3>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-text-muted)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 text-sm font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
        >
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Avatar
--------------------------------------------------------------------------- */

export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dimension = size === 'sm' ? 'size-7 text-[0.6875rem]' : size === 'lg' ? 'size-11 text-sm' : 'size-9 text-xs';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn(dimension, 'rounded-full object-cover')}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        dimension,
        'inline-flex items-center justify-center rounded-full font-semibold',
        'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]',
      )}
    >
      {initials(name)}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Cabecalho de pagina
--------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
