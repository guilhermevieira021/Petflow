import {
  AuditAction,
  AuditEntity,
  BLOCKING_STATUSES,
  buildPagination,
  canTransition,
  ErrorCode,
  LimitKey,
  type AppointmentDetailDto,
  type AppointmentDto,
  type ChangeAppointmentStatusInput,
  type CreateAppointmentInput,
  type ListAppointmentsQuery,
  type Paginated,
  type UpdateAppointmentInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired, toMoneyLiteral, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import { acquireTransactionLock, type TenantContext } from '../../db/context.js';
import { appointments, customers, pets, services, users } from '../../db/schema/index.js';
import { assertActiveAccess, assertWithinLimit } from '../billing/billing.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertCustomerExists } from '../customers/customers.service.js';
import { assertPetBelongsToCustomer } from '../pets/pets.service.js';
import { getActiveServiceOrThrow } from '../services/services.service.js';

function toDto(row: typeof appointments.$inferSelect): AppointmentDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    petId: row.petId,
    serviceId: row.serviceId,
    professionalId: row.professionalId,
    startsAt: toIsoRequired(row.startsAt),
    endsAt: toIsoRequired(row.endsAt),
    status: row.status,
    price: toNumber(row.price),
    notes: row.notes,
    cancelledAt: row.cancelledAt ? toIsoRequired(row.cancelledAt) : null,
    cancellationReason: row.cancellationReason,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

const DETAIL_COLUMNS = {
  appointment: appointments,
  customerName: customers.name,
  customerWhatsapp: customers.whatsapp,
  petName: pets.name,
  serviceName: services.name,
  serviceColor: services.color,
  professionalName: users.name,
} as const;

function toDetailDto(row: {
  appointment: typeof appointments.$inferSelect;
  customerName: string;
  customerWhatsapp: string | null;
  petName: string;
  serviceName: string;
  serviceColor: string | null;
  professionalName: string | null;
}): AppointmentDetailDto {
  return {
    ...toDto(row.appointment),
    customerName: row.customerName,
    customerWhatsapp: row.customerWhatsapp,
    petName: row.petName,
    serviceName: row.serviceName,
    serviceColor: row.serviceColor,
    professionalName: row.professionalName,
  };
}

function detailQuery(tx: Transaction) {
  return tx
    .select(DETAIL_COLUMNS)
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(pets, eq(pets.id, appointments.petId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(users, eq(users.id, appointments.professionalId));
}

async function assertProfessionalExists(
  tx: Transaction,
  context: TenantContext,
  professionalId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, professionalId),
        eq(users.tenantId, context.tenantId),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Profissional');
}

/**
 * Verifica conflito de horario dentro da mesma transacao que fez o advisory
 * lock -- por isso e seguro contra corrida: duas requisicoes simultaneas para
 * o mesmo profissional (ou para "a loja", quando nenhum profissional e
 * informado) serializam no lock, e a segunda ENXERGA o agendamento que a
 * primeira acabou de inserir.
 */
async function assertNoConflict(
  tx: Transaction,
  context: TenantContext,
  params: {
    professionalId: string | null;
    startsAt: Date;
    endsAt: Date;
    excludingAppointmentId?: string;
  },
): Promise<void> {
  const professionalFilter = params.professionalId
    ? eq(appointments.professionalId, params.professionalId)
    : isNull(appointments.professionalId);

  const filters: SQL[] = [
    eq(appointments.tenantId, context.tenantId),
    inArray(appointments.status, [...BLOCKING_STATUSES]),
    professionalFilter,
    // Duas faixas [a,b) e [c,d) se sobrepoem quando a < d E c < b.
    sql`${appointments.startsAt} < ${params.endsAt} AND ${appointments.endsAt} > ${params.startsAt}`,
  ];
  if (params.excludingAppointmentId) {
    filters.push(ne(appointments.id, params.excludingAppointmentId));
  }

  const [conflict] = await tx.select({ id: appointments.id }).from(appointments).where(and(...filters)).limit(1);

  if (conflict) {
    throw new ConflictError(
      'Esse horario ja esta ocupado. Escolha outro horario.',
      ErrorCode.TIME_SLOT_TAKEN,
    );
  }
}

function lockKey(context: TenantContext, professionalId: string | null): string {
  return `appointments:${context.tenantId}:${professionalId ?? 'shop'}`;
}

export async function listAppointments(
  tx: Transaction,
  context: TenantContext,
  query: ListAppointmentsQuery,
): Promise<Paginated<AppointmentDetailDto>> {
  const filters: SQL[] = [eq(appointments.tenantId, context.tenantId)];
  if (query.from) filters.push(gte(appointments.startsAt, new Date(query.from)));
  if (query.to) filters.push(lte(appointments.startsAt, new Date(query.to)));
  if (query.status) filters.push(inArray(appointments.status, query.status));
  if (query.customerId) filters.push(eq(appointments.customerId, query.customerId));
  if (query.petId) filters.push(eq(appointments.petId, query.petId));
  if (query.serviceId) filters.push(eq(appointments.serviceId, query.serviceId));
  if (query.professionalId) filters.push(eq(appointments.professionalId, query.professionalId));
  if (query.search) {
    const term = `%${query.search}%`;
    const searchFilter = or(ilike(customers.name, term), ilike(pets.name, term), ilike(services.name, term));
    if (searchFilter) filters.push(searchFilter);
  }
  const where = and(...filters);

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(pets, eq(pets.id, appointments.petId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(where);

  const orderColumn = query.sort === 'createdAt' ? appointments.createdAt : appointments.startsAt;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await detailQuery(tx)
    .where(where)
    .orderBy(orderFn(orderColumn), asc(appointments.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toDetailDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getAppointment(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
): Promise<AppointmentDetailDto> {
  const [row] = await detailQuery(tx)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Agendamento');
  return toDetailDto(row);
}

function assertNotInPast(startsAt: Date, allowPast: boolean): void {
  if (!allowPast && startsAt.getTime() < Date.now() - 60_000) {
    throw new BusinessRuleError(
      'Nao e possivel agendar em um horario no passado. Marque "permitir horario passado" para um lancamento retroativo.',
    );
  }
}

export async function createAppointment(
  tx: Transaction,
  context: TenantContext,
  input: CreateAppointmentInput,
): Promise<AppointmentDto> {
  await assertActiveAccess(tx, context);
  await assertWithinLimit(tx, context, LimitKey.APPOINTMENTS);

  await assertCustomerExists(tx, context, input.customerId);
  await assertPetBelongsToCustomer(tx, context, input.petId, input.customerId);
  const service = await getActiveServiceOrThrow(tx, context, input.serviceId);
  if (input.professionalId) {
    await assertProfessionalExists(tx, context, input.professionalId);
  }

  const startsAt = new Date(input.startsAt);
  assertNotInPast(startsAt, input.allowPast);
  const endsAt = input.endsAt
    ? new Date(input.endsAt)
    : new Date(startsAt.getTime() + service.durationMinutes * 60_000);

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BusinessRuleError('O horario de termino deve ser depois do horario de inicio.');
  }

  await acquireTransactionLock(tx, lockKey(context, input.professionalId ?? null));
  await assertNoConflict(tx, context, {
    professionalId: input.professionalId ?? null,
    startsAt,
    endsAt,
  });

  const price = input.price ?? toNumber(service.price);

  const [row] = await tx
    .insert(appointments)
    .values({
      tenantId: context.tenantId,
      customerId: input.customerId,
      petId: input.petId,
      serviceId: input.serviceId,
      professionalId: input.professionalId ?? null,
      startsAt,
      endsAt,
      price: toMoneyLiteral(price),
      notes: input.notes,
    })
    .returning();

  if (!row) throw new Error('Falha ao criar agendamento.');

  await recordAudit(tx, context, {
    action: AuditAction.APPOINTMENT_CREATED,
    entity: AuditEntity.APPOINTMENT,
    entityId: row.id,
    metadata: { customerId: input.customerId, petId: input.petId, startsAt: input.startsAt },
  });

  return toDto(row);
}

export async function updateAppointment(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentDto> {
  await assertActiveAccess(tx, context);

  const [current] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
    .limit(1);
  if (!current) throw new NotFoundError('Agendamento');

  if (!BLOCKING_STATUSES.includes(current.status)) {
    throw new BusinessRuleError(
      'Nao e possivel editar um atendimento ja concluido, cancelado ou marcado como falta.',
    );
  }

  let petId = current.petId;
  if (input.petId !== undefined) {
    await assertPetBelongsToCustomer(tx, context, input.petId, current.customerId);
    petId = input.petId;
  }

  let price = toNumber(current.price);
  let serviceId = current.serviceId;
  if (input.serviceId !== undefined) {
    const service = await getActiveServiceOrThrow(tx, context, input.serviceId);
    serviceId = input.serviceId;
    if (input.price === undefined) price = toNumber(service.price);
  }
  if (input.price !== undefined && input.price !== null) price = input.price;

  if (input.professionalId !== undefined && input.professionalId !== null) {
    await assertProfessionalExists(tx, context, input.professionalId);
  }
  const professionalId =
    input.professionalId !== undefined ? input.professionalId : current.professionalId;

  const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
  if (input.startsAt) assertNotInPast(startsAt, input.allowPast);
  const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BusinessRuleError('O horario de termino deve ser depois do horario de inicio.');
  }

  const timeOrProfessionalChanged =
    input.startsAt !== undefined || input.endsAt !== undefined || input.professionalId !== undefined;

  if (timeOrProfessionalChanged) {
    await acquireTransactionLock(tx, lockKey(context, professionalId));
    await assertNoConflict(tx, context, {
      professionalId,
      startsAt,
      endsAt,
      excludingAppointmentId: appointmentId,
    });
  }

  await tx
    .update(appointments)
    .set({
      petId,
      serviceId,
      professionalId,
      startsAt,
      endsAt,
      price: toMoneyLiteral(price),
      notes: input.notes !== undefined ? input.notes : current.notes,
    })
    .where(eq(appointments.id, appointmentId));

  await recordAudit(tx, context, {
    action: AuditAction.APPOINTMENT_UPDATED,
    entity: AuditEntity.APPOINTMENT,
    entityId: appointmentId,
    metadata: { fields: Object.keys(input) },
  });

  const [row] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!row) throw new NotFoundError('Agendamento');
  return toDto(row);
}

export async function changeAppointmentStatus(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
  input: ChangeAppointmentStatusInput,
): Promise<AppointmentDto> {
  const [current] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
    .limit(1);
  if (!current) throw new NotFoundError('Agendamento');

  // Cancelamento e permitido mesmo com o acesso bloqueado (o pet shop precisa
  // conseguir desmarcar); qualquer outra transicao exige acesso ativo.
  if (input.status !== 'CANCELLED') {
    await assertActiveAccess(tx, context);
  }

  if (!canTransition(current.status, input.status)) {
    throw new ConflictError(
      `Nao e possivel mudar de "${current.status}" para "${input.status}".`,
      ErrorCode.INVALID_STATUS_TRANSITION,
    );
  }

  const patch: Partial<typeof appointments.$inferInsert> = { status: input.status };
  if (input.status === 'CANCELLED') {
    patch.cancelledAt = new Date();
    patch.cancellationReason = input.reason ?? null;
  }
  if (input.status === 'COMPLETED') {
    patch.completedAt = new Date();
  }

  await tx.update(appointments).set(patch).where(eq(appointments.id, appointmentId));

  await recordAudit(tx, context, {
    action:
      input.status === 'CANCELLED' ? AuditAction.APPOINTMENT_CANCELLED : AuditAction.APPOINTMENT_STATUS_CHANGED,
    entity: AuditEntity.APPOINTMENT,
    entityId: appointmentId,
    metadata: { from: current.status, to: input.status, reason: input.reason ?? null },
  });

  const [row] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!row) throw new NotFoundError('Agendamento');
  return toDto(row);
}
