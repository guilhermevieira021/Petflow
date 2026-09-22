import { buildPagination, type Paginated, type RetentionEntryDto, type RetentionQuery } from '@petflow/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { toCount, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { customers } from '../../db/schema/index.js';
import { getTenant } from '../tenants/tenants.service.js';

/**
 * Clientes candidatos a recuperacao: ja foram atendidos, nao tem nenhum
 * agendamento futuro em aberto, e o ultimo atendimento passou do limite de
 * dias (configuravel por tenant, ou informado na propria consulta).
 */
export async function listRetentionCandidates(
  tx: Transaction,
  context: TenantContext,
  query: RetentionQuery,
): Promise<Paginated<RetentionEntryDto>> {
  const tenant = await getTenant(tx, context);
  const days = query.days ?? tenant.settings.inactiveCustomerDays;
  const cutoff = sql<Date>`now() - (${days} || ' days')::interval`;

  // Sempre nao-nulo aqui: o EXISTS abaixo ja garante ao menos um atendimento
  // concluido antes de qualquer linha chegar a esta consulta.
  const lastVisit = sql<Date>`(
    SELECT max(a.starts_at) FROM appointments a
    WHERE a.customer_id = ${customers.id} AND a.status = 'COMPLETED'
  )`;

  const where = and(
    eq(customers.tenantId, context.tenantId),
    eq(customers.active, true),
    isNull(customers.deletedAt),
    sql`EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = ${customers.id} AND a.status = 'COMPLETED')`,
    sql`NOT EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.customer_id = ${customers.id}
        AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
        AND a.starts_at >= now()
    )`,
    sql`(${lastVisit}) < ${cutoff}`,
  );

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(customers).where(where);

  const rows = await tx
    .select({
      customerId: customers.id,
      customerName: customers.name,
      customerWhatsapp: customers.whatsapp,
      lastVisitAt: lastVisit,
      petNames: sql<string[]>`(
        SELECT coalesce(array_agg(p.name ORDER BY p.name), ARRAY[]::text[])
        FROM pets p WHERE p.customer_id = ${customers.id} AND p.deleted_at IS NULL
      )`,
    })
    .from(customers)
    .where(where)
    .orderBy(asc(lastVisit))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const now = Date.now();

  return {
    data: rows.map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      customerWhatsapp: row.customerWhatsapp,
      petNames: row.petNames,
      lastVisitAt: toIsoRequired(row.lastVisitAt),
      daysSinceLastVisit: Math.floor((now - row.lastVisitAt.getTime()) / (24 * 60 * 60 * 1000)),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}
