import {
  AuditAction,
  AuditEntity,
  buildPagination,
  LimitKey,
  type CreateServiceInput,
  type ListServicesQuery,
  type Paginated,
  type ServiceDto,
  type UpdateServiceInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired, toMoneyLiteral, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { services } from '../../db/schema/index.js';
import { assertActiveAccess, assertWithinLimit } from '../billing/billing.service.js';
import { recordAudit } from '../audit/audit.service.js';

function toDto(row: typeof services.$inferSelect): ServiceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    price: toNumber(row.price),
    color: row.color,
    active: row.active,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listServices(
  tx: Transaction,
  context: TenantContext,
  query: ListServicesQuery,
): Promise<Paginated<ServiceDto>> {
  const filters: SQL[] = [eq(services.tenantId, context.tenantId), isNull(services.deletedAt)];
  if (query.active !== undefined) filters.push(eq(services.active, query.active));
  if (query.search) filters.push(ilike(services.name, `%${query.search}%`));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(services).where(where);

  const orderColumn =
    query.sort === 'price' ? services.price : query.sort === 'durationMinutes' ? services.durationMinutes : services.name;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await tx
    .select()
    .from(services)
    .where(where)
    .orderBy(orderFn(orderColumn), asc(services.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getService(
  tx: Transaction,
  context: TenantContext,
  serviceId: string,
): Promise<ServiceDto> {
  const [row] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, context.tenantId), isNull(services.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Servico');
  return toDto(row);
}

/** Usado pelos agendamentos para herdar preco/duracao e validar propriedade. */
export async function getActiveServiceOrThrow(
  tx: Transaction,
  context: TenantContext,
  serviceId: string,
): Promise<typeof services.$inferSelect> {
  const [row] = await tx
    .select()
    .from(services)
    .where(
      and(
        eq(services.id, serviceId),
        eq(services.tenantId, context.tenantId),
        eq(services.active, true),
        isNull(services.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Servico');
  return row;
}

async function assertNameAvailable(
  tx: Transaction,
  context: TenantContext,
  name: string,
  excludingId?: string,
): Promise<void> {
  const filters = [
    eq(services.tenantId, context.tenantId),
    isNull(services.deletedAt),
    sql`lower(btrim(${services.name})) = lower(btrim(${name}))`,
  ];
  if (excludingId) filters.push(sql`${services.id} <> ${excludingId}`);

  const [existing] = await tx.select({ id: services.id }).from(services).where(and(...filters)).limit(1);
  if (existing) throw new ConflictError('Ja existe um servico com este nome.');
}

export async function createService(
  tx: Transaction,
  context: TenantContext,
  input: CreateServiceInput,
): Promise<ServiceDto> {
  await assertActiveAccess(tx, context);
  await assertWithinLimit(tx, context, LimitKey.SERVICES);
  await assertNameAvailable(tx, context, input.name);

  const [row] = await tx
    .insert(services)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      price: toMoneyLiteral(input.price),
      color: input.color ?? null,
    })
    .returning();

  if (!row) throw new Error('Falha ao criar servico.');

  await recordAudit(tx, context, {
    action: AuditAction.SERVICE_CREATED,
    entity: AuditEntity.SERVICE,
    entityId: row.id,
    metadata: { name: input.name, price: input.price },
  });

  return toDto(row);
}

export async function updateService(
  tx: Transaction,
  context: TenantContext,
  serviceId: string,
  input: UpdateServiceInput,
): Promise<ServiceDto> {
  await getService(tx, context, serviceId);

  if (Object.keys(input).some((key) => key !== 'active')) {
    await assertActiveAccess(tx, context);
  }
  if (input.name !== undefined) {
    await assertNameAvailable(tx, context, input.name, serviceId);
  }

  const patch: Partial<typeof services.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes;
  if (input.price !== undefined) patch.price = toMoneyLiteral(input.price);
  if (input.color !== undefined) patch.color = input.color;
  if (input.active !== undefined) patch.active = input.active;

  await tx.update(services).set(patch).where(and(eq(services.id, serviceId), eq(services.tenantId, context.tenantId)));

  await recordAudit(tx, context, {
    action: AuditAction.SERVICE_UPDATED,
    entity: AuditEntity.SERVICE,
    entityId: serviceId,
    metadata: { fields: Object.keys(input) },
  });

  return getService(tx, context, serviceId);
}
