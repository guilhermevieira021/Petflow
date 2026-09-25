import {
  FEATURE_LABELS,
  FeatureKey,
  LIMIT_KEY_LABELS,
  LimitKey,
  type PlanDto,
} from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { isReturningFromCheckout, markCheckoutStarted } from '@/lib/checkout';
import { formatMoney, formatTrialPeriod } from '@/lib/format';

const LIMIT_ROWS: LimitKey[] = [
  LimitKey.CUSTOMERS,
  LimitKey.PETS,
  LimitKey.APPOINTMENTS,
  LimitKey.SERVICES,
  LimitKey.USERS,
];

const FEATURE_ROWS: FeatureKey[] = [
  FeatureKey.UNLIMITED_RETENTION_WINDOW,
  FeatureKey.ADVANCED_REPORTS,
  FeatureKey.AUTOMATION,
];

function limitLabel(plan: PlanDto, key: LimitKey): string {
  const value = plan.limits[key];
  if (key === 'appointments' && plan.code === 'TRIAL') {
    return `${value} (total no teste)`;
  }
  return value === null ? 'Ilimitado' : String(value);
}

function PlanPrice({ plan }: { plan: PlanDto }) {
  if (plan.code === 'TRIAL') {
    return (
      <p className="text-3xl font-semibold tracking-tight">
        Grátis
        {formatTrialPeriod(plan.trialHours) ? (
          <span className="ml-1.5 text-base font-normal text-[var(--color-text-muted)]">
            por {formatTrialPeriod(plan.trialHours)}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p className="text-3xl font-semibold tracking-tight">
      {formatMoney(plan.priceCents / 100)}
      {plan.billingPeriod === 'MONTHLY' ? (
        <span className="ml-1 text-base font-normal text-[var(--color-text-muted)]">/mes</span>
      ) : null}
    </p>
  );
}

function PlanCTA({ plan }: { plan: PlanDto }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  // Veio de um checkout recem-iniciado nesta aba e ainda nao temos a
  // confirmacao do webhook (ver lib/checkout.ts) -- nao mostra "Assinar PRO"
  // de novo, o que levaria a pessoa a comecar outro checkout por engano.
  const [confirming] = useState(() => isReturningFromCheckout());

  if (!session) {
    return (
      <Link to="/criar-conta" className="block">
        <Button size="lg" className="w-full">
          Começar teste grátis
        </Button>
      </Link>
    );
  }

  const isCurrentPlan = session.billing.plan.code === plan.code && session.billing.subscription.status === 'ACTIVE';
  const isCurrentTrial = session.billing.plan.code === plan.code && session.billing.subscription.status === 'TRIALING';

  if (isCurrentPlan || (plan.code === 'TRIAL' && isCurrentTrial)) {
    return (
      <Button size="lg" variant="secondary" disabled className="w-full">
        Seu plano atual
      </Button>
    );
  }

  if (plan.code === 'TRIAL') {
    return null;
  }

  if (confirming) {
    return (
      <Button size="lg" variant="secondary" disabled className="w-full">
        Pagamento em processamento
      </Button>
    );
  }

  async function handleSubscribe(): Promise<void> {
    setLoading(true);
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
      toast.info(result.message);
      navigate('/billing');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel iniciar o checkout.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="lg" className="w-full" loading={loading} onClick={handleSubscribe}>
      Assinar PRO
    </Button>
  );
}

export function PricingPage() {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: PlanDto[] }>('/plans'),
  });

  const trialPeriod = formatTrialPeriod(query.data?.data.find((plan) => plan.code === 'TRIAL')?.trialHours);

  const content = (
    <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Escolha o plano para o seu pet shop
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[0.9375rem] text-[var(--color-text-muted)]">
          {trialPeriod
            ? `Comece com ${trialPeriod} de teste grátis. Sem cartão de crédito.`
            : 'Comece com um teste grátis. Sem cartão de crédito.'}
        </p>
      </div>

      {query.isLoading ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <Card className="mt-10">
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : null}

      {query.data ? (
        <>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {query.data.data.map((plan) => (
              <Card key={plan.id} className="flex flex-col p-6">
                <p className="text-[0.8125rem] font-semibold tracking-wide text-[var(--color-brand-text)] uppercase">
                  {plan.name}
                </p>
                <div className="mt-2">
                  <PlanPrice plan={plan} />
                </div>
                <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                  {LIMIT_ROWS.map((key) => (
                    <li key={key} className="flex items-center gap-2 text-[0.875rem]">
                      <Check aria-hidden className="size-4 shrink-0 text-[var(--color-success)]" />
                      <span className="tabular">
                        {limitLabel(plan, key)} {LIMIT_KEY_LABELS[key].toLowerCase()}
                      </span>
                    </li>
                  ))}
                  {FEATURE_ROWS.map((key) => (
                    <li key={key} className="flex items-center gap-2 text-[0.875rem]">
                      {plan.features.includes(key) ? (
                        <Check aria-hidden className="size-4 shrink-0 text-[var(--color-success)]" />
                      ) : (
                        <X aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                      )}
                      <span className={plan.features.includes(key) ? '' : 'text-[var(--color-text-subtle)]'}>
                        {FEATURE_LABELS[key]}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  <PlanCTA plan={plan} />
                </div>
              </Card>
            ))}
          </div>

          {/* Tabela comparativa -- mesmos dados dos cartoes, em formato de leitura rapida. */}
          <div className="mt-12 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <table className="w-full text-[0.8125rem]">
              <caption className="sr-only">Comparacao detalhada entre os planos</caption>
              <thead className="bg-[var(--color-surface-sunken)]">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">Recurso</th>
                  {query.data.data.map((plan) => (
                    <th key={plan.id} scope="col" className="px-4 py-2.5 text-left font-medium">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIMIT_ROWS.map((key) => (
                  <tr key={key} className="border-t border-[var(--color-border)]">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal text-[var(--color-text-muted)]">
                      {LIMIT_KEY_LABELS[key]}
                    </th>
                    {query.data!.data.map((plan) => (
                      <td key={plan.id} className="tabular px-4 py-2.5">
                        {limitLabel(plan, key)}
                      </td>
                    ))}
                  </tr>
                ))}
                {FEATURE_ROWS.map((key) => (
                  <tr key={key} className="border-t border-[var(--color-border)]">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal text-[var(--color-text-muted)]">
                      {FEATURE_LABELS[key]}
                    </th>
                    {query.data!.data.map((plan) => (
                      <td key={plan.id} className="px-4 py-2.5">
                        {plan.features.includes(key) ? (
                          <Check aria-hidden className="size-4 text-[var(--color-success)]" />
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">--</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );

  // Visitante: pagina publica com header proprio. Usuario logado: mantem a
  // mesma pagina, mas sem duplicar o header (ja esta dentro do AppLayout ou
  // sera aberta a partir do TrialBanner/menu).
  if (session) return content;

  return (
    <div className="min-h-dvh bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4 sm:px-6">
          <Link to="/" className="flex items-center">
            <Logo />
          </Link>
          <Link to="/entrar" className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            Entrar
          </Link>
        </div>
      </header>
      {content}
    </div>
  );
}
