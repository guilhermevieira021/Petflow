import type { ReportsOverviewDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
      <p className="text-[0.75rem] text-[var(--color-text-muted)]">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

/** Bloqueio contextual para recursos do PRO -- nunca esconde, explica o valor (§36). */
function UpgradeLockedCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-text-subtle)]">
          <Lock aria-hidden className="size-4" />
        </span>
        <div>
          <p className="text-[0.9375rem] font-semibold">{title}</p>
          <p className="mt-1 max-w-sm text-[0.8125rem] text-[var(--color-text-muted)]">{description}</p>
        </div>
        <Link to="/planos">
          <Button size="sm">Conhecer o PRO</Button>
        </Link>
      </CardBody>
    </Card>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(() => toDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  const query = useQuery({
    queryKey: ['reports', 'overview', from, to],
    queryFn: () => api.get<ReportsOverviewDto>('/reports/overview', { from, to }),
  });

  return (
    <>
      <PageHeader title="Relatorios" description="Os numeros do seu pet shop no periodo selecionado." />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[0.8125rem]">
          De
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-base sm:text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem]">
          Ate
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-base sm:text-sm"
          />
        </label>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}
        </div>
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
            <CardHeader title="Atendimentos" />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total" value={String(query.data.appointments.total)} />
              <StatTile label="Concluidos" value={String(query.data.appointments.completed)} />
              <StatTile label="Cancelados" value={String(query.data.appointments.cancelled)} />
              <StatTile label="Faltas" value={String(query.data.appointments.noShow)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Faturamento" />
            <CardBody className="grid grid-cols-2 gap-3">
              <StatTile label="Previsto" value={formatMoney(query.data.revenue.expected)} />
              <StatTile label="Recebido" value={formatMoney(query.data.revenue.received)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Clientes" />
            <CardBody className="grid grid-cols-3 gap-3">
              <StatTile label="Novos" value={String(query.data.customers.new)} />
              <StatTile label="Recorrentes" value={String(query.data.customers.recurring)} />
              <StatTile label="Inativos" value={String(query.data.customers.inactive)} />
            </CardBody>
          </Card>

          {query.data.advanced && query.data.topServices ? (
            <Card>
              <CardHeader title="Servicos mais utilizados" />
              {query.data.topServices.length === 0 ? (
                <CardBody>
                  <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
                    Nenhum atendimento concluido no periodo.
                  </p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {query.data.topServices.map((service) => (
                    <li key={service.serviceId} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{service.serviceName}</p>
                        <p className="text-[0.75rem] text-[var(--color-text-muted)]">{service.count} atendimento(s)</p>
                      </div>
                      <p className="tabular text-sm font-semibold">{formatMoney(service.revenue)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
            <UpgradeLockedCard
              title="Relatorios avancados"
              description="Veja os servicos mais usados e o detalhamento completo de faturamento. Disponivel no plano PRO."
            />
          )}
        </div>
      ) : null}
    </>
  );
}
