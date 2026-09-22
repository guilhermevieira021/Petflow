import { FeatureKey, type ReportsOverviewDto, type ReportsQuery } from '@petflow/contracts';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { toCount, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { appointments, customers, services } from '../../db/schema/index.js';
import { getBillingStatus, hasFeature } from '../billing/billing.service.js';
import { getTenant } from '../tenants/tenants.service.js';

/** Limite ao topo de servicos mais usados. */
const TOP_SERVICES_LIMIT = 5;

export async function getReportsOverview(
  tx: Transaction,
  context: TenantContext,
  query: ReportsQuery,
): Promise<ReportsOverviewDto> {
  const from = new Date(`${query.from}T00:00:00Z`);
  const to = new Date(`${query.to}T23:59:59.999Z`);

  const billing = await getBillingStatus(tx, context);
  const advanced = hasFeature(billing.plan, FeatureKey.ADVANCED_REPORTS);
  const tenant = await getTenant(tx, context);
  const inactiveThresholdDays = tenant.settings.inactiveCustomerDays;

  const periodAppointments = await tx
    .select({ status: appointments.status, price: appointments.price, serviceId: appointments.serviceId })
    .from(appointments)
    .where(
      and(eq(appointments.tenantId, context.tenantId), gte(appointments.startsAt, from), lte(appointments.startsAt, to)),
    );

  const counts = { total: 0, completed: 0, cancelled: 0, noShow: 0 };
  let expected = 0;
  let received = 0;
  const byService = new Map<string, { count: number; revenue: number }>();

  for (const row of periodAppointments) {
    counts.total += 1;
    if (row.status === 'COMPLETED') {
      counts.completed += 1;
      received += toNumber(row.price);
      const entry = byService.get(row.serviceId) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += toNumber(row.price);
      byService.set(row.serviceId, entry);
    }
    if (row.status === 'CANCELLED') counts.cancelled += 1;
    if (row.status === 'NO_SHOW') counts.noShow += 1;
    if (row.status !== 'CANCELLED' && row.status !== 'NO_SHOW') expected += toNumber(row.price);
  }

  const [newCustomersRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(and(eq(customers.tenantId, context.tenantId), gte(customers.createdAt, from), lte(customers.createdAt, to)));

  // Recorrente = teve mais de um atendimento concluido dentro do periodo.
  const recurringResult = await tx.execute<{ value: string }>(sql`
    SELECT count(*)::text AS value FROM (
      SELECT a.customer_id
      FROM appointments a
      WHERE a.tenant_id = ${context.tenantId}
        AND a.status = 'COMPLETED'
        AND a.starts_at BETWEEN ${from} AND ${to}
      GROUP BY a.customer_id
      HAVING count(*) > 1
    ) recurring
  `);
  const recurringRow = recurringResult.rows[0];

  const [inactiveRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        eq(customers.active, true),
        sql`EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = ${customers.id} AND a.status = 'COMPLETED')`,
        sql`NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = ${customers.id}
            AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a.starts_at >= now()
        )`,
        sql`(
          SELECT max(a.starts_at) FROM appointments a
          WHERE a.customer_id = ${customers.id} AND a.status = 'COMPLETED'
        ) < now() - (${inactiveThresholdDays} || ' days')::interval`,
      ),
    );

  let topServices: ReportsOverviewDto['topServices'] = null;
  if (advanced && byService.size > 0) {
    const serviceIds = [...byService.keys()];
    const serviceRows = await tx
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(inArray(services.id, serviceIds));
    const nameById = new Map(serviceRows.map((row) => [row.id, row.name]));

    topServices = [...byService.entries()]
      .map(([serviceId, entry]) => ({
        serviceId,
        serviceName: nameById.get(serviceId) ?? 'Servico removido',
        count: entry.count,
        revenue: Math.round(entry.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_SERVICES_LIMIT);
  }

  return {
    from: query.from,
    to: query.to,
    advanced,
    appointments: counts,
    revenue: {
      expected: Math.round(expected * 100) / 100,
      received: Math.round(received * 100) / 100,
    },
    customers: {
      new: toCount(newCustomersRow?.value),
      recurring: toCount(recurringRow?.value),
      inactive: toCount(inactiveRow?.value),
    },
    topServices,
  };
}
