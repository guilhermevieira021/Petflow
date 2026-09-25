import { Permission, type DashboardOverview } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDateLong } from '@/lib/format';
import {
  AlertsPanel,
  CustomersPanel,
  LostPanel,
  OperationPanel,
  TodayFinancePanel,
  UpcomingList,
  WeekSummary,
} from './DashboardPanels';
import { OnboardingChecklist } from './OnboardingChecklist';
import { RecentActivity } from './RecentActivity';
import { RevenueChart } from './RevenueChart';

/** "Bom dia" no relogio do PET SHOP, nao no do navegador. */
function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()),
  );
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/* ---------------------------------------------------------------------------
   Skeleton com a MESMA geometria do conteudo real
--------------------------------------------------------------------------- */

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Carregando indicadores do dia e da semana</span>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-72 rounded-[var(--radius-lg)] lg:col-span-7" />
        <Skeleton className="h-72 rounded-[var(--radius-lg)] lg:col-span-5" />
      </div>
      <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 rounded-[var(--radius-lg)] lg:col-span-7" />
        <Skeleton className="h-64 rounded-[var(--radius-lg)] lg:col-span-5" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Conteudo -- exportado para a landing renderizar a tela real com dados de
   demonstracao (`interactive={false}` desliga links e WhatsApp).
--------------------------------------------------------------------------- */

export function DashboardContent({
  data,
  interactive = true,
  showActivity = false,
}: {
  data: DashboardOverview;
  interactive?: boolean;
  showActivity?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 1. Como esta o dinheiro hoje -- a pergunta mais importante vem primeiro. */}
      <section aria-label="Resultado financeiro de hoje" className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <TodayFinancePanel today={data.today} referenceDate={data.referenceDate} />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <LostPanel today={data.today} week={data.week} />
        </div>
      </section>

      {/* 2. A semana, numa faixa unica. */}
      <section aria-label="Resultado da semana">
        <WeekSummary week={data.week} />
      </section>

      {/* 3. O que fazer agora: proximos atendimentos + pendencias. */}
      <section aria-label="Agenda e pendencias" className="grid gap-4 lg:grid-cols-12">
        <Card className="flex min-w-0 flex-col lg:col-span-7">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
            <h2 className="text-[0.9375rem] font-semibold">Próximos atendimentos</h2>
            {interactive ? (
              <Link
                to="/agenda"
                className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
              >
                Ver agenda <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <div className="flex-1">
            <UpcomingList items={data.upcoming} timeZone={data.timezone} interactive={interactive} referenceDate={data.referenceDate} />
          </div>
        </Card>
        <div className="min-w-0 lg:col-span-5">
          <AlertsPanel data={data} interactive={interactive} />
        </div>
      </section>

      {/* 4. Tendencia + operacao. */}
      <section aria-label="Evolucao e operacao" className="grid gap-4 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-8">
          <CardHeader title="Receita dos últimos 14 dias" description="Previsto pelos agendamentos × efetivamente recebido." />
          <CardBody>
            <RevenueChart data={data.revenueSeries} />
          </CardBody>
        </Card>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <OperationPanel today={data.today} />
          <CustomersPanel customers={data.customers} />
        </div>
      </section>

      {showActivity ? (
        <section aria-label="Atividades recentes">
          <RecentActivity />
        </section>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const session = useCurrentSession();
  const { can } = useSession();
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  const query = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/dashboard/overview'),
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        eyebrow={query.data ? formatDateLong(`${query.data.referenceDate}T12:00:00Z`) : undefined}
        title={`${greeting(session.tenant.timezone)}, ${firstName}`}
        description="Veja como o seu pet shop está hoje."
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

      {query.data ? <DashboardContent data={query.data} showActivity={can(Permission.AUDIT_READ)} /> : null}
    </>
  );
}
