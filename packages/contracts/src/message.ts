import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common.js';

export const MessageType = {
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  POST_SERVICE_FOLLOWUP: 'POST_SERVICE_FOLLOWUP',
  RETURN_INVITE: 'RETURN_INVITE',
  WINBACK: 'WINBACK',
  MANUAL: 'MANUAL',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  APPOINTMENT_REMINDER: 'Lembrete de agendamento',
  APPOINTMENT_CONFIRMATION: 'Confirmacao de agendamento',
  POST_SERVICE_FOLLOWUP: 'Pos-atendimento',
  RETURN_INVITE: 'Convite de retorno',
  WINBACK: 'Recuperacao',
  MANUAL: 'Manual',
};

export const MessageChannel = { WHATSAPP: 'WHATSAPP', SMS: 'SMS', EMAIL: 'EMAIL' } as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

export const MessageStatus = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  OPENED_EXTERNALLY: 'OPENED_EXTERNALLY',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Na fila',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Falhou',
  OPENED_EXTERNALLY: 'Aberta no WhatsApp',
};

export const messageTypeSchema = z.nativeEnum(MessageType);
export const messageChannelSchema = z.nativeEnum(MessageChannel);

/**
 * Registra que uma mensagem foi preparada e enviada por fora do sistema (o
 * usuario clicou no link do WhatsApp e enviou manualmente). Nao existe rota
 * que "envie" de verdade enquanto WHATSAPP_PROVIDER=link -- ver
 * apps/api/src/integrations/whatsapp.
 */
export const createMessageInputSchema = z
  .object({
    customerId: uuidSchema,
    petId: uuidSchema.optional().nullable(),
    appointmentId: uuidSchema.optional().nullable(),
    type: messageTypeSchema,
    channel: messageChannelSchema.default('WHATSAPP'),
    content: z.string().trim().min(1, 'A mensagem nao pode ficar vazia.').max(2000),
  })
  .strict();
export type CreateMessageInput = z.infer<typeof createMessageInputSchema>;

export const listMessagesQuerySchema = paginationQuerySchema.extend({
  type: messageTypeSchema.optional(),
  status: z
    .enum(['DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'OPENED_EXTERNALLY'])
    .optional(),
  customerId: uuidSchema.optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export interface MessageDto {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  petId: string | null;
  petName: string | null;
  appointmentId: string | null;
  type: MessageType;
  channel: MessageChannel;
  content: string;
  status: MessageStatus;
  sentAt: string | null;
  createdAt: string;
}
