import { isLimitReached, usageRatio, type UsageEntry } from '@petflow/contracts';
import { cn } from '@/lib/cn';

/**
 * Barra "usado / limite" para um recurso do plano (clientes, pets...).
 *
 * `limit: null` significa ilimitado -- nao ha barra para desenhar, so o
 * numero de uso. Acima de 80% a barra fica amarela; no limite, vermelha.
 */
export function UsageIndicator({ label, entry }: { label: string; entry: UsageEntry }) {
  const ratio = usageRatio(entry);
  const reached = isLimitReached(entry);
  const warn = !reached && ratio >= 0.8;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-medium">{label}</span>
        <span className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
          {entry.used}
          {entry.limit !== null ? ` / ${entry.limit}` : ' (ilimitado)'}
        </span>
      </div>

      {entry.limit !== null ? (
        <div
          role="progressbar"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Uso de ${label}`}
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              reached
                ? 'bg-[var(--color-danger)]'
                : warn
                  ? 'bg-[var(--color-warning)]'
                  : 'bg-[var(--color-brand)]',
            )}
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
          />
        </div>
      ) : null}

      {reached ? (
        <p className="mt-1 text-[0.75rem] text-[var(--color-danger)]">Limite atingido.</p>
      ) : warn ? (
        <p className="mt-1 text-[0.75rem] text-[var(--color-warning)]">Perto do limite do plano.</p>
      ) : null}
    </div>
  );
}
