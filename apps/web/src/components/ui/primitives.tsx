import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

/* ---------------------------------------------------------------------------
   Card
--------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  tone = 'default',
}: {
  className?: string;
  children: ReactNode;
  /** `ink`: superficie escura para o que tem maior peso na tela. */
  tone?: 'default' | 'ink' | 'sunken';
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)]',
        tone === 'default' && 'border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)]',
        tone === 'ink' && 'bg-[var(--color-ink)] text-[var(--color-ink-text)] shadow-[var(--shadow-md)]',
        tone === 'sunken' && 'border border-[var(--color-border)] bg-[var(--color-surface-sunken)]',
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
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">{description}</p>
          ) : null}
        </div>
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

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-text-subtle)]',
  brand: 'bg-[var(--color-brand)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
  info: 'bg-[var(--color-info)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** Ponto colorido antes do texto -- o status nunca depende so da cor do fundo. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'text-[0.75rem] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_TONES[tone])} /> : null}
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
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="mb-4 flex size-12 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-[var(--color-text-subtle)]"
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
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const dimension =
    size === 'sm'
      ? 'size-8 text-[0.6875rem]'
      : size === 'lg'
        ? 'size-12 text-sm'
        : size === 'xl'
          ? 'size-16 text-lg'
          : 'size-10 text-xs';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn(dimension, 'shrink-0 rounded-full object-cover', className)}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        dimension,
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]',
        className,
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
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="eyebrow mb-1.5 text-[var(--color-text-subtle)]">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)] sm:text-[0.9375rem]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Titulo de secao dentro de uma pagina
--------------------------------------------------------------------------- */

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="eyebrow text-[var(--color-text-muted)]">{children}</h2>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Par rotulo/valor -- fichas de cliente, pet e cobranca
--------------------------------------------------------------------------- */

export function InfoItem({
  label,
  value,
  muted = false,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Valor ausente ("Nao informado") fica em tom secundario. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[0.75rem] text-[var(--color-text-subtle)]">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm font-medium break-words',
          muted && 'font-normal text-[var(--color-text-subtle)]',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
