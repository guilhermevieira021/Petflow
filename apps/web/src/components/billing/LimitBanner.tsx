import { isLimitReached, usageRatio, type UsageEntry } from '@petflow/contracts';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Aviso persistente de limite de plano acima de uma lista (clientes, pets...).
 * Diferente de um toast: fica visivel ANTES da pessoa tentar criar o
 * proximo registro e levar um erro -- ver §38 do briefing de produto.
 */
export function LimitBanner({ label, entry }: { label: string; entry: UsageEntry }) {
  if (entry.limit === null) return null;
  const reached = isLimitReached(entry);
  const warn = !reached && usageRatio(entry) >= 0.8;
  if (!reached && !warn) return null;

  return (
    <div
      role="status"
      className={
        reached
          ? 'mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/25 bg-[var(--color-danger-subtle)] px-4 py-3'
          : 'mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/25 bg-[var(--color-warning-subtle)] px-4 py-3'
      }
    >
      <TriangleAlert
        aria-hidden
        className={reached ? 'size-4 shrink-0 text-[var(--color-danger)]' : 'size-4 shrink-0 text-[var(--color-warning)]'}
      />
      <p className={reached ? 'flex-1 text-[0.8125rem] text-[var(--color-danger)]' : 'flex-1 text-[0.8125rem] text-[var(--color-warning)]'}>
        {reached
          ? `Voce atingiu o limite de ${entry.limit} ${label.toLowerCase()} do seu plano atual (${entry.used}/${entry.limit}).`
          : `Voce ja usou ${entry.used} de ${entry.limit} ${label.toLowerCase()} do seu plano.`}
      </p>
      <Link
        to="/planos"
        className={
          reached
            ? 'shrink-0 rounded-[var(--radius-md)] bg-[var(--color-danger)] px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:opacity-90'
            : 'shrink-0 text-[0.8125rem] font-medium text-[var(--color-warning)] underline-offset-4 hover:underline'
        }
      >
        Fazer upgrade
      </Link>
    </div>
  );
}
