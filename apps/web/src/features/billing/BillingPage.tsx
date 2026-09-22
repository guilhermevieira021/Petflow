import {
  LIMIT_KEY_LABELS,
  LimitKey,
  SUBSCRIPTION_STATUS_LABELS,
  type BillingStatusDto,
} from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UsageIndicator } from '@/components/billing/UsageIndicator';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { clearCheckoutStarted, isReturningFromCheckout, markCheckoutStarted } from '@/lib/checkout';
import { formatDate, formatMoney } from '@/lib/format';

/**
 * Por quanto tempo, apos voltar do checkout, a pagina consulta o backend com
 * mais frequencia esperando a confirmacao do webhook. Depois disso, para de
 * insistir sozinha -- "nao fazer polling infinito" (§13). A pessoa pode
 * atualizar a pagina mais tarde; o estado real nunca depende de a aba ficar
 * aberta.
 */
const CONFIRMATION_POLL_MS = 4000;
const CONFIRMATION_TIMEOUT_MS = 60_000;

const LIMIT_ROWS: LimitKey[] = [
  LimitKey.CUSTOMERS,
  LimitKey.PETS,
  LimitKey.APPOINTMENTS,
  LimitKey.SERVICES,
  LimitKey.USERS,
];

const STATUS_TONES: Record<BillingStatusDto['subscription']['status'], BadgeTone> = {
  TRIALING: 'brand',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELLED: 'neutral',
  EXPIRED: 'danger',
};

function StatusPanel({ billing }: { billing: BillingStatusDto }) {
  const { subscription } = billing;

  if (subscription.status === 'ACTIVE') {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-success)]/25 bg-[var(--color-success-subtle)] p-4">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-success)]" />
        <div>
          <p className="text-[0.875rem] font-medium text-[var(--color-success)]">
            Seu plano {billing.plan.name} esta ativo.
          </p>
          {subscription.currentPeriodEnd ? (
            <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">
              Renova em {formatDate(subscription.currentPeriodEnd)}.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (subscription.status === 'PAST_DUE') {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/25 bg-[var(--color-warning-subtle)] p-4">
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" />
        <p className="text-[0.875rem] font-medium text-[var(--color-warning)]">
          Existe um problema com seu pagamento. Atualize os dados de cobranca para evitar interrupcoes.
        </p>
      </div>
    );
  }

  if (subscription.status === 'CANCELLED') {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4">
        <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]" />
        <p className="text-[0.875rem] text-[var(--color-text-muted)]">
          Seu plano foi cancelado
          {subscription.currentPeriodEnd ? ` e sera encerrado em ${formatDate(subscription.currentPeriodEnd)}` : ''}.
        </p>
      </div>
    );
  }

  if (subscription.status === 'EXPIRED') {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/25 bg-[var(--color-danger-subtle)] p-4">
        <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]" />
        <p className="text-[0.875rem] font-medium text-[var(--color-danger)]">Seu plano expirou.</p>
      </div>
    );
  }

  // TRIALING
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] p-4">
      <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-brand-text)]" />
      <div>
        <p className="text-[0.875rem] font-medium text-[var(--color-brand-text)]">
          {billing.trial.active
            ? `Seu teste termina em ${billing.trial.hoursRemaining}h.`
            : 'Seu teste terminou.'}
        </p>
        {billing.trial.endsAt ? (
          <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">
            Data prevista: {formatDate(billing.trial.endsAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function BillingPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // true so quando a pessoa acabou de voltar de um checkout iniciado nesta
  // mesma aba -- ver lib/checkout.ts. Nao e "todo mundo em TRIAL", so quem
  // realmente tentou pagar ha pouco.
  const [confirming, setConfirming] = useState(() => isReturningFromCheckout());
  const confirmingSinceRef = useRef<number | null>(confirming ? Date.now() : null);

  const query = useQuery({
    queryKey: ['billing', 'status'],
    queryFn: () => api.get<BillingStatusDto>('/billing/status'),
    initialData: session?.billing,
    // Enquanto aguarda confirmacao, consulta com mais frequencia -- por um
    // tempo limitado (CONFIRMATION_TIMEOUT_MS), nunca para sempre.
    refetchInterval: confirming ? CONFIRMATION_POLL_MS : false,
  });

  // Confirmacao chegou: o proprio GET /billing/status (fonte de verdade,
  // atualizada pelo webhook) e quem decide -- nunca o retorno do checkout.
  useEffect(() => {
    if (!confirming || !query.data) return;
    if (query.data.subscription.status === 'ACTIVE') {
      clearCheckoutStarted();
      setConfirming(false);
      toast.success('Plano PRO ativado.');
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    }
  }, [confirming, query.data, queryClient, toast]);

  // Desiste de insistir sozinha apos o prazo -- a pessoa pode atualizar a
  // pagina mais tarde, o estado real nao depende da aba continuar aberta.
  useEffect(() => {
    if (!confirming) return;
    const startedAt = confirmingSinceRef.current ?? Date.now();
    const remaining = CONFIRMATION_TIMEOUT_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      setConfirming(false);
      return;
    }
    const timeout = window.setTimeout(() => setConfirming(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [confirming]);

  async function handleSubscribe(): Promise<void> {
    setCheckoutLoading(true);
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
      // O estado real so muda quando o webhook confirmar -- por isso
      // revalidamos em vez de assumir qualquer coisa aqui.
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel iniciar o checkout.');
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="Plano e cobranca" description="Acompanhe seu plano, uso e status de pagamento." />

      {confirming && query.data?.subscription.status !== 'ACTIVE' ? (
        <div
          role="status"
          className="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] px-4 py-3"
        >
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-[var(--color-brand-text)]" />
          <p className="text-[0.875rem] font-medium text-[var(--color-brand-text)]">
            Estamos confirmando seu pagamento...
          </p>
        </div>
      ) : null}

      {query.isLoading ? (
        <Card>
          <CardBody className="flex flex-col gap-4" aria-busy="true">
            <span className="sr-only">Carregando cobranca</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </CardBody>
        </Card>
      ) : null}

      {query.isError ? (
        <Card>
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : null}

      {query.data ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={`Plano ${query.data.plan.name}`}
              action={
                <Badge tone={STATUS_TONES[query.data.subscription.status]}>
                  {SUBSCRIPTION_STATUS_LABELS[query.data.subscription.status]}
                </Badge>
              }
            />
            <CardBody className="flex flex-col gap-4">
              <StatusPanel billing={query.data} />

              {query.data.plan.code === 'TRIAL' || query.data.subscription.status !== 'ACTIVE' ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
                  <div>
                    <p className="text-[0.875rem] font-medium">Assine o plano PRO</p>
                    <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
                      Limites ampliados, relatorios avancados e automacao de mensagens.
                    </p>
                  </div>
                  <Button loading={checkoutLoading} onClick={handleSubscribe}>
                    Assinar PRO
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Uso do plano" description="Atualizado em tempo real conforme voce usa o sistema." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              {LIMIT_ROWS.map((key) => (
                <UsageIndicator key={key} label={LIMIT_KEY_LABELS[key]} entry={query.data!.usage[key]} />
              ))}
            </CardBody>
          </Card>

          {query.data.plan.priceCents > 0 ? (
            <Card>
              <CardHeader title="Valor" />
              <CardBody>
                <p className="text-2xl font-semibold tracking-tight">
                  {formatMoney(query.data.plan.priceCents / 100)}
                  {query.data.plan.billingPeriod === 'MONTHLY' ? (
                    <span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">/mes</span>
                  ) : null}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
