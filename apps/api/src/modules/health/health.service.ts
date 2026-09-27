import {
  AuditAction,
  AuditEntity,
  type CreatePetHealthRecordInput,
  type DueHealthItemDto,
  type HealthDueStatus,
  type ListDueHealthQuery,
  type PetHealthRecordDto,
  type UpdatePetHealthRecordInput,
} from '@petflow/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { shiftDate, todayInTimeZone } from '../../core/datetime.js';
import { BusinessRuleError, NotFoundError } from '../../core/errors.js';
import { toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { petHealthRecords, pets, users } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';
import { getTenant } from '../tenants/tenants.service.js';

/**
 * Historico clinico do pet. Datas sao de calendario (DATE), comparadas com o
 * "hoje" do FUSO DO PET SHOP -- vacina que vence hoje vence hoje la, nao no
 * fuso do servidor.
 */

const DUE_SOON_DAYS = 30;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function dueStatusFor(nextDueOn: string | null, today: string, soonDays = DUE_SOON_DAYS): HealthDueStatus {
  if (!nextDueOn) return 'NONE';
  if (nextDueOn < today) return 'OVERDUE';
  if (nextDueOn <= shiftDate(today, soonDays)) return 'DUE_SOON';
  return 'OK';
}

async function assertPet(tx: Transaction, context: TenantContext, petId: string): Promise<void> {
  const [pet] = await tx
    .select({ id: pets.id })
    .from(pets)
    .where(and(eq(pets.id, petId), eq(pets.tenantId, context.tenantId), isNull(pets.deletedAt)))
    .limit(1);
  if (!pet) throw new NotFoundError('Pet');
}

async function tenantToday(tx: Transaction, context: TenantContext): Promise<string> {
  const tenant = await getTenant(tx, context);
  return todayInTimeZone(tenant.timezone);
}

export async function listPetHealth(tx: Transaction, context: TenantContext, petId: string): Promise<PetHealthRecordDto[]> {
  await assertPet(tx, context, petId);
  const today = await tenantToday(tx, context);

  const rows = await tx
    .select({ record: petHealthRecords, createdByName: users.name })
    .from(petHealthRecords)
    .leftJoin(users, eq(users.id, petHealthRecords.createdBy))
    .where(
      and(
        eq(petHealthRecords.tenantId, context.tenantId),
        eq(petHealthRecords.petId, petId),
        isNull(petHealthRecords.deletedAt),
      ),
    )
    .orderBy(desc(petHealthRecords.occurredOn), desc(petHealthRecords.createdAt));

  // Um item so esta "vencido" se nao houve registro MAIS NOVO do mesmo item
  // (mesmo tipo + mesmo nome): reaplicar a V10 encerra o alerta da anterior.
  const latestKey = new Set<string>();
  return rows.map(({ record, createdByName }) => {
    const key = `${record.type}:${record.title.trim().toLowerCase()}`;
    const superseded = latestKey.has(key);
    latestKey.add(key);
    return {
      id: record.id,
      petId: record.petId,
      type: record.type,
      title: record.title,
      occurredOn: record.occurredOn,
      nextDueOn: record.nextDueOn,
      dueStatus: superseded ? 'NONE' : dueStatusFor(record.nextDueOn, today),
      notes: record.notes,
      createdByName,
      createdAt: toIsoRequired(record.createdAt),
    };
  });
}

export async function createPetHealthRecord(
  tx: Transaction,
  context: TenantContext,
  petId: string,
  input: CreatePetHealthRecordInput,
): Promise<PetHealthRecordDto> {
  await assertActiveAccess(tx, context);
  await assertPet(tx, context, petId);

  const [row] = await tx
    .insert(petHealthRecords)
    .values({
      tenantId: context.tenantId,
      petId,
      type: input.type,
      title: input.title,
      occurredOn: input.occurredOn,
      nextDueOn: input.nextDueOn ?? null,
      notes: input.notes,
      createdBy: context.userId,
    })
    .returning();
  if (!row) throw new Error('Falha ao registrar histórico.');

  await recordAudit(tx, context, {
    action: AuditAction.PET_HEALTH_RECORDED,
    entity: AuditEntity.PET_HEALTH,
    entityId: row.id,
    metadata: { petId, type: input.type, title: input.title },
  });

  const records = await listPetHealth(tx, context, petId);
  return records.find((record) => record.id === row.id)!;
}

async function findRecord(tx: Transaction, context: TenantContext, petId: string, recordId: string) {
  const [row] = await tx
    .select()
    .from(petHealthRecords)
    .where(
      and(
        eq(petHealthRecords.id, recordId),
        eq(petHealthRecords.petId, petId),
        eq(petHealthRecords.tenantId, context.tenantId),
        isNull(petHealthRecords.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Registro');
  return row;
}

export async function updatePetHealthRecord(
  tx: Transaction,
  context: TenantContext,
  petId: string,
  recordId: string,
  input: UpdatePetHealthRecordInput,
): Promise<PetHealthRecordDto> {
  await assertActiveAccess(tx, context);
  const current = await findRecord(tx, context, petId, recordId);

  const occurredOn = input.occurredOn ?? current.occurredOn;
  const nextDueOn = input.nextDueOn === undefined ? current.nextDueOn : input.nextDueOn;
  if (nextDueOn && nextDueOn < occurredOn) {
    throw new BusinessRuleError('A próxima data deve ser igual ou posterior à data do registro.');
  }

  const patch: Partial<typeof petHealthRecords.$inferInsert> = {};
  if (input.type !== undefined) patch.type = input.type;
  if (input.title !== undefined) patch.title = input.title;
  if (input.occurredOn !== undefined) patch.occurredOn = input.occurredOn;
  if (input.nextDueOn !== undefined) patch.nextDueOn = input.nextDueOn;
  if (input.notes !== undefined) patch.notes = input.notes;

  await tx.update(petHealthRecords).set(patch).where(eq(petHealthRecords.id, recordId));
  await recordAudit(tx, context, {
    action: AuditAction.PET_HEALTH_UPDATED,
    entity: AuditEntity.PET_HEALTH,
    entityId: recordId,
    metadata: { petId, fields: Object.keys(patch) },
  });

  const records = await listPetHealth(tx, context, petId);
  return records.find((record) => record.id === recordId)!;
}

/** Exclusao logica: o registro sai do historico visivel, mas nao do banco. */
export async function deletePetHealthRecord(
  tx: Transaction,
  context: TenantContext,
  petId: string,
  recordId: string,
): Promise<void> {
  await assertActiveAccess(tx, context);
  await findRecord(tx, context, petId, recordId);
  await tx.update(petHealthRecords).set({ deletedAt: new Date() }).where(eq(petHealthRecords.id, recordId));
  await recordAudit(tx, context, {
    action: AuditAction.PET_HEALTH_DELETED,
    entity: AuditEntity.PET_HEALTH,
    entityId: recordId,
    metadata: { petId },
  });
}

/**
 * Itens vencidos ou vencendo em ate N dias, considerando SO o registro mais
 * recente de cada (pet, tipo, nome) e somente pets ativos.
 */
export async function listDueHealth(
  tx: Transaction,
  context: TenantContext,
  query: ListDueHealthQuery,
): Promise<DueHealthItemDto[]> {
  const today = await tenantToday(tx, context);
  const limit = shiftDate(today, query.withinDays);

  const result = await tx.execute<{
    record_id: string;
    pet_id: string;
    pet_name: string;
    customer_id: string;
    customer_name: string;
    customer_whatsapp: string | null;
    customer_phone: string;
    type: DueHealthItemDto['type'];
    title: string;
    next_due_on: string | Date;
  }>(sql`
    SELECT latest.id AS record_id, latest.pet_id, p.name AS pet_name, c.id AS customer_id,
           c.name AS customer_name, c.whatsapp AS customer_whatsapp, c.phone AS customer_phone,
           latest.type, latest.title, latest.next_due_on
    FROM (
      SELECT DISTINCT ON (r.pet_id, r.type, lower(btrim(r.title))) r.*
      FROM pet_health_records r
      WHERE r.tenant_id = ${context.tenantId} AND r.deleted_at IS NULL
      ORDER BY r.pet_id, r.type, lower(btrim(r.title)), r.occurred_on DESC, r.created_at DESC
    ) latest
    JOIN pets p ON p.id = latest.pet_id AND p.tenant_id = latest.tenant_id
    JOIN customers c ON c.id = p.customer_id AND c.tenant_id = p.tenant_id
    WHERE latest.next_due_on IS NOT NULL
      AND latest.next_due_on <= ${limit}::date
      AND p.active AND p.deleted_at IS NULL
    ORDER BY latest.next_due_on ASC, p.name ASC
    LIMIT 500
  `);

  return result.rows.map((row) => {
    const nextDueOn = typeof row.next_due_on === 'string' ? row.next_due_on.slice(0, 10) : row.next_due_on.toISOString().slice(0, 10);
    const status = dueStatusFor(nextDueOn, today, query.withinDays);
    return {
      recordId: row.record_id,
      petId: row.pet_id,
      petName: row.pet_name,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerWhatsapp: row.customer_whatsapp ?? row.customer_phone,
      type: row.type,
      title: row.title,
      nextDueOn,
      dueStatus: status === 'OVERDUE' ? 'OVERDUE' : 'DUE_SOON',
      daysUntilDue: daysBetween(today, nextDueOn),
    };
  });
}

export async function countDueHealth(tx: Transaction, context: TenantContext): Promise<{ overdue: number; dueSoon: number }> {
  const items = await listDueHealth(tx, context, { withinDays: DUE_SOON_DAYS });
  return {
    overdue: items.filter((item) => item.dueStatus === 'OVERDUE').length,
    dueSoon: items.filter((item) => item.dueStatus === 'DUE_SOON').length,
  };
}
