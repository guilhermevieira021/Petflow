import { FEATURE_LABELS, FeatureKey, type PlanDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, LogOut, PawPrint, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useCurrentSession, useLogout } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { markCheckoutStarted } from '@/lib/checkout';
import { formatMoney } from '@/lib/format';

/**
 * Paywall.
 *
 * Deliberadamente NAO parece uma tela de erro (§74): visual de produto,
 * beneficios do PRO, preco vindo do backend, e reforco explicito de que os
 * dados do pet shop continuam salvos. Navegacao restante fica limitada a
 * billing/configuracoes/logout -- ver ALLOWED_WHEN_BLOCKED em AppLayout.
 */
export function UpgradePage() {
  const session = useCurrentSession();
  const logout = useLogout();
  const [loading, setLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: PlanDto[] }>('/plans'),
  });
  const proPlan = plansQuery.data?.data.find((plan) => plan.code === 'PRO');

  const reason = session.billing.access.reason;
  const headline =
    reason === 'TRIAL_EXPIRED'
      ? 'Seu periodo de teste terminou.'
      : reason === 'SUBSCRIPTION_CANCELLED'
        ? 'Sua assinatura foi encerrada.'
        : 'Sua assinatura precisa ser reativada.';

  async function handleSubscribe(): Promise<void> {
    setLoading(true);
    setCheckoutMessage(null);
    try {
      const result = await api.post<{ checkoutUrl: string | null; message: string }>(
        '/billing/checkout',
        { planCode: 'PRO' },
      );
      if (result.checkoutUrl) {
        markCheckoutStarted();
        window.location.href = result.checkoutUrl;
        return;
      }
      setCheckoutMessage(result.message);
    } catch (error) {
      setCheckoutMessage(
        error instanceof ApiError ? error.message : 'Nao foi possivel iniciar o checkout.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-canvas)]">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <PawPrint aria-hidden className="size-5 text-[var(--color-brand)]" />
          <span className="font-semibold tracking-tight">PetFlow</span>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <LogOut aria-hidden className="size-4" />
          Sair
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6">
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-7 shadow-[var(--shadow-md)] sm:p-8">
          <div className="flex size-11 items-center justify-center rounded-full bg-[var(--color-brand-subtle)]">
            <ShieldCheck aria-hidden className="size-5 text-[var(--color-brand-text)]" />
          </div>

          <h1 className="mt-4 text-xl font-semibold tracking-tight">{headline}</h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
            Continue fazendo o {session.tenant.name} crescer -- seus clientes, pets e agenda continuam
            salvos, esperando por voce.
          </p>

          {proPlan ? (
            <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
              <p className="text-[0.8125rem] font-semibold tracking-wide text-[var(--color-brand-text)] uppercase">
                {proPlan.name}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatMoney(proPlan.priceCents / 100)}
                <span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">/mes</span>
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {[FeatureKey.AUTOMATION, FeatureKey.ADVANCED_REPORTS, FeatureKey.UNLIMITED_RETENTION_WINDOW].map(
                  (key) => (
                    <li key={key} className="flex items-center gap-2 text-[0.8125rem]">
                      <Check aria-hidden className="size-3.5 shrink-0 text-[var(--color-success)]" />
                      {FEATURE_LABELS[key]}
                    </li>
                  ),
                )}
                <li className="flex items-center gap-2 text-[0.8125rem]">
                  <Check aria-hidden className="size-3.5 shrink-0 text-[var(--color-success)]" />
                  Clientes, pets e agendamentos ilimitados
                </li>
              </ul>
            </div>
          ) : null}

          {checkoutMessage ? (
            <p
              role="status"
              className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-subtle)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-info)]"
            >
              {checkoutMessage}
            </p>
          ) : null}

          <Button size="lg" className="mt-6 w-full" loading={loading} onClick={handleSubscribe}>
            Assinar PRO
          </Button>

          <div className="mt-4 flex justify-center gap-4 text-[0.8125rem]">
            <Link to="/billing" className="text-[var(--color-brand-text)] underline-offset-4 hover:underline">
              Ver cobranca
            </Link>
            <Link to="/planos" className="text-[var(--color-text-muted)] underline-offset-4 hover:underline">
              Comparar planos
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
