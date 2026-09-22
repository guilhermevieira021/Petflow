import type { BillingStatusDto } from '@petflow/contracts';
import { AlertTriangle, Clock, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '@/lib/format';

/**
 * Aviso global de estado do plano. So aparece quando ha algo a comunicar --
 * plano PRO ativo e saudavel nao gera ruido nenhum. A informacao vem sempre
 * de `billing` (carregado uma vez em /me e refletido aqui), nunca calculada
 * no navegador: o countdown some quando o usuario recarrega a pagina depois
 * do trial vencer, porque o proprio backend passa a dizer que venceu.
 */
export function TrialBanner({ billing }: { billing: BillingStatusDto }) {
  if (billing.access.blocked) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 border-b border-[var(--color-danger)]/20 bg-[var(--color-danger-subtle)] px-4 py-2.5 text-[var(--color-danger)] sm:px-6"
      >
        <ShieldAlert aria-hidden className="size-4 shrink-0" />
        <p className="flex-1 text-[0.8125rem] font-medium">
          {billing.access.reason === 'TRIAL_EXPIRED'
            ? 'Seu periodo de teste terminou.'
            : 'Sua assinatura nao esta ativa.'}{' '}
          Seus dados continuam salvos.
        </p>
        <Link
          to="/upgrade"
          className="shrink-0 rounded-[var(--radius-md)] bg-[var(--color-danger)] px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:opacity-90"
        >
          Escolher plano
        </Link>
      </div>
    );
  }

  if (billing.subscription.status === 'PAST_DUE') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 border-b border-[var(--color-warning)]/20 bg-[var(--color-warning-subtle)] px-4 py-2.5 text-[var(--color-warning)] sm:px-6"
      >
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        <p className="flex-1 text-[0.8125rem] font-medium">
          Ha um problema com o pagamento do seu plano. Atualize para continuar sem interrupcoes.
        </p>
        <Link
          to="/configuracoes/plano"
          className="shrink-0 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-[var(--color-warning)]/10"
        >
          Ver cobranca
        </Link>
      </div>
    );
  }

  if (billing.subscription.status === 'CANCELLED' && billing.subscription.currentPeriodEnd) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-2.5 sm:px-6">
        <Clock aria-hidden className="size-4 shrink-0 text-[var(--color-text-muted)]" />
        <p className="flex-1 text-[0.8125rem] text-[var(--color-text-muted)]">
          Seu plano sera encerrado em {formatDate(billing.subscription.currentPeriodEnd)}.
        </p>
        <Link
          to="/planos"
          className="shrink-0 text-[0.8125rem] font-medium text-[var(--color-brand-text)] underline-offset-4 hover:underline"
        >
          Reativar assinatura
        </Link>
      </div>
    );
  }

  if (billing.trial.active && billing.trial.hoursRemaining !== null) {
    const hours = billing.trial.hoursRemaining;
    const urgent = hours <= 24;

    return (
      <div
        className={
          urgent
            ? 'flex flex-wrap items-center gap-3 border-b border-[var(--color-warning)]/20 bg-[var(--color-warning-subtle)] px-4 py-2.5 text-[var(--color-warning)] sm:px-6'
            : 'flex flex-wrap items-center gap-3 border-b border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] px-4 py-2.5 text-[var(--color-brand-text)] sm:px-6'
        }
      >
        <Clock aria-hidden className="size-4 shrink-0" />
        <p className="flex-1 text-[0.8125rem] font-medium">
          {hours <= 1
            ? 'Seu teste termina em menos de 1 hora.'
            : hours <= 24
              ? `Seu teste termina em ${hours}h.`
              : `Seu teste termina em ${Math.ceil(hours / 24)} dia(s).`}
        </p>
        <Link
          to="/planos"
          className="shrink-0 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:bg-[var(--color-brand-hover)]"
        >
          Ver planos
        </Link>
      </div>
    );
  }

  return null;
}
