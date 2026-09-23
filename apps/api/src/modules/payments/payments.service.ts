import {
  AuditAction,
  AuditEntity,
  buildPagination,
  canTransitionPayment,
  ErrorCode,
  type ChangePaymentStatusInput,
  type CreatePaymentInput,
  type ListPaymentsQuery,
  type Paginated,
  type PaymentDto,
} from '@petflow/contracts';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIso, toIsoRequired, toMoneyLiteral, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { appointments, customers, payments } from '../../db/schema/index.js';
import { assertActiveAccess } from '../billing/billing.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertCustomerExists } from '../customers/customers.service.js';

function toDto(row: typeof payments.$inferSelect, customerName: string): PaymentDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    customerName,
    appointmentId: row.appointmentId,
    amount: toNumber(row.amount),
    method: row.method,
    status: row.status,
    paidAt: toIso(row.paidAt),
    notes: row.notes,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function detailQuery(tx: Transaction) {
  return tx
    .select({ payment: payments, customerName: customers.name })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId));
}

export async function listPayments(
  tx: Transaction,
  context: TenantContext,
  query: ListPaymentsQuery,
): Promise<Paginated<PaymentDto>> {
  const filters: SQL[] = [eq(payments.tenantId, context.tenantId)];
  if (query.customerId) filters.push(eq(payments.customerId, query.customerId));
  if (query.appointmentId) filters.push(eq(payments.appointmentId, query.appointmentId));
  if (query.status) filters.push(eq(payments.status, query.status));
  if (query.from) filters.push(gte(payments.createdAt, new Date(query.from)));
  if (query.to) filters.push(lte(payments.createdAt, new Date(query.to)));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(payments).where(where);

  const orderColumn = query.sort === 'paidAt' ? payments.paidAt : payments.createdAt;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await detailQuery(tx)
    .where(where)
    .orderBy(orderFn(orderColumn), asc(payments.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => toDto(row.payment, row.customerName)),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getPayment(tx: Transaction, context: TenantContext, paymentId: string): Promise<PaymentDto> {
  const [row] = await detailQuery(tx)
    .where(and(eq(payments.id, paymentId), eq(payments.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Pagamento');
  return toDto(row.payment, row.customerName);
}

async function assertAppointmentBelongsToCustomer(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
  customerId: string,
): Promise<typeof appointments.$inferSelect> {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.tenantId, context.tenantId),
        eq(appointments.customerId, customerId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Agendamento');
  return row;
}

export async function createPayment(
  tx: Transaction,
  context: TenantContext,
  input: CreatePaymentInput,
): Promise<PaymentDto> {
  await assertActiveAccess(tx, context);
  await assertCustomerExists(tx, context, input.customerId);

  let appointment: typeof appointments.$inferSelect | null = null;
  if (input.appointmentId) {
    appointment = await assertAppointmentBelongsToCustomer(tx, context, input.appointmentId, input.customerId);
  }

  // O schema (createPaymentInputSchema) ja garante amount OU appointmentId --
  // aqui so falta escolher qual dos dois usar.
  const amount = input.amount ?? toNumber(appointment!.price);

  const paidAt =
    input.status === 'PAID'
      ? input.paidAt
        ? new Date(input.paidAt)
        : new Date()
      : input.paidAt
        ? new Date(input.paidAt)
        : null;

  const [row] = await tx
    .insert(payments)
    .values({
      tenantId: context.tenantId,
      customerId: input.customerId,
      appointmentId: input.appointmentId ?? null,
      amount: toMoneyLiteral(amount),
      method: input.method,
      status: input.status,
      paidAt,
      notes: input.notes,
    })
    .returning();

  if (!row) throw new Error('Falha ao registrar pagamento.');

  await recordAudit(tx, context, {
    action: AuditAction.PAYMENT_RECORDED,
    entity: AuditEntity.PAYMENT,
    entityId: row.id,
    metadata: { customerId: input.customerId, appointmentId: input.appointmentId ?? null, amount, status: input.status },
  });

  return getPayment(tx, context, row.id);
}

export async function changePaymentStatus(
  tx: Transaction,
  context: TenantContext,
  paymentId: string,
  input: ChangePaymentStatusInput,
): Promise<PaymentDto> {
  await assertActiveAccess(tx, context);

  const [current] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.tenantId, context.tenantId)))
    .limit(1);
  if (!current) throw new NotFoundError('Pagamento');

  if (!canTransitionPayment(current.status, input.status)) {
    throw new ConflictError(
      `Nao e possivel mudar de "${current.status}" para "${input.status}".`,
      ErrorCode.INVALID_STATUS_TRANSITION,
    );
  }

  const patch: Partial<typeof payments.$inferInsert> = { status: input.status };
  if (input.status === 'PAID' && !current.paidAt) {
    patch.paidAt = new Date();
  }

  await tx.update(payments).set(patch).where(eq(payments.id, paymentId));

  await recordAudit(tx, context, {
    action: AuditAction.PAYMENT_STATUS_CHANGED,
    entity: AuditEntity.PAYMENT,
    entityId: paymentId,
    metadata: { from: current.status, to: input.status },
  });

  return getPayment(tx, context, paymentId);
}
