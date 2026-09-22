import {
  AuditAction,
  AuditEntity,
  buildPagination,
  type CreateMessageInput,
  type ListMessagesQuery,
  type MessageDto,
  type Paginated,
} from '@petflow/contracts';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { toCount, toIso, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { customers, messages, pets } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertCustomerExists } from '../customers/customers.service.js';
import { assertPetBelongsToCustomer } from '../pets/pets.service.js';

function toDto(row: {
  message: typeof messages.$inferSelect;
  customerName: string;
  petName: string | null;
}): MessageDto {
  return {
    id: row.message.id,
    tenantId: row.message.tenantId,
    customerId: row.message.customerId,
    customerName: row.customerName,
    petId: row.message.petId,
    petName: row.petName,
    appointmentId: row.message.appointmentId,
    type: row.message.type,
    channel: row.message.channel,
    content: row.message.content,
    status: row.message.status,
    sentAt: toIso(row.message.sentAt),
    createdAt: toIsoRequired(row.message.createdAt),
  };
}

export async function listMessages(
  tx: Transaction,
  context: TenantContext,
  query: ListMessagesQuery,
): Promise<Paginated<MessageDto>> {
  const filters: SQL[] = [eq(messages.tenantId, context.tenantId)];
  if (query.type) filters.push(eq(messages.type, query.type));
  if (query.status) filters.push(eq(messages.status, query.status));
  if (query.customerId) filters.push(eq(messages.customerId, query.customerId));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(messages).where(where);

  const rows = await tx
    .select({ message: messages, customerName: customers.name, petName: pets.name })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .leftJoin(pets, eq(pets.id, messages.petId))
    .where(where)
    .orderBy(desc(messages.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

/**
 * Registra uma mensagem preparada pelo sistema e enviada por FORA dele -- o
 * usuario clicou no link do WhatsApp e enviou manualmente pelo proprio
 * aplicativo. Por isso ela ja nasce com status `OPENED_EXTERNALLY`: nao ha
 * confirmacao de entrega possivel neste modo (`WHATSAPP_PROVIDER=link`).
 * Quando um provider de API oficial for integrado, esta funcao passa a criar
 * a mensagem em `QUEUED` e um webhook do provider atualiza o status real.
 */
export async function createMessage(
  tx: Transaction,
  context: TenantContext,
  input: CreateMessageInput,
): Promise<MessageDto> {
  await assertCustomerExists(tx, context, input.customerId);
  if (input.petId) {
    await assertPetBelongsToCustomer(tx, context, input.petId, input.customerId);
  }

  const [row] = await tx
    .insert(messages)
    .values({
      tenantId: context.tenantId,
      customerId: input.customerId,
      petId: input.petId ?? null,
      appointmentId: input.appointmentId ?? null,
      type: input.type,
      channel: input.channel,
      content: input.content,
      status: 'OPENED_EXTERNALLY',
      sentAt: new Date(),
    })
    .returning();

  if (!row) throw new Error('Falha ao registrar mensagem.');

  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_SENT,
    entity: AuditEntity.MESSAGE,
    entityId: row.id,
    metadata: { type: input.type, customerId: input.customerId },
  });

  const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, input.customerId)).limit(1);
  const petName = input.petId
    ? (await tx.select({ name: pets.name }).from(pets).where(eq(pets.id, input.petId)).limit(1))[0]?.name ?? null
    : null;

  return toDto({ message: row, customerName: customer?.name ?? '', petName });
}
