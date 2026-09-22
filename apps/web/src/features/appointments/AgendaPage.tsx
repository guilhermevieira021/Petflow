import {
  APPOINTMENT_STATUS_LABELS,
  LIMIT_KEY_LABELS,
  Permission,
  type AppointmentDetailDto,
  type AppointmentStatus,
  type Paginated,
} from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, MessageCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatDateLong, formatMoney, formatTime, formatWeekdayShort, whatsappLink } from '@/lib/format';
import { localDayWindow, shiftDate, todayInTimeZone, toLocalDate } from '@/lib/timezone';
import { AppointmentFormDrawer } from './AppointmentFormDrawer';
import { AppointmentStatusActions } from './AppointmentStatusActions';

type ViewMode = 'day' | 'week' | 'list';

const STATUS_TONES: Record<AppointmentStatus, BadgeTone> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  IN_PROGRESS: 'brand',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
};

/**
 * Domingo (0) como inicio da semana, em CALENDARIO puro -- `weekStart` ja
 * recebe uma data local (YYYY-MM-DD) correta do fuso do tenant, entao esta
 * conta so precisa manipular o calendario, sem tocar em fuso de novo.
 */
function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -weekday);
}

function AppointmentRow({
  appointment,
  showDate = false,
  timeZone,
}: {
  appointment: AppointmentDetailDto;
  showDate?: boolean;
  timeZone: string;
}) {
  const link = whatsappLink(
    appointment.customerWhatsapp,
    `Ola, ${appointment.customerName.split(' ')[0]}! Confirmando o atendimento do ${appointment.petName} as ${formatTime(appointment.startsAt, timeZone)}.`,
  );

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      {/* Coluna de data/hora: largura minima generosa e sem quebra de linha,
          para nunca colar no nome do pet ao lado (o bug reportado). */}
      <div className="flex shrink-0 flex-row items-baseline gap-2 sm:w-28 sm:flex-col sm:items-start sm:gap-0.5">
        {showDate ? (
          <span className="text-sm font-semibold whitespace-nowrap capitalize">
            {formatWeekdayShort(appointment.startsAt, timeZone)}, {formatDate(appointment.startsAt, timeZone)}
          </span>
        ) : null}
        <span className="tabular text-sm font-semibold whitespace-nowrap text-[var(--color-text-muted)] sm:text-[0.8125rem]">
          {formatTime(appointment.startsAt, timeZone)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {appointment.petName}
          <span className="font-normal text-[var(--color-text-muted)]"> &middot; {appointment.customerName}</span>
        </p>
        <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
          {appointment.serviceName} &middot; {formatMoney(appointment.price)}
          {appointment.professionalName ? ` · ${appointment.professionalName}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONES[appointment.status]}>{APPOINTMENT_STATUS_LABELS[appointment.status]}</Badge>
        <div className="flex items-center gap-1.5">
          <AppointmentStatusActions appointment={appointment} />
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`WhatsApp de ${appointment.customerName}`}
              className="shrink-0 rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-success)]"
            >
              <MessageCircle aria-hidden className="size-4" />
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function AgendaPage() {
  const { can } = useSession();
  const session = useCurrentSession();
  const timeZone = session.tenant.timezone;
  const [searchParams] = useSearchParams();
  const canWrite = can(Permission.APPOINTMENTS_WRITE);

  const [view, setView] = useState<ViewMode>('day');
  // "Hoje" precisa ser o hoje do PET SHOP, nao o do navegador de quem esta
  // olhando -- ver lib/timezone.ts.
  const [date, setDate] = useState(() => todayInTimeZone(timeZone));
  const [listPage, setListPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(
    Boolean(searchParams.get('customerId')) || false,
  );

  const defaultCustomerId = searchParams.get('customerId') ?? undefined;

  const dayWindow = useMemo(() => localDayWindow(date, timeZone), [date, timeZone]);
  const dayQuery = useQuery({
    queryKey: ['appointments', 'day', date, timeZone],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        from: dayWindow.from,
        to: dayWindow.to,
        pageSize: 100,
        sort: 'startsAt',
        order: 'asc',
      }),
    enabled: view === 'day',
  });

  const weekStart = useMemo(() => startOfWeek(date), [date]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)), [weekStart]);
  const weekWindow = useMemo(
    () => ({ from: localDayWindow(weekStart, timeZone).from, to: localDayWindow(weekDays[6]!, timeZone).to }),
    [weekStart, weekDays, timeZone],
  );
  const weekQuery = useQuery({
    queryKey: ['appointments', 'week', weekStart, timeZone],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        from: weekWindow.from,
        to: weekWindow.to,
        // O maximo aceito pela API e 100 (PAGE_SIZE_MAX). O valor anterior
        // aqui era 200 -- a requisicao SEMPRE falhava com 422, e a view
        // inteira caia para "0 atendimentos" em todo dia, mascarado como se
        // fosse so um problema de fuso. 100 agendamentos numa unica semana
        // ja e mais do que qualquer pet shop realista agenda.
        pageSize: 100,
      }),
    enabled: view === 'week',
  });

  const listQuery = useQuery({
    queryKey: ['appointments', 'list', listPage],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        page: listPage,
        pageSize: 20,
        sort: 'startsAt',
        order: 'desc',
      }),
    enabled: view === 'list',
  });

  const usage = session.billing.usage.appointments;

  // Agrupa cada agendamento pelo dia LOCAL do tenant em que ele acontece --
  // nao pelos primeiros 10 caracteres do ISO (esses sao o dia em UTC, que
  // pode ser o dia seguinte para um horario no fim da tarde em fusos do
  // Brasil). Era exatamente aqui que um agendamento de quarta-feira sumia da
  // contagem de quarta-feira.
  const weekCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of weekDays) counts.set(day, 0);
    for (const appointment of weekQuery.data?.data ?? []) {
      const day = toLocalDate(appointment.startsAt, timeZone);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return counts;
  }, [weekQuery.data, weekDays, timeZone]);

  const weekAppointmentsByDay = useMemo(() => {
    const groups = new Map<string, AppointmentDetailDto[]>();
    for (const day of weekDays) groups.set(day, []);
    for (const appointment of weekQuery.data?.data ?? []) {
      const day = toLocalDate(appointment.startsAt, timeZone);
      groups.get(day)?.push(appointment);
    }
    return groups;
  }, [weekQuery.data, weekDays, timeZone]);

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Seus atendimentos de hoje, da semana ou em lista."
        action={
          canWrite ? (
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo agendamento
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.appointments} entry={usage} /> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Visualizacao da agenda" className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
          {(['day', 'week', 'list'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              role="tab"
              type="button"
              aria-selected={view === mode}
              onClick={() => setView(mode)}
              className={
                view === mode
                  ? 'rounded-[calc(var(--radius-md)-2px)] bg-[var(--color-brand)] px-3 py-1.5 text-[0.8125rem] font-medium text-white'
                  : 'rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }
            >
              {mode === 'day' ? 'Dia' : mode === 'week' ? 'Semana' : 'Lista'}
            </button>
          ))}
        </div>

        {view !== 'list' ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDate((current) => shiftDate(current, view === 'day' ? -1 : -7))}>
              Anterior
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDate(todayInTimeZone(timeZone))}>
              Hoje
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDate((current) => shiftDate(current, view === 'day' ? 1 : 7))}>
              Proxima
            </Button>
          </div>
        ) : null}
      </div>

      {view === 'day' ? (
        <Card>
          <div className="border-b border-[var(--color-border)] px-5 py-3">
            <p className="text-sm font-medium capitalize">{formatDateLong(dayWindow.from, timeZone)}</p>
          </div>
          {dayQuery.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <span className="sr-only">Carregando agenda do dia</span>
              {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : null}
          {dayQuery.isError ? (
            <ErrorState
              message={dayQuery.error instanceof ApiError ? dayQuery.error.message : 'Tente novamente.'}
              onRetry={() => void dayQuery.refetch()}
            />
          ) : null}
          {dayQuery.data && dayQuery.data.data.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              title="Sua agenda esta vazia neste dia"
              description="Crie um agendamento para comecar."
              action={
                canWrite ? (
                  <Button icon={<CalendarPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
                    Novo agendamento
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {dayQuery.data && dayQuery.data.data.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)]">
              {dayQuery.data.data.map((appointment) => (
                <AppointmentRow key={appointment.id} appointment={appointment} timeZone={timeZone} />
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {view === 'week' && weekQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-busy="true">
          <span className="sr-only">Carregando agenda da semana</span>
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : null}

      {view === 'week' && weekQuery.isError ? (
        <Card>
          <ErrorState
            message={weekQuery.error instanceof ApiError ? weekQuery.error.message : 'Tente novamente.'}
            onRetry={() => void weekQuery.refetch()}
          />
        </Card>
      ) : null}

      {view === 'week' && weekQuery.data ? (
        <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {weekDays.map((day) => {
            const dayAppointments = weekAppointmentsByDay.get(day) ?? [];
            const count = weekCounts.get(day) ?? 0;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setDate(day);
                  setView('day');
                }}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--color-brand-subtle)]"
              >
                <p className="text-[0.75rem] font-medium text-[var(--color-text-muted)] capitalize">
                  {formatWeekdayShort(`${day}T12:00:00Z`, timeZone)}
                </p>
                <p className="mt-0.5 text-sm font-semibold">{formatDate(`${day}T12:00:00Z`, timeZone)}</p>
                <p className="tabular mt-2 text-2xl font-semibold">{count}</p>
                <p className="text-[0.75rem] text-[var(--color-text-subtle)]">
                  {count === 1 ? 'atendimento' : 'atendimentos'}
                </p>
                {dayAppointments.length > 0 ? (
                  <p className="mt-1 truncate text-[0.6875rem] text-[var(--color-text-subtle)]">
                    {formatTime(dayAppointments[0]!.startsAt, timeZone)} {dayAppointments[0]!.petName}
                    {dayAppointments.length > 1 ? ` +${dayAppointments.length - 1}` : ''}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {view === 'list' ? (
        <Card>
          {listQuery.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <span className="sr-only">Carregando agendamentos</span>
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : null}
          {listQuery.isError ? (
            <ErrorState
              message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Tente novamente.'}
              onRetry={() => void listQuery.refetch()}
            />
          ) : null}
          {listQuery.data && listQuery.data.data.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-5" />} title="Nenhum agendamento ainda" />
          ) : null}
          {listQuery.data && listQuery.data.data.length > 0 ? (
            <>
              <ul className="divide-y divide-[var(--color-border)]">
                {listQuery.data.data.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} showDate timeZone={timeZone} />
                ))}
              </ul>
              <Pagination pagination={listQuery.data.pagination} onPageChange={setListPage} />
            </>
          ) : null}
        </Card>
      ) : null}

      <AppointmentFormDrawer
        open={drawerOpen}
        defaultCustomerId={defaultCustomerId}
        defaultDate={date}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
