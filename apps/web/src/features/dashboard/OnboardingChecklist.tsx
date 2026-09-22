import type { SessionPayload } from '@petflow/contracts';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Progresso da configuracao inicial.
 *
 * Os passos sao DERIVADOS do estado real do tenant (o backend conta servicos,
 * clientes, agendamentos). Nao existe um booleano "onboarding_completo"
 * guardado em lugar nenhum -- se o dono apagar todos os servicos, o passo
 * volta a ficar pendente sozinho, sem nenhuma rotina de sincronizacao.
 */
export function OnboardingChecklist({
  onboarding,
}: {
  onboarding: SessionPayload['onboarding'];
}) {
  const done = onboarding.steps.filter((step) => step.done).length;
  const total = onboarding.steps.length;
  const percentage = Math.round((done / total) * 100);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[0.9375rem] font-semibold">Configure seu pet shop</h2>
        <p className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
          {done} de {total} concluidos
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da configuracao inicial"
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-col gap-2.5">
        {onboarding.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden
              className={cn(
                'flex size-4.5 shrink-0 items-center justify-center rounded-full border',
                step.done
                  ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                  : 'border-[var(--color-border-strong)]',
              )}
            >
              {step.done ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span
              className={
                step.done
                  ? 'text-[var(--color-text-subtle)] line-through'
                  : 'text-[var(--color-text)]'
              }
            >
              {step.label}
            </span>
            <span className="sr-only">{step.done ? '(concluido)' : '(pendente)'}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
