import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
  type DashboardOverview,
} from '@petflow/contracts';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  MessageCircle,
  TrendingDown,
  UserRoundX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { APPOINTMENT_STATUS_ORDER, APPOINTMENT_STATUS_TONES } from '@/features/appointments/status';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, formatPercent, formatTime, formatWeekdayShort, realizedPercentage, whatsappLink } from '@/lib/format';
import { toLocalDate } from '@/lib/timezone';

/**
 * Paineis do Dashboard -- puramente de apresentacao: recebem os dados ja
 * calculados pela API (dashboard.service.ts) e so decidem COMO mostrar.
 * Nenhuma regra de receita e recalculada aqui.
 *
 * Por serem puros, a landing reaproveita estes mesmos componentes com dados
 * de demonstracao -- o visitante ve a tela real do produto, nao um desenho.
 */

/* ---------------------------------------------------------------------------
   Barra de progresso recebido/previsto
--------------------------------------------------------------------------- */

function ProgressBar({ value, tone = 'brand', label }: { value: number | null; tone?: 'brand' | 'ink'; label: string }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? 'Sem previsão' : `${value}%`}
      className={cn('h-2 w-full overflow-hidden rounded-full', tone === 'ink' ? 'bg-white/10' : 'bg-[var(--color-surface-sunken)]')}
    >
      <div
        className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-700"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   HOJE -- o painel principal (recebido x previsto)
--------------------------------------------------------------------------- */

export function TodayFinancePanel({
  today,
  referenceDate,
}: {
  today: DashboardOverview['today'];
  referenceDate: string;
}) {
  const percentage = realizedPercentage(today.expectedRevenue, today.receivedRevenue);
  // Mesma conta que o dashboard ja exibia: previsto (que ja exclui
  // cancelado/falta) menos recebido. Pode ser negativo quando entra
  // pagamento adiantado -- mostramos o dado real, sem piso em zero.
  const toReceive = today.expectedRevenue - today.receivedRevenue;

  return (
    <Card tone="ink" className="relative overflow-hidden p-5 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[var(--color-brand)] opacity-20 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-[var(--color-ink-muted)]">Hoje · {formatDate(`${referenceDate}T12:00:00Z`)}</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[0.75rem] font-medium text-[var(--color-ink-text)]">
            <CalendarDays aria-hidden className="size-3.5" />
            <span className="tabular">{today.total}</span> {today.total === 1 ? 'atendimento' : 'atendimentos'}
          </span>
        </div>

        <p className="mt-6 text-[0.8125rem] font-medium text-[var(--color-ink-muted)]">Recebido hoje</p>
        <p className="tabular mt-1 text-[2.5rem] leading-none font-semibold tracking-tight text-[var(--color-ink-text)] sm:text-5xl">
          {formatMoney(today.receivedRevenue)}
        </p>

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="text-[var(--color-ink-muted)]">Realizado do previsto</span>
            <span className="tabular font-semibold text-[var(--color-ink-text)]">{formatPercent(percentage)}</span>
          </div>
          <ProgressBar value={percentage} tone="ink" label="Percentual recebido do previsto para hoje" />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--color-ink-border)] pt-5">
          <div>
            <dt className="text-[0.75rem] text-[var(--color-ink-muted)]">Previsto hoje</dt>
            <dd className="tabular mt-1 text-lg font-semibold text-[var(--color-ink-text)] sm:text-xl">
              {formatMoney(today.expectedRevenue)}
            </dd>
          </div>
          <div>
            <dt className="text-[0.75rem] text-[var(--color-ink-muted)]">A receber hoje</dt>
            <dd className="tabular mt-1 text-lg font-semibold text-[var(--color-ink-text)] sm:text-xl">
              {formatMoney(toReceive)}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   PERDIDO -- destaque de gestao
--------------------------------------------------------------------------- */

export function LostPanel({
  today,
  week,
}: {
  today: DashboardOverview['today'];
  week: DashboardOverview['week'];
}) {
  const hasLoss = today.lostRevenue > 0 || week.lostRevenue > 0;

  return (
    <Card
      className={cn(
        'flex h-full flex-col p-5 sm:p-7',
        hasLoss && 'border-[var(--color-danger-border)] bg-gradient-to-b from-[var(--color-danger-subtle)] to-[var(--color-surface)]',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn('eyebrow', hasLoss ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-subtle)]')}>
          Dinheiro perdido
        </p>
        <span
          aria-hidden
          className={cn(
            'flex size-8 items-center justify-center rounded-full',
            hasLoss ? 'bg-[var(--color-danger)] text-white' : 'bg-[var(--color-surface-sunken)] text-[var(--color-text-subtle)]',
          )}
        >
          <TrendingDown className="size-4" />
        </span>
      </div>

      <p className="mt-6 text-[0.8125rem] font-medium text-[var(--color-text-muted)]">Perdido hoje</p>
      <p
        className={cn(
          'tabular mt-1 text-[2.25rem] leading-none font-semibold tracking-tight sm:text-[2.5rem]',
          today.lostRevenue > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]',
        )}
      >
        {formatMoney(today.lostRevenue)}
      </p>
      <p className="mt-2 text-[0.8125rem] text-[var(--color-text-muted)]">
        <span className="tabular">{today.cancelled}</span> {today.cancelled === 1 ? 'cancelamento' : 'cancelamentos'} ·{' '}
        <span className="tabular">{today.noShow}</span> {today.noShow === 1 ? 'falta' : 'faltas'}
      </p>

      <div className="mt-auto pt-6">
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-4">
          <span className="text-[0.8125rem] text-[var(--color-text-muted)]">Perdido na semana</span>
          <span
            className={cn(
              'tabular text-lg font-semibold',
              week.lostRevenue > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]',
            )}
          >
            {formatMoney(week.lostRevenue)}
          </span>
        </div>
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--color-text-subtle)]">
          Receita de agendamentos cancelados ou em que o cliente não compareceu.
        </p>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Semana -- uma faixa unica, nao quatro cards iguais
--------------------------------------------------------------------------- */

export function WeekSummary({ week }: { week: DashboardOverview['week'] }) {
  const percentage = realizedPercentage(week.expectedRevenue, week.receivedRevenue);
  const cells: { label: string; value: string; tone?: 'danger' | 'success' }[] = [
    { label: 'Previsto na semana', value: formatMoney(week.expectedRevenue) },
    { label: 'Recebido na semana', value: formatMoney(week.receivedRevenue), tone: 'success' },
    { label: 'Perdido na semana', value: formatMoney(week.lostRevenue), tone: week.lostRevenue > 0 ? 'danger' : undefined },
    { label: '% realizado', value: formatPercent(percentage) },
  ];

  // Container query (e nao breakpoint de tela): o mesmo cartao aparece em
  // largura cheia no Dashboard e em meia coluna na landing.
  return (
    <Card className="@container">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-semibold">Esta semana</h2>
        <p className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
          {formatDate(`${week.weekStart}T12:00:00Z`)} a {formatDate(`${week.weekEnd}T12:00:00Z`)}
        </p>
      </div>
      <dl className="grid grid-cols-2 @2xl:grid-cols-4">
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={cn(
              'min-w-0 px-5 py-4',
              index % 2 === 1 && 'border-l border-[var(--color-border)]',
              index >= 2 && 'border-t border-[var(--color-border)] @2xl:border-t-0',
              index === 2 && '@2xl:border-l',
            )}
          >
            <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{cell.label}</dt>
            <dd
              className={cn(
                'tabular mt-1 truncate text-lg font-semibold tracking-tight @md:text-xl',
                cell.tone === 'danger' && 'text-[var(--color-danger)]',
                cell.tone === 'success' && 'text-[var(--color-success)]',
              )}
            >
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Operacao do dia -- distribuicao por status
--------------------------------------------------------------------------- */

const STATUS_COUNT_KEY: Record<AppointmentStatus, keyof DashboardOverview['today']> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'noShow',
};

const STATUS_BAR_COLORS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'var(--color-border-strong)',
  CONFIRMED: 'var(--color-info)',
  IN_PROGRESS: 'var(--color-brand)',
  COMPLETED: 'var(--color-success)',
  CANCELLED: 'var(--color-danger)',
  NO_SHOW: 'var(--color-warning)',
};

export function OperationPanel({ today }: { today: DashboardOverview['today'] }) {
  const rows = APPOINTMENT_STATUS_ORDER.map((status) => ({
    status,
    count: today[STATUS_COUNT_KEY[status]] as number,
  }));
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.count, 0));

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.9375rem] font-semibold">Operação de hoje</h2>
        <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
          <span className="tabular font-semibold text-[var(--color-text)]">{today.total}</span> atendimentos
        </p>
      </div>

      <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" aria-hidden>
        {today.total > 0
          ? rows
              .filter((row) => row.count > 0)
              .map((row) => (
                <span
                  key={row.status}
                  className="h-full"
                  style={{ width: `${(row.count / total) * 100}%`, backgroundColor: STATUS_BAR_COLORS[row.status] }}
                />
              ))
          : null}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rows.map((row) => (
          <li key={row.status} className="flex items-center gap-2 text-[0.8125rem]">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_BAR_COLORS[row.status] }} />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-muted)]">{APPOINTMENT_STATUS_LABELS[row.status]}</span>
            <span className="tabular font-semibold">{row.count}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Clientes
--------------------------------------------------------------------------- */

export function CustomersPanel({ customers }: { customers: DashboardOverview['customers'] }) {
  return (
    <Card className="p-5">
      <h2 className="text-[0.9375rem] font-semibold">Clientes</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Novos no mês</dt>
          <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{customers.newThisMonth}</dd>
        </div>
        <div>
          <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Clientes ativos</dt>
          <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{customers.total}</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-3.5 py-2.5">
        <span className="text-[0.8125rem] text-[var(--color-text-muted)]">Pets atendidos</span>
        <span className="text-[0.75rem] text-[var(--color-text-subtle)]">Indicador em breve</span>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Alertas -- derivados SO dos numeros que a API ja entrega
--------------------------------------------------------------------------- */

interface AlertItem {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  to: string;
  tone: 'warning' | 'danger' | 'info';
}

export function buildAlerts(data: Pick<DashboardOverview, 'today' | 'pendingReturns' | 'customers'>): AlertItem[] {
  const alerts: AlertItem[] = [];
  if (data.today.scheduled > 0) {
    alerts.push({
      key: 'unconfirmed',
      icon: <CalendarClock className="size-4" />,
      title: `${data.today.scheduled} ${data.today.scheduled === 1 ? 'atendimento de hoje sem confirmação' : 'atendimentos de hoje sem confirmação'}`,
      detail: 'Confirme com o cliente para evitar faltas.',
      to: '/agenda',
      tone: 'info',
    });
  }
  if (data.today.noShow > 0) {
    alerts.push({
      key: 'no-show',
      icon: <AlertTriangle className="size-4" />,
      title: `${data.today.noShow} ${data.today.noShow === 1 ? 'cliente faltou hoje' : 'clientes faltaram hoje'}`,
      detail: 'Vale remarcar enquanto o contato está recente.',
      to: '/agenda',
      tone: 'danger',
    });
  }
  if (data.pendingReturns > 0) {
    alerts.push({
      key: 'returns',
      icon: <CalendarCheck2 className="size-4" />,
      title: `${data.pendingReturns} ${data.pendingReturns === 1 ? 'retorno pendente' : 'retornos pendentes'}`,
      detail: 'Já atendidos, sem próximo agendamento marcado.',
      to: '/recuperacao',
      tone: 'warning',
    });
  }
  if (data.customers.inactive > 0) {
    alerts.push({
      key: 'inactive',
      icon: <UserRoundX className="size-4" />,
      title: `${data.customers.inactive} ${data.customers.inactive === 1 ? 'cliente sumido' : 'clientes sumidos'}`,
      detail: `Sem agendar há mais de ${data.customers.inactiveThresholdDays} dias.`,
      to: '/recuperacao',
      tone: 'warning',
    });
  }
  return alerts;
}

const ALERT_TONES: Record<AlertItem['tone'], string> = {
  info: 'bg-[var(--color-info-subtle)] text-[var(--color-info)]',
  warning: 'bg-[var(--color-warning-subtle)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]',
};

export function AlertsPanel({
  data,
  interactive = true,
}: {
  data: Pick<DashboardOverview, 'today' | 'pendingReturns' | 'customers'>;
  /** false na landing: os itens nao levam a lugar nenhum. */
  interactive?: boolean;
}) {
  const alerts = buildAlerts(data);

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-semibold">Precisa de atenção</h2>
        {alerts.length > 0 ? <Badge tone="warning">{alerts.length}</Badge> : null}
      </div>
      {alerts.length === 0 ? (
        <EmptyState
          compact
          icon={<CheckCircle2 className="size-5" />}
          title="Tudo em dia"
          description="Nenhuma pendência na operação agora."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {alerts.map((alert) => {
            const content = (
              <>
                <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]', ALERT_TONES[alert.tone])}>
                  {alert.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{alert.title}</span>
                  <span className="block text-[0.8125rem] text-[var(--color-text-muted)]">{alert.detail}</span>
                </span>
                {interactive ? <ArrowUpRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" /> : null}
              </>
            );
            return (
              <li key={alert.key}>
                {interactive ? (
                  <Link to={alert.to} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-surface-hover)]">
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-3.5">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Proximos atendimentos
--------------------------------------------------------------------------- */

export function UpcomingList({
  items,
  timeZone,
  interactive = true,
  referenceDate,
}: {
  items: DashboardOverview['upcoming'];
  timeZone: string;
  interactive?: boolean;
  /** Dia de referencia (hoje do tenant). Itens de outros dias mostram a data. */
  referenceDate?: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={<CalendarDays className="size-5" />}
        title="Nenhum atendimento a caminho"
        description="Quando houver agendamentos, os próximos aparecem aqui para você se preparar."
      />
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {items.map((item) => {
        const link = interactive
          ? whatsappLink(
              item.customerWhatsapp,
              `Ola, ${item.customerName.split(' ')[0]}! Confirmando o atendimento do ${item.petName} as ${formatTime(item.startsAt, timeZone)}.`,
            )
          : null;

        return (
          <li key={item.id} className="flex items-center gap-3.5 px-5 py-3.5">
            <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] py-1.5">
              <span className="tabular text-sm font-semibold">{formatTime(item.startsAt, timeZone)}</span>
              {referenceDate && toLocalDate(item.startsAt, timeZone) !== referenceDate ? (
                <span className="text-[0.6875rem] font-medium whitespace-nowrap text-[var(--color-text-muted)] capitalize">
                  {formatWeekdayShort(item.startsAt, timeZone)} {formatDate(item.startsAt, timeZone).slice(0, 5)}
                </span>
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {item.petName}
                <span className="font-normal text-[var(--color-text-muted)]"> · {item.customerName}</span>
              </p>
              <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                {item.serviceName} · <span className="tabular">{formatMoney(item.price)}</span>
              </p>
            </div>

            <Badge dot tone={APPOINTMENT_STATUS_TONES[item.status]} className="max-sm:hidden">
              {APPOINTMENT_STATUS_LABELS[item.status]}
            </Badge>

            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Abrir conversa no WhatsApp com ${item.customerName}`}
                title="Abrir conversa no WhatsApp"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-success-subtle)] hover:text-[var(--color-success)]"
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
