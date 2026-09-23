import {
  AuditAction,
  AuditEntity,
  buildPagination,
  hasPermission,
  LimitKey,
  Permission,
  type CreateCustomerInput,
  type CustomerDto,
  type CustomerWithSummaryDto,
  type ListCustomersQuery,
  type Paginated,
  type Role,
  type UpdateCustomerInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors.js';
import { toCount, toDateOnly, toIso, toIsoRequired, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { customers } from '../../db/schema/index.js';
import { assertActiveAccess, assertWithinLimit } from '../billing/billing.service.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * Ultimo atendimento CONCLUIDO do cliente.
 *
 * Tipado como `Date | null`, e nao `string | null`: o driver devolve um
 * TIMESTAMPTZ agregado como objeto Date (igual a qualquer outra coluna de
 * timestamp), nao como string. A conversao para ISO 8601 acontece so na
 * fronteira do DTO, via `toIso`/`toIsoRequired` -- igual ao resto do codigo.
 */
// IMPORTANTE: a correlacao usa o literal `customers.id` (texto SQL puro),
// NUNCA `${customers.id}` interpolado. Interpolar o Column faz o Drizzle
// emitir so `"id"` sem qualificar a tabela (ele nao enxerga a subquery em
// texto puro, entao nao sabe que precisa desambiguar) -- dentro da
// subquery isso resolve para a PRIMARY KEY DA PROPRIA subquery (ex.: a.id,
// p.id), nunca para o cliente da linha externa, e a condicao vira
// "a.customer_id = a.id", que nunca bate com nada de verdade. Bug real,
// silencioso, que fazia todo cliente aparecer com 0 pets/agendamentos/gasto
// e nenhuma ultima visita -- so descoberto ao popular payments de verdade
// (ver payments.test.ts). Igual acontece com PETS_COUNT_SQL/etc. abaixo.
const LAST_VISIT_SQL = sql<Date | null>`(
  SELECT max(a.starts_at) FROM appointments a
  WHERE a.customer_id = customers.id AND a.status = 'COMPLETED'
)`;

/** Proximo atendimento que ainda ocupa a agenda. */
const NEXT_APPOINTMENT_SQL = sql<Date | null>`(
  SELECT min(a.starts_at) FROM appointments a
  WHERE a.customer_id = customers.id
    AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
    AND a.starts_at >= now()
)`;

const PETS_COUNT_SQL = sql<string>`(
  SELECT count(*) FROM pets p WHERE p.customer_id = customers.id AND p.deleted_at IS NULL
)`;

const APPOINTMENTS_COUNT_SQL = sql<string>`(
  SELECT count(*) FROM appointments a WHERE a.customer_id = customers.id AND a.status = 'COMPLETED'
)`;

const TOTAL_SPENT_SQL = sql<string>`(
  SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.customer_id = customers.id AND p.status = 'PAID'
)`;

function toDto(row: typeof customers.$inferSelect): CustomerDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    cpf: row.cpf,
    birthDate: toDateOnly(row.birthDate),
    notes: row.notes,
    active: row.active,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listCustomers(
  tx: Transaction,
  context: TenantContext,
  query: ListCustomersQuery,
): Promise<Paginated<CustomerWithSummaryDto>> {
  const filters: SQL[] = [eq(customers.tenantId, context.tenantId), isNull(customers.deletedAt)];
  if (query.active !== undefined) filters.push(eq(customers.active, query.active));
  if (query.search) {
    const term = `%${query.search}%`;
    const searchFilter = or(
      ilike(customers.name, term),
      ilike(customers.phone, term),
      ilike(customers.whatsapp, term),
      ilike(customers.email, term),
    );
    if (searchFilter) filters.push(searchFilter);
  }
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(customers).where(where);

  const orderColumn =
    query.sort === 'lastVisitAt' ? LAST_VISIT_SQL : query.sort === 'createdAt' ? customers.createdAt : customers.name;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await tx
    .select({
      customer: customers,
      lastVisitAt: LAST_VISIT_SQL,
      nextAppointmentAt: NEXT_APPOINTMENT_SQL,
      petsCount: PETS_COUNT_SQL,
      appointmentsCount: APPOINTMENTS_COUNT_SQL,
      totalSpent: TOTAL_SPENT_SQL,
    })
    .from(customers)
    .where(where)
    .orderBy(orderFn(orderColumn), asc(customers.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => ({
      ...toDto(row.customer),
      petsCount: toCount(row.petsCount),
      lastVisitAt: toIso(row.lastVisitAt),
      nextAppointmentAt: toIso(row.nextAppointmentAt),
      appointmentsCount: toCount(row.appointmentsCount),
      totalSpent: toNumber(row.totalSpent),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getCustomer(
  tx: Transaction,
  context: TenantContext,
  customerId: string,
): Promise<CustomerWithSummaryDto> {
  const [row] = await tx
    .select({
      customer: customers,
      lastVisitAt: LAST_VISIT_SQL,
      nextAppointmentAt: NEXT_APPOINTMENT_SQL,
      petsCount: PETS_COUNT_SQL,
      appointmentsCount: APPOINTMENTS_COUNT_SQL,
      totalSpent: TOTAL_SPENT_SQL,
    })
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId), isNull(customers.deletedAt)),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Cliente');

  return {
    ...toDto(row.customer),
    petsCount: toCount(row.petsCount),
    lastVisitAt: toIso(row.lastVisitAt),
    nextAppointmentAt: toIso(row.nextAppointmentAt),
    appointmentsCount: toCount(row.appointmentsCount),
    totalSpent: toNumber(row.totalSpent),
  };
}

/** Garante que o cliente existe no tenant. Usado por pets/agendamentos. */
export async function assertCustomerExists(
  tx: Transaction,
  context: TenantContext,
  customerId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId), isNull(customers.deletedAt)),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Cliente');
}

export async function createCustomer(
  tx: Transaction,
  context: TenantContext,
  input: CreateCustomerInput,
): Promise<CustomerDto> {
  await assertActiveAccess(tx, context);
  await assertWithinLimit(tx, context, LimitKey.CUSTOMERS);

  if (input.cpf) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, context.tenantId), eq(customers.cpf, input.cpf), isNull(customers.deletedAt)))
      .limit(1);
    if (existing) {
      throw new ConflictError('Ja existe um cliente cadastrado com este CPF.');
    }
  }

  const [row] = await tx
    .insert(customers)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      phone: input.phone,
      whatsapp: input.whatsapp ?? input.phone,
      email: input.email,
      cpf: input.cpf ?? null,
      birthDate: input.birthDate ?? null,
      notes: input.notes,
    })
    .returning();

  if (!row) throw new Error('Falha ao criar cliente.');

  await recordAudit(tx, context, {
    action: AuditAction.CUSTOMER_CREATED,
    entity: AuditEntity.CUSTOMER,
    entityId: row.id,
    metadata: { name: input.name },
  });

  return toDto(row);
}

export async function updateCustomer(
  tx: Transaction,
  context: TenantContext,
  actorRole: Role,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerDto> {
  await assertCustomerExists(tx, context, customerId);

  if (input.active === false && !hasPermission(actorRole, Permission.CUSTOMERS_DELETE)) {
    throw new ForbiddenError('Voce nao possui permissao para desativar clientes.');
  }
  if (Object.keys(input).some((key) => key !== 'active')) {
    await assertActiveAccess(tx, context);
  }

  if (input.cpf) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, context.tenantId),
          eq(customers.cpf, input.cpf),
          isNull(customers.deletedAt),
          sql`${customers.id} <> ${customerId}`,
        ),
      )
      .limit(1);
    if (existing) throw new ConflictError('Ja existe um cliente cadastrado com este CPF.');
  }

  const patch: Partial<typeof customers.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp;
  if (input.email !== undefined) patch.email = input.email;
  if (input.cpf !== undefined) patch.cpf = input.cpf;
  if (input.birthDate !== undefined) patch.birthDate = input.birthDate;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.active !== undefined) patch.active = input.active;

  await tx
    .update(customers)
    .set(patch)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId)));

  await recordAudit(tx, context, {
    action: input.active === false ? AuditAction.CUSTOMER_DELETED : AuditAction.CUSTOMER_UPDATED,
    entity: AuditEntity.CUSTOMER,
    entityId: customerId,
    metadata: { fields: Object.keys(input) },
  });

  const [row] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!row) throw new NotFoundError('Cliente');
  return toDto(row);
}

/** Usado pela recuperacao de clientes e pelo relatorio. Exportado para reuso. */
export { LAST_VISIT_SQL, NEXT_APPOINTMENT_SQL };
