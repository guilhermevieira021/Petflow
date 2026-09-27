import {
  AuditAction,
  AuditEntity,
  createAppointmentInputSchema,
  createCustomerInputSchema,
  createPetInputSchema,
  ErrorCode,
  type AppointmentDto,
  type BookingRequestDto,
  type ListBookingRequestsQuery,
  type RejectBookingRequestInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { bookingRequests, customers, pets, services } from '../../db/schema/index.js';
import { createAppointment } from '../appointments/appointments.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { createCustomer } from '../customers/customers.service.js';
import { createPet } from '../pets/pets.service.js';

/**
 * Lado do pet shop das solicitacoes do link publico.
 *
 * Aceitar NAO pula nenhuma regra: o agendamento e criado por
 * `createAppointment` (checagem de conflito, limites do plano, acesso ativo) e
 * cliente/pet novos por `createCustomer`/`createPet` (mesmas validacoes e
 * limites do cadastro manual). Se qualquer passo falhar, nada e gravado.
 */

async function findCustomerByPhone(tx: Transaction, context: TenantContext, phone: string) {
  const [row] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        isNull(customers.deletedAt),
        or(eq(customers.phone, phone), eq(customers.whatsapp, phone)),
      ),
    )
    .orderBy(desc(customers.active), asc(customers.createdAt))
    .limit(1);
  return row ?? null;
}

async function toDto(tx: Transaction, context: TenantContext, row: typeof bookingRequests.$inferSelect, serviceName: string): Promise<BookingRequestDto> {
  const match = row.status === 'PENDING' ? await findCustomerByPhone(tx, context, row.customerPhone) : null;
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName,
    startsAt: toIsoRequired(row.startsAt),
    endsAt: toIsoRequired(row.endsAt),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    petName: row.petName,
    petSpecies: row.petSpecies,
    notes: row.notes,
    status: row.status,
    matchedCustomerId: match?.id ?? row.customerId,
    matchedCustomerName: match?.name ?? null,
    appointmentId: row.appointmentId,
    rejectionReason: row.rejectionReason,
    createdAt: toIsoRequired(row.createdAt),
  };
}

export async function listBookingRequests(
  tx: Transaction,
  context: TenantContext,
  query: ListBookingRequestsQuery,
): Promise<BookingRequestDto[]> {
  const rows = await tx
    .select({ request: bookingRequests, serviceName: services.name })
    .from(bookingRequests)
    .innerJoin(services, eq(services.id, bookingRequests.serviceId))
    .where(and(eq(bookingRequests.tenantId, context.tenantId), eq(bookingRequests.status, query.status)))
    .orderBy(query.status === 'PENDING' ? asc(bookingRequests.startsAt) : desc(bookingRequests.updatedAt))
    .limit(100);
  return Promise.all(rows.map((row) => toDto(tx, context, row.request, row.serviceName)));
}

export async function countPendingBookingRequests(tx: Transaction, context: TenantContext): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(bookingRequests)
    .where(and(eq(bookingRequests.tenantId, context.tenantId), eq(bookingRequests.status, 'PENDING')));
  return row?.value ?? 0;
}

async function lockPending(tx: Transaction, context: TenantContext, requestId: string) {
  const [row] = await tx
    .select()
    .from(bookingRequests)
    .where(and(eq(bookingRequests.id, requestId), eq(bookingRequests.tenantId, context.tenantId)))
    .limit(1)
    .for('update');
  if (!row) throw new NotFoundError('Solicitação');
  if (row.status !== 'PENDING') {
    throw new ConflictError('Esta solicitação já foi respondida.', ErrorCode.INVALID_STATUS_TRANSITION);
  }
  return row;
}

export async function acceptBookingRequest(
  tx: Transaction,
  context: TenantContext,
  requestId: string,
): Promise<{ appointment: AppointmentDto; customerId: string; petId: string }> {
  const request = await lockPending(tx, context, requestId);

  // Cliente: reaproveita quem ja tem este telefone; senao cadastra.
  const existing = await findCustomerByPhone(tx, context, request.customerPhone);
  const customerId = existing
    ? existing.id
    : (await createCustomer(tx, context, createCustomerInputSchema.parse({ name: request.customerName, phone: request.customerPhone }))).id;

  // Pet: reaproveita pet ativo do cliente com o mesmo nome; senao cadastra.
  const [pet] = await tx
    .select({ id: pets.id })
    .from(pets)
    .where(
      and(
        eq(pets.tenantId, context.tenantId),
        eq(pets.customerId, customerId),
        isNull(pets.deletedAt),
        eq(pets.active, true),
        sql`lower(btrim(${pets.name})) = lower(btrim(${request.petName}))`,
      ),
    )
    .limit(1);
  const petId = pet
    ? pet.id
    : (await createPet(tx, context, createPetInputSchema.parse({ customerId, name: request.petName, species: request.petSpecies }))).id;

  const appointment = await createAppointment(
    tx,
    context,
    createAppointmentInputSchema.parse({
      customerId,
      petId,
      serviceId: request.serviceId,
      startsAt: request.startsAt.toISOString(),
      notes: request.notes ? `Solicitado pelo link público: ${request.notes}` : 'Solicitado pelo link público.',
    }),
  );

  await tx
    .update(bookingRequests)
    .set({
      status: 'ACCEPTED',
      appointmentId: appointment.id,
      customerId,
      petId,
      decidedAt: new Date(),
      decidedBy: context.userId,
    })
    .where(eq(bookingRequests.id, requestId));

  await recordAudit(tx, context, {
    action: AuditAction.BOOKING_ACCEPTED,
    entity: AuditEntity.BOOKING_REQUEST,
    entityId: requestId,
    metadata: { appointmentId: appointment.id, newCustomer: !existing },
  });

  return { appointment, customerId, petId };
}

export async function rejectBookingRequest(
  tx: Transaction,
  context: TenantContext,
  requestId: string,
  input: RejectBookingRequestInput,
): Promise<void> {
  await lockPending(tx, context, requestId);
  await tx
    .update(bookingRequests)
    .set({ status: 'REJECTED', decidedAt: new Date(), decidedBy: context.userId, rejectionReason: input.reason ?? null })
    .where(eq(bookingRequests.id, requestId));
  await recordAudit(tx, context, {
    action: AuditAction.BOOKING_REJECTED,
    entity: AuditEntity.BOOKING_REQUEST,
    entityId: requestId,
    metadata: { reason: input.reason ?? null },
  });
}
