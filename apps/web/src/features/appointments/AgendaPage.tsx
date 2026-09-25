import {
  APPOINTMENT_STATUS_LABELS,
  LIMIT_KEY_LABELS,
  Permission,
  type AppointmentDetailDto,
  type AppointmentStatus,
  type Paginated,
} from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { FilterChip } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateLong, formatTime } from '@/lib/format';
import { localDayWindow, shiftDate, todayInTimeZone, toLocalDate } from '@/lib/timezone';
import { AppointmentCard } from './AppointmentCard';
import { AppointmentFormDrawer } from './AppointmentFormDrawer';
import { AppointmentStatusActions } from './AppointmentStatusActions';
import { APPOINTMENT_STATUS_ACCENTS, APPOINTMENT_STATUS_ORDER } from './status';

type ViewMode = 'day' | 'week' | 'month' | 'list';

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'list', label: 'Lista' },
];

/** Maximo aceito pela API por pagina (PAGE_SIZE_MAX). */
const PAGE_SIZE_MAX = 100;
/** Teto de paginas buscadas para o mes -- evita laco sem fim se algo der errado. */
const MONTH_MAX_PAGES = 10;

/* ---------------------------------------------------------------------------
   Calendario puro (YYYY-MM-DD). As datas ja sao locais do tenant; aqui so ha
   aritmetica de calendario, sem fuso -- ver lib/timezone.ts.
--------------------------------------------------------------------------- */

/** Domingo (0) como inicio da semana. */
function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -weekday);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(date: string, months: number): string {
  const instant = new Date(`${startOfMonth(date)}T00:00:00Z`);
  instant.setUTCMonth(instant.getUTCMonth() + months);
  return instant.toISOString().slice(0, 10);
}

function endOfMonth(date: string): string {
  return shiftDate(shiftMonth(date, 1), -1);
}

/** Rotulo a partir de uma data local (meio-dia UTC nunca vira outro dia). */
function labelFor(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function groupByLocalDay(items: AppointmentDetailDto[], days: string[], timeZone: string): Map<string, AppointmentDetailDto[]> {
  const groups = new Map<string, AppointmentDetailDto[]>();
  for (const day of days) groups.set(day, []);
  for (const appointment of items) {
    // Agrupa pelo dia LOCAL do tenant -- nunca pelos 10 primeiros caracteres
    // do ISO (esse e o dia em UTC e pode ser o dia seguinte no fim da tarde).
    const day = toLocalDate(appointment.startsAt, timeZone);
    groups.get(day)?.push(appointment);
  }
  for (const list of groups.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return groups;
}

async function fetchRange(from: string, to: string): Promise<AppointmentDetailDto[]> {
  const all: AppointmentDetailDto[] = [];
  for (let page = 1; page <= MONTH_MAX_PAGES; page += 1) {
    const result = await api.get<Paginated<AppointmentDetailDto>>('/appointments', {
      from,
      to,
      page,
      pageSize: PAGE_SIZE_MAX,
      sort: 'startsAt',
      order: 'asc',
    });
    all.push(...result.data);
    if (!result.pagination.hasNext) break;
  }
  return all;
}

/* ---------------------------------------------------------------------------
   Pecas visuais
--------------------------------------------------------------------------- */

function DayStrip({
  days,
  selected,
  today,
  counts,
  onSelect,
}: {
  days: string[];
  selected: string;
  today: string;
  counts: Map<string, number> | null;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="scroll-x -mx-4 mb-4 px-4 sm:mx-0 sm:px-0">
      <ul className="grid min-w-[30rem] grid-cols-7 gap-1.5 sm:min-w-0 sm:gap-2" aria-label="Dias da semana">
        {days.map((day) => {
          const isSelected = day === selected;
          const count = counts?.get(day) ?? 0;
          return (
            <li key={day}>
              <button
                type="button"
                onClick={() => onSelect(day)}
                aria-pressed={isSelected}
                aria-label={`${labelFor(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} atendimentos`}
                className={cn(
                  'flex w-full flex-col items-center gap-0.5 rounded-[var(--radius-md)] border py-2.5 transition-colors',
                  isSelected
                    ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-ink-text)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
                )}
              >
                <span
                  className={cn(
                    'text-[0.6875rem] font-medium uppercase',
                    isSelected ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-text-subtle)]',
                  )}
                >
                  {labelFor(day, { weekday: 'short' }).replace('.', '')}
                </span>
                <span className="tabular text-lg leading-tight font-semibold">{Number(day.slice(8))}</span>
                <span className="flex h-3 items-center">
                  {counts ? (
                    count > 0 ? (
                      <span
                        className={cn(
                          'tabular rounded-full px-1.5 text-[0.625rem] leading-3 font-semibold',
                          isSelected ? 'bg-white/15' : 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]',
                        )}
                      >
                        {count}
                      </span>
                    ) : day === today ? (
                      <span aria-hidden className="size-1 rounded-full bg-[var(--color-brand)]" />
                    ) : null
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-[var(--radius-lg)] sm:h-20" />
      ))}
    </div>
  );
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <ErrorState message={error instanceof ApiError ? error.message : 'Tente novamente.'} onRetry={onRetry} />
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Pagina
--------------------------------------------------------------------------- */

export function AgendaPage() {
  const { can } = useSession();
  const session = useCurrentSession();
  const timeZone = session.tenant.timezone;
  const [searchParams, setSearchParams] = useSearchParams();
  const canWrite = can(Permission.APPOINTMENTS_WRITE);

  const [view, setView] = useState<ViewMode>('day');
  // "Hoje" precisa ser o hoje do PET SHOP, nao o do navegador de quem esta
  // olhando -- ver lib/timezone.ts.
  const today = useMemo(() => todayInTimeZone(timeZone), [timeZone]);
  const [date, setDate] = useState(today);
  const [listPage, setListPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'ALL'>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(
    Boolean(searchParams.get('customerId')) || searchParams.get('novo') === '1',
  );

  const defaultCustomerId = searchParams.get('customerId') ?? undefined;

  // O botao "Novo agendamento" da barra superior navega para ?novo=1 -- inclusive
  // quando a agenda ja esta aberta. Abre o formulario e limpa o parametro.
  useEffect(() => {
    if (searchParams.get('novo') === '1') {
      setDrawerOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('novo');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setStatusFilter('ALL');
  }, [date, view]);

  /* ----- Dia ----- */
  const dayWindow = useMemo(() => localDayWindow(date, timeZone), [date, timeZone]);
  const dayQuery = useQuery({
    queryKey: ['appointments', 'day', date, timeZone],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        from: dayWindow.from,
        to: dayWindow.to,
        pageSize: PAGE_SIZE_MAX,
        sort: 'startsAt',
        order: 'asc',
      }),
    enabled: view === 'day',
  });

  /* ----- Semana (tambem alimenta a faixa de dias da visao Dia) ----- */
  const weekStart = useMemo(() => startOfWeek(date), [date]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index)), [weekStart]);
  const weekWindow = useMemo(
    () => ({ from: localDayWindow(weekStart, timeZone).from, to: localDayWindow(weekDays[6]!, timeZone).to }),
    [weekStart, weekDays, timeZone],
  );
  const weekQuery = useQuery({
    queryKey: ['appointments', 'week', weekStart, timeZone],
    queryFn: () => fetchRange(weekWindow.from, weekWindow.to),
    enabled: view === 'week' || view === 'day',
  });
  const weekByDay = useMemo(
    () => groupByLocalDay(weekQuery.data ?? [], weekDays, timeZone),
    [weekQuery.data, weekDays, timeZone],
  );
  const weekCounts = useMemo(() => {
    if (!weekQuery.data) return null;
    const counts = new Map<string, number>();
    for (const [day, list] of weekByDay) counts.set(day, list.length);
    return counts;
  }, [weekQuery.data, weekByDay]);

  /* ----- Mes ----- */
  const monthStart = startOfMonth(date);
  const monthGridStart = startOfWeek(monthStart);
  const monthGridDays = useMemo(() => {
    const last = endOfMonth(monthStart);
    const days: string[] = [];
    let cursor = monthGridStart;
    while (cursor <= last || days.length % 7 !== 0) {
      days.push(cursor);
      cursor = shiftDate(cursor, 1);
    }
    return days;
  }, [monthStart, monthGridStart]);
  const monthQuery = useQuery({
    queryKey: ['appointments', 'month', monthStart, timeZone],
    queryFn: () =>
      fetchRange(localDayWindow(monthStart, timeZone).from, localDayWindow(endOfMonth(monthStart), timeZone).to),
    enabled: view === 'month',
  });
  const monthByDay = useMemo(
    () => groupByLocalDay(monthQuery.data ?? [], monthGridDays, timeZone),
    [monthQuery.data, monthGridDays, timeZone],
  );

  /* ----- Lista ----- */
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

  const dayItems = useMemo(() => dayQuery.data?.data ?? [], [dayQuery.data]);
  const dayStatusCounts = useMemo(() => {
    const counts = new Map<AppointmentStatus, number>();
    for (const item of dayItems) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return counts;
  }, [dayItems]);
  const filteredDayItems = statusFilter === 'ALL' ? dayItems : dayItems.filter((item) => item.status === statusFilter);

  function navigate(direction: -1 | 1): void {
    setDate((current) =>
      view === 'month' ? shiftMonth(current, direction) : shiftDate(current, view === 'day' ? direction : direction * 7),
    );
  }

  const periodLabel =
    view === 'day'
      ? labelFor(date, { weekday: 'long', day: 'numeric', month: 'long' })
      : view === 'week'
        ? `${labelFor(weekDays[0]!, { day: 'numeric', month: 'short' })} – ${labelFor(weekDays[6]!, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : labelFor(monthStart, { month: 'long', year: 'numeric' });

  const newButton = canWrite ? (
    <Button icon={<CalendarPlus className="size-4" />} onClick={() => setDrawerOpen(true)} className="max-sm:hidden">
      Novo agendamento
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Agenda" description="Atendimentos do dia, da semana e do mês." action={newButton} />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.appointments} entry={usage} /> : null}

      {/* Barra de controle: visualizacao + periodo */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedControl
          label="Visualização da agenda"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          className="w-full md:w-auto"
        />

        {view !== 'list' ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Período anterior" onClick={() => navigate(-1)}>
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold first-letter:uppercase md:min-w-52" aria-live="polite">
              {periodLabel}
            </p>
            <Button variant="secondary" size="icon" aria-label="Próximo período" onClick={() => navigate(1)}>
              <ChevronRight aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDate(today)}
              disabled={view === 'month' ? startOfMonth(today) === monthStart : view === 'week' ? weekDays.includes(today) : date === today}
            >
              Hoje
            </Button>
          </div>
        ) : null}
      </div>

      {/* ============================ DIA ============================ */}
      {view === 'day' ? (
        <>
          <DayStrip days={weekDays} selected={date} today={today} counts={weekCounts} onSelect={setDate} />

          {dayQuery.isLoading ? <ListSkeleton label="Carregando agenda do dia" /> : null}
          {dayQuery.isError ? <QueryError error={dayQuery.error} onRetry={() => void dayQuery.refetch()} /> : null}

          {dayQuery.data && dayItems.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title={date === today ? 'Nenhum atendimento hoje' : 'Nenhum atendimento neste dia'}
                description="Os horários agendados aparecem aqui, em ordem."
                action={
                  canWrite ? (
                    <Button icon={<CalendarPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
                      Novo agendamento
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : null}

          {dayItems.length > 0 ? (
            <>
              <div className="scroll-x -mx-4 mb-3 flex gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filtrar por status">
                <FilterChip active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} count={dayItems.length}>
                  Todos
                </FilterChip>
                {APPOINTMENT_STATUS_ORDER.filter((status) => dayStatusCounts.has(status)).map((status) => (
                  <FilterChip
                    key={status}
                    active={statusFilter === status}
                    onClick={() => setStatusFilter(status)}
                    count={dayStatusCounts.get(status)}
                  >
                    {APPOINTMENT_STATUS_LABELS[status]}
                  </FilterChip>
                ))}
              </div>

              <ul className="flex flex-col gap-2.5">
                {filteredDayItems.map((appointment) => (
                  <li key={appointment.id}>
                    <AppointmentCard
                      appointment={appointment}
                      timeZone={timeZone}
                      actions={<AppointmentStatusActions appointment={appointment} />}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      {/* ============================ SEMANA ============================ */}
      {view === 'week' && weekQuery.isLoading ? <ListSkeleton label="Carregando agenda da semana" rows={3} /> : null}
      {view === 'week' && weekQuery.isError ? <QueryError error={weekQuery.error} onRetry={() => void weekQuery.refetch()} /> : null}
      {view === 'week' && weekQuery.data ? (
        <div className="grid gap-2.5 md:grid-cols-7 md:gap-2">
          {weekDays.map((day) => {
            const items = weekByDay.get(day) ?? [];
            const isToday = day === today;
            return (
              <section
                key={day}
                aria-label={labelFor(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                className={cn(
                  'flex flex-col rounded-[var(--radius-lg)] border bg-[var(--color-surface)] md:min-h-72',
                  isToday ? 'border-[var(--color-brand-border)] ring-1 ring-[var(--color-brand-border)]' : 'border-[var(--color-border)]',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDate(day);
                    setView('day');
                  }}
                  className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3.5 py-3 text-left hover:bg-[var(--color-surface-hover)] md:flex-col md:items-start md:gap-0.5"
                >
                  <span className="flex items-baseline gap-2 md:flex-col md:gap-0">
                    <span className={cn('text-[0.6875rem] font-semibold uppercase', isToday ? 'text-[var(--color-brand-text)]' : 'text-[var(--color-text-subtle)]')}>
                      {labelFor(day, { weekday: 'short' }).replace('.', '')}
                    </span>
                    <span className="tabular text-lg leading-tight font-semibold">{Number(day.slice(8))}</span>
                  </span>
                  <span className="text-[0.75rem] text-[var(--color-text-muted)]">
                    <span className="tabular font-semibold text-[var(--color-text)]">{items.length}</span>{' '}
                    {items.length === 1 ? 'atendimento' : 'atendimentos'}
                  </span>
                </button>
                {items.length > 0 ? (
                  <ul className="flex flex-col gap-1 p-2">
                    {items.slice(0, 6).map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-[0.75rem]"
                      >
                        <span aria-hidden className="h-6 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: APPOINTMENT_STATUS_ACCENTS[item.status] }} />
                        <span className="min-w-0 flex-1">
                          <span className="tabular block font-semibold">{formatTime(item.startsAt, timeZone)}</span>
                          <span className="block truncate text-[var(--color-text-muted)]">{item.petName}</span>
                        </span>
                      </li>
                    ))}
                    {items.length > 6 ? (
                      <li className="px-2 py-1 text-[0.75rem] font-medium text-[var(--color-text-muted)]">+{items.length - 6} atendimentos</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="hidden p-3 text-[0.75rem] text-[var(--color-text-subtle)] md:block">Livre</p>
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      {/* ============================ MES ============================ */}
      {view === 'month' && monthQuery.isLoading ? <Skeleton className="h-96 w-full rounded-[var(--radius-lg)]" /> : null}
      {view === 'month' && monthQuery.isError ? <QueryError error={monthQuery.error} onRetry={() => void monthQuery.refetch()} /> : null}
      {view === 'month' && monthQuery.data ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)]" aria-hidden>
            {monthGridDays.slice(0, 7).map((day) => (
              <span key={day} className="py-2 text-center text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase">
                {labelFor(day, { weekday: 'short' }).replace('.', '')}
              </span>
            ))}
          </div>
          <ul className="grid grid-cols-7">
            {monthGridDays.map((day, index) => {
              const items = monthByDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === monthStart.slice(0, 7);
              const isToday = day === today;
              return (
                <li
                  key={day}
                  className={cn(
                    'border-[var(--color-border)]',
                    index % 7 !== 0 && 'border-l',
                    index >= 7 && 'border-t',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDate(day);
                      setView('day');
                    }}
                    aria-label={`${labelFor(day, { day: 'numeric', month: 'long' })}: ${items.length} atendimentos`}
                    className={cn(
                      'flex h-full min-h-16 w-full flex-col items-center gap-1 p-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] sm:min-h-28 sm:items-stretch sm:p-2',
                      !inMonth && 'bg-[var(--color-canvas)] text-[var(--color-text-subtle)]',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular flex size-7 items-center justify-center rounded-full text-[0.8125rem] font-semibold',
                        isToday && 'bg-[var(--color-brand)] text-white',
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    {items.length > 0 ? (
                      <>
                        <span className="tabular rounded-full bg-[var(--color-brand-subtle)] px-1.5 text-[0.6875rem] font-semibold text-[var(--color-brand-text)] sm:hidden">
                          {items.length}
                        </span>
                        <span className="hidden flex-col gap-0.5 sm:flex">
                          {items.slice(0, 2).map((item) => (
                            <span key={item.id} className="truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-[0.6875rem]">
                              <span className="tabular font-semibold">{formatTime(item.startsAt, timeZone)}</span> {item.petName}
                            </span>
                          ))}
                          {items.length > 2 ? (
                            <span className="px-1.5 text-[0.6875rem] font-medium text-[var(--color-text-muted)]">+{items.length - 2}</span>
                          ) : null}
                        </span>
                      </>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* ============================ LISTA ============================ */}
      {view === 'list' ? (
        <>
          {listQuery.isLoading ? <ListSkeleton label="Carregando agendamentos" rows={6} /> : null}
          {listQuery.isError ? <QueryError error={listQuery.error} onRetry={() => void listQuery.refetch()} /> : null}
          {listQuery.data && listQuery.data.data.length === 0 ? (
            <Card>
              <EmptyState icon={<CalendarDays className="size-5" />} title="Nenhum agendamento ainda" />
            </Card>
          ) : null}
          {listQuery.data && listQuery.data.data.length > 0 ? (
            <>
              <ul className="flex flex-col gap-2.5">
                {listQuery.data.data.map((appointment) => (
                  <li key={appointment.id}>
                    <AppointmentCard
                      appointment={appointment}
                      showDate
                      timeZone={timeZone}
                      actions={<AppointmentStatusActions appointment={appointment} />}
                    />
                  </li>
                ))}
              </ul>
              {listQuery.data.pagination.totalPages > 1 ? (
                <Card className="mt-3">
                  <Pagination pagination={listQuery.data.pagination} onPageChange={setListPage} />
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {view === 'day' && dayQuery.data ? `${dayItems.length} atendimentos em ${formatDateLong(dayWindow.from, timeZone)}` : ''}
      </p>

      <AppointmentFormDrawer
        open={drawerOpen}
        defaultCustomerId={defaultCustomerId}
        defaultDate={date}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
