import type { DashboardOverview } from '@petflow/contracts';
import { APPOINTMENT_STATUS_LABELS } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  MessageCircle,
  MinusCircle,
  Percent,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  UserRoundX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCurrentSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDateLong, formatMoney, formatPercent, formatTime, realizedPercentage, whatsappLink } from '@/lib/format';
import { OnboardingChecklist } from './OnboardingChecklist';
import { RevenueChart } from './RevenueChart';

/* ---------------------------------------------------------------------------
   Stat tile -- numero-manchete. Sem grafico: o valor E a visualizacao.
--------------------------------------------------------------------------- */

function StatTile({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
  /** Quando informado, o cartao inteiro vira um link. */
  to?: string;
}) {
  const accent =
    tone === 'success'
      ? 'text-[var(--color-success)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text-subtle)]';

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.75rem] font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
          {label}
        </p>
        <span aria-hidden className={accent}>
          {icon}
        </span>
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {detail ? (
        <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">{detail}</p>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="block">
        <Card className="p-4 transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--color-brand-subtle)]">
          {content}
        </Card>
      </Link>
    );
  }

  return <Card className="p-4">{content}</Card>;
}

/* ---------------------------------------------------------------------------
   Previsto/Recebido/Nao realizado/% realizado -- MESMOS quatro indicadores
   para "hoje" e para "semana", so a janela de dados muda (ver
   dashboard.service.ts: buildTodayMetrics e buildWeekMetrics aplicam a
   mesma regra -- cancelado/no-show fora do previsto, pagamento por paidAt --
   cada uma na sua janela). Um unico componente evita as duas versoes
   divergirem por acidente.
--------------------------------------------------------------------------- */

function RevenueTiles({
  expected,
  received,
  lost,
}: {
  expected: number;
  received: number;
  /** Soma de agendamentos cancelados/nao compareceu -- nunca vai virar receita (dashboard.service.ts). */
  lost: number;
}) {
  // Subtracao direta, sem piso em zero: se um dia receber mais do que o
  // previsto (ex.: pagamento adiantado), isso aparece como numero negativo
  // em vez de escondido -- e o dado real, nao um "cliente perdido". Note que
  // "previsto" ja exclui cancelado/no-show (ver dashboard.service.ts), entao
  // este valor e' "a receber" de agendamentos ainda validos -- nao inclui o
  // que foi perdido por cancelamento/falta, que e' o tile "Perdido" abaixo.
  const notRealized = expected - received;
  const percentage = realizedPercentage(expected, received);

  return (
    <>
      <StatTile
        label="Previsto"
        value={formatMoney(expected)}
        icon={<TrendingUp className="size-4" />}
      />
      <StatTile
        label="Recebido"
        value={formatMoney(received)}
        icon={<CheckCircle2 className="size-4" />}
        tone="success"
      />
      <StatTile
        label="Nao realizado"
        value={formatMoney(notRealized)}
        detail="Previsto menos recebido"
        icon={<MinusCircle className="size-4" />}
        tone={notRealized > 0 ? 'warning' : 'neutral'}
      />
      <StatTile
        label="Perdido"
        value={formatMoney(lost)}
        detail="Cancelado ou nao compareceu"
        icon={<TrendingDown className="size-4" />}
        tone={lost > 0 ? 'warning' : 'neutral'}
      />
      <StatTile
        label="% realizado"
        value={formatPercent(percentage)}
        icon={<Percent className="size-4" />}
        tone={percentage !== null && percentage >= 100 ? 'success' : 'neutral'}
      />
    </>
  );
}

/* ---------------------------------------------------------------------------
   Estado de carregamento -- skeleton com a MESMA geometria do conteudo real,
   para o layout nao saltar quando os dados chegam.
--------------------------------------------------------------------------- */

function StatTileSkeleton() {
  return (
    <Card className="p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-28" />
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando indicadores do dia e da semana</span>

      <Skeleton className="mb-2 h-3.5 w-12" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <StatTileSkeleton key={index} />
        ))}
      </div>

      <Skeleton className="mt-5 mb-2 h-3.5 w-20" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <StatTileSkeleton key={index} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardBody>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-6 h-48 w-full" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Proximos atendimentos
--------------------------------------------------------------------------- */

const STATUS_TONES = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  IN_PROGRESS: 'brand',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
} as const;

function UpcomingList({ items, timeZone }: { items: DashboardOverview['upcoming']; timeZone: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="size-5" />}
        title="Nenhum atendimento a caminho"
        description="Quando houver agendamentos, os proximos aparecem aqui para voce se preparar."
      />
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {items.map((item) => {
        const link = whatsappLink(
          item.customerWhatsapp,
          `Ola, ${item.customerName.split(' ')[0]}! Confirmando o atendimento do ${item.petName} as ${formatTime(item.startsAt, timeZone)}.`,
        );

        return (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3">
            <div className="tabular w-12 shrink-0 text-sm font-semibold">
              {formatTime(item.startsAt, timeZone)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {item.petName}
                <span className="font-normal text-[var(--color-text-muted)]">
                  {' '}
                  &middot; {item.customerName}
                </span>
              </p>
              <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                {item.serviceName} &middot; {formatMoney(item.price)}
              </p>
            </div>

            <Badge tone={STATUS_TONES[item.status]}>{APPOINTMENT_STATUS_LABELS[item.status]}</Badge>

            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Abrir conversa no WhatsApp com ${item.customerName}`}
                title="Abrir conversa no WhatsApp"
                className="shrink-0 rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-success)]"
              >
                <MessageCircle aria-hidden className="size-4" />
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
   Pagina
--------------------------------------------------------------------------- */

export function DashboardPage() {
  const session = useCurrentSession();
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  const query = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/dashboard/overview'),
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title={`Bom trabalho, ${firstName}`}
        description={
          query.data
            ? `Resumo de ${formatDateLong(`${query.data.referenceDate}T12:00:00Z`)}.`
            : 'Resumo do dia no seu pet shop.'
        }
      />

      {!session.onboarding.completed ? (
        <div className="mb-5">
          <OnboardingChecklist onboarding={session.onboarding} />
        </div>
      ) : null}

      {query.isLoading ? <DashboardSkeleton /> : null}

      {query.isError ? (
        <Card>
          <ErrorState
            message={
              query.error instanceof ApiError
                ? query.error.message
                : 'Tente novamente em alguns instantes.'
            }
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : null}

      {query.data ? (
        <>
          {/* Hoje e semana usam a MESMA regra de calculo (ver dashboard.service.ts) --
              so a janela de dados muda. Separados em duas secoes com titulo
              proprio para nunca serem confundidos um com o outro. */}
          <h2 className="mb-2 text-[0.8125rem] font-semibold text-[var(--color-text-muted)]">Hoje</h2>
          <section aria-label="Indicadores de hoje" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatTile
              label="Atendimentos hoje"
              value={String(query.data.today.total)}
              detail={`${query.data.today.confirmed} confirmados, ${query.data.today.completed} concluidos`}
              icon={<CalendarDays className="size-4" />}
            />
            <RevenueTiles
              expected={query.data.today.expectedRevenue}
              received={query.data.today.receivedRevenue}
              lost={query.data.today.lostRevenue}
            />
          </section>

          <h2 className="mt-5 mb-2 text-[0.8125rem] font-semibold text-[var(--color-text-muted)]">
            Esta semana
          </h2>
          <section aria-label="Indicadores da semana" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <RevenueTiles
              expected={query.data.week.expectedRevenue}
              received={query.data.week.receivedRevenue}
              lost={query.data.week.lostRevenue}
            />
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Receita dos ultimos 14 dias"
                description="Previsto pelos agendamentos x efetivamente recebido."
              />
              <CardBody>
                <RevenueChart data={query.data.revenueSeries} />
              </CardBody>
            </Card>

            <Card className="flex flex-col">
              <CardHeader
                title="Proximos atendimentos"
                action={
                  <Link to="/agenda" className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
                    Ver agenda completa
                  </Link>
                }
              />
              <div className="flex-1">
                <UpcomingList items={query.data.upcoming} timeZone={query.data.timezone} />
              </div>
            </Card>
          </div>

          <section
            aria-label="Indicadores de clientes"
            className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatTile
              label="Clientes ativos"
              value={String(query.data.customers.total)}
              detail="Total na sua base"
              icon={<UserRoundPlus className="size-4" />}
            />
            <StatTile
              label="Novos no mes"
              value={String(query.data.customers.newThisMonth)}
              detail="Cadastrados neste mes"
              icon={<UserRoundPlus className="size-4" />}
            />
            <StatTile
              label="Retornos pendentes"
              value={String(query.data.pendingReturns)}
              detail="Ja atendidos, sem proximo agendamento"
              icon={<CalendarClock className="size-4" />}
              tone={query.data.pendingReturns > 0 ? 'warning' : 'neutral'}
              to="/recuperacao"
            />
            <StatTile
              label="Clientes sumidos"
              value={String(query.data.customers.inactive)}
              detail={`Sem agendar ha mais de ${query.data.customers.inactiveThresholdDays} dias`}
              icon={<UserRoundX className="size-4" />}
              tone={query.data.customers.inactive > 0 ? 'warning' : 'neutral'}
              to="/recuperacao"
            />
          </section>
        </>
      ) : null}
    </>
  );
}
