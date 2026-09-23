import {
  AuditAction,
  AuditEntity,
  buildPagination,
  hasPermission,
  LimitKey,
  Permission,
  type CreatePetInput,
  type ListPetsQuery,
  type Paginated,
  type PetDto,
  type PetWithCustomerDto,
  type Role,
  type UpdatePetInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from '../../core/errors.js';
import { toCount, toDateOnly, toIso, toIsoRequired, toNullableNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { customers, pets } from '../../db/schema/index.js';
import { assertActiveAccess, assertWithinLimit } from '../billing/billing.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertCustomerExists } from '../customers/customers.service.js';

/**
 * Ver comentario equivalente em customers.service.ts: driver devolve Date,
 * nao string. Correlacao com `pets.id` LITERAL (texto SQL), nunca
 * `${pets.id}` interpolado -- ver comentario completo do porque em
 * customers.service.ts (LAST_VISIT_SQL).
 */
const LAST_VISIT_SQL = sql<Date | null>`(
  SELECT max(a.starts_at) FROM appointments a
  WHERE a.pet_id = pets.id AND a.status = 'COMPLETED'
)`;

function toDto(row: typeof pets.$inferSelect): PetDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    name: row.name,
    species: row.species,
    breed: row.breed,
    sex: row.sex,
    birthDate: toDateOnly(row.birthDate),
    weightKg: toNullableNumber(row.weightKg),
    color: row.color,
    notes: row.notes,
    active: row.active,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listPets(
  tx: Transaction,
  context: TenantContext,
  query: ListPetsQuery,
): Promise<Paginated<PetWithCustomerDto>> {
  const filters: SQL[] = [eq(pets.tenantId, context.tenantId), isNull(pets.deletedAt)];
  if (query.customerId) filters.push(eq(pets.customerId, query.customerId));
  if (query.species) filters.push(eq(pets.species, query.species));
  if (query.active !== undefined) filters.push(eq(pets.active, query.active));
  if (query.search) {
    const term = `%${query.search}%`;
    const searchFilter = or(ilike(pets.name, term), ilike(customers.name, term));
    if (searchFilter) filters.push(searchFilter);
  }
  const where = and(...filters);

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(pets)
    .innerJoin(customers, eq(customers.id, pets.customerId))
    .where(where);

  const orderColumn = query.sort === 'createdAt' ? pets.createdAt : pets.name;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await tx
    .select({
      pet: pets,
      customerName: customers.name,
      customerWhatsapp: customers.whatsapp,
      lastVisitAt: LAST_VISIT_SQL,
    })
    .from(pets)
    .innerJoin(customers, eq(customers.id, pets.customerId))
    .where(where)
    .orderBy(orderFn(orderColumn), asc(pets.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => ({
      ...toDto(row.pet),
      customerName: row.customerName,
      customerWhatsapp: row.customerWhatsapp,
      lastVisitAt: toIso(row.lastVisitAt),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getPet(
  tx: Transaction,
  context: TenantContext,
  petId: string,
): Promise<PetWithCustomerDto> {
  const [row] = await tx
    .select({
      pet: pets,
      customerName: customers.name,
      customerWhatsapp: customers.whatsapp,
      lastVisitAt: LAST_VISIT_SQL,
    })
    .from(pets)
    .innerJoin(customers, eq(customers.id, pets.customerId))
    .where(and(eq(pets.id, petId), eq(pets.tenantId, context.tenantId), isNull(pets.deletedAt)))
    .limit(1);

  if (!row) throw new NotFoundError('Pet');

  return {
    ...toDto(row.pet),
    customerName: row.customerName,
    customerWhatsapp: row.customerWhatsapp,
    lastVisitAt: toIso(row.lastVisitAt),
  };
}

/** Garante que o pet existe, pertence ao tenant e, se informado, ao cliente esperado. */
export async function assertPetBelongsToCustomer(
  tx: Transaction,
  context: TenantContext,
  petId: string,
  customerId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: pets.id })
    .from(pets)
    .where(
      and(
        eq(pets.id, petId),
        eq(pets.customerId, customerId),
        eq(pets.tenantId, context.tenantId),
        isNull(pets.deletedAt),
      ),
    )
    .limit(1);

  // Mensagem generica de "nao encontrado": nao confirmamos se o pet existe
  // vinculado a OUTRO cliente, o que vazaria estrutura de dados alheia.
  if (!row) throw new NotFoundError('Pet');
}

export async function createPet(
  tx: Transaction,
  context: TenantContext,
  input: CreatePetInput,
): Promise<PetDto> {
  await assertActiveAccess(tx, context);
  await assertCustomerExists(tx, context, input.customerId);
  await assertWithinLimit(tx, context, LimitKey.PETS);

  const [row] = await tx
    .insert(pets)
    .values({
      tenantId: context.tenantId,
      customerId: input.customerId,
      name: input.name,
      species: input.species,
      breed: input.breed ?? null,
      sex: input.sex ?? 'UNKNOWN',
      birthDate: input.birthDate ?? null,
      weightKg: input.weightKg != null ? input.weightKg.toFixed(2) : null,
      color: input.color ?? null,
      notes: input.notes,
    })
    .returning();

  if (!row) throw new Error('Falha ao criar pet.');

  await recordAudit(tx, context, {
    action: AuditAction.PET_CREATED,
    entity: AuditEntity.PET,
    entityId: row.id,
    metadata: { name: input.name, customerId: input.customerId },
  });

  return toDto(row);
}

export async function updatePet(
  tx: Transaction,
  context: TenantContext,
  actorRole: Role,
  petId: string,
  input: UpdatePetInput,
): Promise<PetDto> {
  const [existing] = await tx
    .select({ id: pets.id })
    .from(pets)
    .where(and(eq(pets.id, petId), eq(pets.tenantId, context.tenantId), isNull(pets.deletedAt)))
    .limit(1);
  if (!existing) throw new NotFoundError('Pet');

  if (input.active === false && !hasPermission(actorRole, Permission.PETS_DELETE)) {
    throw new ForbiddenError('Voce nao possui permissao para desativar pets.');
  }
  if (Object.keys(input).some((key) => key !== 'active')) {
    await assertActiveAccess(tx, context);
  }

  const patch: Partial<typeof pets.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.species !== undefined) patch.species = input.species;
  if (input.breed !== undefined) patch.breed = input.breed;
  if (input.sex !== undefined) patch.sex = input.sex;
  if (input.birthDate !== undefined) patch.birthDate = input.birthDate;
  if (input.weightKg !== undefined) patch.weightKg = input.weightKg != null ? input.weightKg.toFixed(2) : null;
  if (input.color !== undefined) patch.color = input.color;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.active !== undefined) patch.active = input.active;

  await tx.update(pets).set(patch).where(and(eq(pets.id, petId), eq(pets.tenantId, context.tenantId)));

  await recordAudit(tx, context, {
    action: input.active === false ? AuditAction.PET_DELETED : AuditAction.PET_UPDATED,
    entity: AuditEntity.PET,
    entityId: petId,
    metadata: { fields: Object.keys(input) },
  });

  const [row] = await tx.select().from(pets).where(eq(pets.id, petId)).limit(1);
  if (!row) throw new NotFoundError('Pet');
  return toDto(row);
}
