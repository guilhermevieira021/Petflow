import {
  type DashboardOverview,
  type DashboardRevenuePoint,
  type DashboardTodayMetrics,
  type DashboardUpcomingAppointment,
  type DashboardWeekMetrics,
} from '@petflow/contracts';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { dateRange, shiftDate, startOfWeek, toLocalDate, todayInTimeZone } from '../../core/datetime.js';
import { toCount, toIsoRequired, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { appointments, customers, payments, pets, services } from '../../db/schema/index.js';
import { getTenant } from '../tenants/tenants.service.js';

/** Janela do grafico de receita. */
const REVENUE_WINDOW_DAYS = 14;
/** Guarda-chuva contra consulta sem limite, mesmo sendo janela curta. */
const MAX_WINDOW_ROWS = 5000;
const UPCOMING_LIMIT = 8;

/**
 * Converte uma data local (YYYY-MM-DD) do tenant no instante UTC em que aquele
 * dia comeca. Fazemos isso no Postgres porque ele tem o banco de fusos
 * completo e lida com horario de verao corretamente.
 */
function localDayStart(date: string, timeZone: string) {
  return sql<Date>`(${date}::date::timestamp AT TIME ZONE ${timeZone})`;
}

export async function getOverview(
  tx: Transaction,
  context: TenantContext,
  referenceDateInput?: string,
): Promise<DashboardOverview> {
  const tenant = await getTenant(tx, context);
  const timeZone = tenant.timezone;
  const referenceDate = referenceDateInput ?? todayInTimeZone(timeZone);

  const windowStart = shiftDate(referenceDate, -(REVENUE_WINDOW_DAYS - 1));
  const weekStart = startOfWeek(referenceDate);
  const weekEnd = shiftDate(weekStart, 6);
  // A semana pode se estender ALEM de hoje (ex.: referenceDate = terca-feira
  // -> quinta/sexta/sabado ja tem agendamento marcado, mesmo sem terem
  // acontecido ainda). weekEnd e sempre >= referenceDate (referenceDate esta
  // dentro da propria semana, por definicao de startOfWeek), entao o fim da
  // leitura precisa cobrir ate o fim da semana, nao so ate hoje.
  const readEndExclusive = shiftDate(weekEnd, 1);

  // Uma unica leitura cobre as metricas do dia, da semana E a serie de 14
  // dias: evita repetir a mesma varredura por indice varias vezes (e evita
  // N+1).
  const windowAppointments = await tx
    .select({
      startsAt: appointments.startsAt,
      status: appointments.status,
      price: appointments.price,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, context.tenantId),
        gte(appointments.startsAt, localDayStart(windowStart, timeZone)),
        lt(appointments.startsAt, localDayStart(readEndExclusive, timeZone)),
      ),
    )
    .limit(MAX_WINDOW_ROWS);

  const windowPayments = await tx
    .select({ paidAt: payments.paidAt, amount: payments.amount })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, context.tenantId),
        eq(payments.status, 'PAID'),
        gte(payments.paidAt, localDayStart(windowStart, timeZone)),
        lt(payments.paidAt, localDayStart(readEndExclusive, timeZone)),
      ),
    )
    .limit(MAX_WINDOW_ROWS);

  const today = buildTodayMetrics(windowAppointments, windowPayments, referenceDate, timeZone);
  const week = buildWeekMetrics(windowAppointments, windowPayments, weekStart, weekEnd, timeZone);
  const revenueSeries = buildRevenueSeries(
    windowAppointments,
    windowPayments,
    windowStart,
    referenceDate,
    timeZone,
  );

  const upcoming = await findUpcomingAppointments(tx, context, referenceDate, timeZone);
  const customerMetrics = await buildCustomerMetrics(
    tx,
    context,
    referenceDate,
    timeZone,
    tenant.settings.inactiveCustomerDays,
  );
  const pendingReturns = await countPendingReturns(tx, context);

  return {
    referenceDate,
    timezone: timeZone,
    today,
    week,
    customers: customerMetrics,
    pendingReturns,
    upcoming,
    revenueSeries,
  };
}

type WindowAppointment = { startsAt: Date; status: string; price: string };
type WindowPayment = { paidAt: Date | null; amount: string };

function buildTodayMetrics(
  windowAppointments: WindowAppointment[],
  windowPayments: WindowPayment[],
  referenceDate: string,
  timeZone: string,
): DashboardTodayMetrics {
  const metrics: DashboardTodayMetrics = {
    total: 0,
    scheduled: 0,
    confirmed: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    expectedRevenue: 0,
    receivedRevenue: 0,
  };

  for (const row of windowAppointments) {
    if (toLocalDate(row.startsAt, timeZone) !== referenceDate) continue;
    metrics.total += 1;
    switch (row.status) {
      case 'SCHEDULED':
        metrics.scheduled += 1;
        break;
      case 'CONFIRMED':
        metrics.confirmed += 1;
        break;
      case 'IN_PROGRESS':
        metrics.inProgress += 1;
        break;
      case 'COMPLETED':
        metrics.completed += 1;
        break;
      case 'CANCELLED':
        metrics.cancelled += 1;
        break;
      case 'NO_SHOW':
        metrics.noShow += 1;
        break;
      default:
        break;
    }
    // Cancelado e no-show nao entram na previsao: nao ha receita a esperar.
    if (row.status !== 'CANCELLED' && row.status !== 'NO_SHOW') {
      metrics.expectedRevenue += toNumber(row.price);
    }
  }

  for (const payment of windowPayments) {
    if (!payment.paidAt) continue;
    if (toLocalDate(payment.paidAt, timeZone) !== referenceDate) continue;
    metrics.receivedRevenue += toNumber(payment.amount);
  }

  metrics.expectedRevenue = round2(metrics.expectedRevenue);
  metrics.receivedRevenue = round2(metrics.receivedRevenue);
  return metrics;
}

/**
 * Mesma regra de `buildTodayMetrics` (cancelado/no-show fora do previsto,
 * pagamento por `paidAt`), so que somando a semana de calendario inteira
 * (domingo a sabado) em vez de um unico dia -- para "previsto na semana" e
 * "recebido na semana" nunca poderem divergir de como "hoje" e calculado.
 */
function buildWeekMetrics(
  windowAppointments: WindowAppointment[],
  windowPayments: WindowPayment[],
  weekStart: string,
  weekEnd: string,
  timeZone: string,
): DashboardWeekMetrics {
  let expectedRevenue = 0;
  let receivedRevenue = 0;

  for (const row of windowAppointments) {
    if (row.status === 'CANCELLED' || row.status === 'NO_SHOW') continue;
    const day = toLocalDate(row.startsAt, timeZone);
    if (day < weekStart || day > weekEnd) continue;
    expectedRevenue += toNumber(row.price);
  }

  for (const payment of windowPayments) {
    if (!payment.paidAt) continue;
    const day = toLocalDate(payment.paidAt, timeZone);
    if (day < weekStart || day > weekEnd) continue;
    receivedRevenue += toNumber(payment.amount);
  }

  return {
    weekStart,
    weekEnd,
    expectedRevenue: round2(expectedRevenue),
    receivedRevenue: round2(receivedRevenue),
  };
}

function buildRevenueSeries(
  windowAppointments: WindowAppointment[],
  windowPayments: WindowPayment[],
  windowStart: string,
  referenceDate: string,
  timeZone: string,
): DashboardRevenuePoint[] {
  const expected = new Map<string, number>();
  const received = new Map<string, number>();

  for (const row of windowAppointments) {
    if (row.status === 'CANCELLED' || row.status === 'NO_SHOW') continue;
    const day = toLocalDate(row.startsAt, timeZone);
    expected.set(day, (expected.get(day) ?? 0) + toNumber(row.price));
  }

  for (const payment of windowPayments) {
    if (!payment.paidAt) continue;
    const day = toLocalDate(payment.paidAt, timeZone);
    received.set(day, (received.get(day) ?? 0) + toNumber(payment.amount));
  }

  // Preenche os dias sem movimento com zero: um grafico com buracos mente
  // sobre a tendencia do periodo.
  return dateRange(windowStart, referenceDate).map((date) => ({
    date,
    expected: round2(expected.get(date) ?? 0),
    received: round2(received.get(date) ?? 0),
  }));
}

async function findUpcomingAppointments(
  tx: Transaction,
  context: TenantContext,
  referenceDate: string,
  timeZone: string,
): Promise<DashboardUpcomingAppointment[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      price: appointments.price,
      customerName: customers.name,
      customerWhatsapp: customers.whatsapp,
      petName: pets.name,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(pets, eq(pets.id, appointments.petId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        eq(appointments.tenantId, context.tenantId),
        inArray(appointments.status, ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']),
        gte(appointments.startsAt, localDayStart(referenceDate, timeZone)),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(UPCOMING_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    startsAt: toIsoRequired(row.startsAt),
    endsAt: toIsoRequired(row.endsAt),
    status: row.status,
    customerName: row.customerName,
    customerWhatsapp: row.customerWhatsapp,
    petName: row.petName,
    serviceName: row.serviceName,
    price: toNumber(row.price),
  }));
}

async function buildCustomerMetrics(
  tx: Transaction,
  context: TenantContext,
  referenceDate: string,
  timeZone: string,
  inactiveThresholdDays: number,
): Promise<DashboardOverview['customers']> {
  const monthStart = `${referenceDate.slice(0, 7)}-01`;

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        eq(customers.active, true),
        isNull(customers.deletedAt),
      ),
    );

  const [newRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        isNull(customers.deletedAt),
        gte(customers.createdAt, localDayStart(monthStart, timeZone)),
      ),
    );

  // Inativo = ja foi atendido alguma vez, nao tem agendamento futuro e o
  // ultimo atendimento passou do limite configurado pelo pet shop.
  const cutoff = shiftDate(referenceDate, -inactiveThresholdDays);
  const [inactiveRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        eq(customers.active, true),
        isNull(customers.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id}
            AND a.status = 'COMPLETED'
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id}
            AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a.starts_at >= ${localDayStart(referenceDate, timeZone)}
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id}
            AND a.status = 'COMPLETED'
            AND a.starts_at >= ${localDayStart(cutoff, timeZone)}
        )`,
      ),
    );

  return {
    total: toCount(totalRow?.value),
    newThisMonth: toCount(newRow?.value),
    inactive: toCount(inactiveRow?.value),
    inactiveThresholdDays,
  };
}

/** Clientes ja atendidos que nao tem nenhum proximo agendamento marcado. */
async function countPendingReturns(tx: Transaction, context: TenantContext): Promise<number> {
  const [row] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        eq(customers.active, true),
        isNull(customers.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id} AND a.status = 'COMPLETED'
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id}
            AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a.starts_at >= now()
        )`,
      ),
    );

  return toCount(row?.value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
