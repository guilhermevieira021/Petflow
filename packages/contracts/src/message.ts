import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common.js';

export const MessageType = {
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_CANCELLATION: 'APPOINTMENT_CANCELLATION',
  POST_SERVICE_FOLLOWUP: 'POST_SERVICE_FOLLOWUP',
  RETURN_INVITE: 'RETURN_INVITE',
  WINBACK: 'WINBACK',
  MANUAL: 'MANUAL',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  APPOINTMENT_REMINDER: 'Lembrete de agendamento',
  APPOINTMENT_CONFIRMATION: 'Confirmação de agendamento',
  APPOINTMENT_CANCELLATION: 'Cancelamento de agendamento',
  POST_SERVICE_FOLLOWUP: 'Pós-atendimento',
  RETURN_INVITE: 'Convite de retorno',
  WINBACK: 'Recuperação',
  MANUAL: 'Personalizada',
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
  // DRAFT = registrada, NAO entregue a nenhum provider (ex.: WhatsApp nao
  // conectado). Nunca exibir como "enviada".
  DRAFT: 'Registrada (não enviada)',
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
  appointmentId: uuidSchema.optional(),
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
  recipient: string | null;
  templateId: string | null;
  provider: WhatsappProviderKind | null;
  failureReason: string | null;
}

// -----------------------------------------------------------------------------
// WhatsApp: conexao, templates e envio
// -----------------------------------------------------------------------------

/** `link`: so abre wa.me (envio manual). `cloud_api`: API oficial da Meta. */
export type WhatsappProviderKind = 'link' | 'cloud_api';

export interface WhatsappStatusDto {
  provider: WhatsappProviderKind;
  /** true somente com a API oficial configurada no servidor. */
  connected: boolean;
  /** Se o pet shop autorizou mensagens automaticas (settings.automationEnabled). */
  automationEnabled: boolean;
  /** Explicacao pronta para exibir quando nao ha conexao. */
  message: string;
}

export const MessageTemplateType = {
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CANCELLATION: 'APPOINTMENT_CANCELLATION',
  RETURN_INVITE: 'RETURN_INVITE',
  CUSTOM: 'CUSTOM',
} as const;
export type MessageTemplateType = (typeof MessageTemplateType)[keyof typeof MessageTemplateType];

export const MESSAGE_TEMPLATE_TYPE_LABELS: Record<MessageTemplateType, string> = {
  APPOINTMENT_CONFIRMATION: 'Confirmação de agendamento',
  APPOINTMENT_REMINDER: 'Lembrete de agendamento',
  APPOINTMENT_CANCELLATION: 'Cancelamento',
  RETURN_INVITE: 'Mensagem de retorno',
  CUSTOM: 'Personalizada',
};

/** Tipo de mensagem registrado quando um template e usado. */
export const TEMPLATE_TO_MESSAGE_TYPE: Record<MessageTemplateType, MessageType> = {
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CANCELLATION: 'APPOINTMENT_CANCELLATION',
  RETURN_INVITE: 'RETURN_INVITE',
  CUSTOM: 'MANUAL',
};

/** Variaveis aceitas nos templates. Resolvidas no servidor com dados reais. */
export const TEMPLATE_VARIABLES = ['cliente', 'pet', 'servico', 'data', 'horario', 'petshop'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  cliente: 'Primeiro nome do cliente',
  pet: 'Nome do pet',
  servico: 'Serviço agendado',
  data: 'Data do agendamento',
  horario: 'Horário do agendamento',
  petshop: 'Nome do pet shop',
};

/** Textos padrao, usados enquanto o pet shop nao personaliza. */
export const DEFAULT_MESSAGE_TEMPLATES: Record<Exclude<MessageTemplateType, 'CUSTOM'>, { name: string; body: string }> = {
  APPOINTMENT_CONFIRMATION: {
    name: 'Confirmação de agendamento',
    body: 'Olá, {{cliente}}! O atendimento do {{pet}} ({{servico}}) está confirmado para {{data}} às {{horario}}. Até lá! — {{petshop}}',
  },
  APPOINTMENT_REMINDER: {
    name: 'Lembrete de agendamento',
    body: 'Olá, {{cliente}}! Passando para lembrar do atendimento do {{pet}} ({{servico}}) em {{data}} às {{horario}}. — {{petshop}}',
  },
  APPOINTMENT_CANCELLATION: {
    name: 'Cancelamento',
    body: 'Olá, {{cliente}}. O atendimento do {{pet}} marcado para {{data}} às {{horario}} foi cancelado. Se quiser remarcar, é só responder esta mensagem. — {{petshop}}',
  },
  RETURN_INVITE: {
    name: 'Mensagem de retorno',
    body: 'Olá, {{cliente}}! Já faz um tempinho desde a última visita do {{pet}}. Que tal agendar o próximo cuidado? — {{petshop}}',
  },
};

/** Nomes de variaveis usados no texto, na ordem em que aparecem. */
export function templateVariablesIn(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([a-z]+)\s*\}\}/g)].map((match) => match[1] ?? '');
}

const templateBodySchema = z
  .string({ required_error: 'Escreva a mensagem.' })
  .trim()
  .min(1, 'A mensagem nao pode ficar vazia.')
  .max(2000, 'A mensagem deve ter no maximo 2000 caracteres.')
  .refine(
    (body) => templateVariablesIn(body).every((name) => (TEMPLATE_VARIABLES as readonly string[]).includes(name)),
    'A mensagem usa uma variavel desconhecida. Use apenas as variaveis listadas.',
  );

export const upsertMessageTemplateInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe um nome.').max(80),
    body: templateBodySchema,
    active: z.boolean().default(true),
  })
  .strict();
export type UpsertMessageTemplateInput = z.infer<typeof upsertMessageTemplateInputSchema>;

export interface MessageTemplateDto {
  /** null quando e o texto padrao do sistema (ainda nao personalizado). */
  id: string | null;
  type: MessageTemplateType;
  name: string;
  body: string;
  active: boolean;
  isDefault: boolean;
  updatedAt: string | null;
}

export const messageTemplateTypeSchema = z.nativeEnum(MessageTemplateType, {
  errorMap: () => ({ message: 'Tipo de template invalido.' }),
});

/**
 * Envio de mensagem pelo sistema. Com a API oficial conectada, envia de
 * verdade e registra SENT/FAILED; sem conexao, REGISTRA como DRAFT e responde
 * `delivered: false` -- nunca finge envio.
 */
export const sendMessageInputSchema = z
  .object({
    customerId: uuidSchema,
    petId: uuidSchema.optional().nullable(),
    appointmentId: uuidSchema.optional().nullable(),
    /** Template automatico/padrao pelo tipo. */
    templateType: messageTemplateTypeSchema.optional(),
    /** Template personalizado (CUSTOM) especifico. */
    templateId: uuidSchema.optional().nullable(),
    /** Texto livre (mensagem personalizada sem template). */
    content: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((data) => !!data.templateType || !!data.templateId || !!data.content, {
    message: 'Escolha um template ou escreva a mensagem.',
    path: ['content'],
  });
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export interface SendMessageResultDto {
  message: MessageDto;
  /** true somente quando o provider aceitou a mensagem. */
  delivered: boolean;
  /** Texto final, com as variaveis ja substituidas. */
  content: string;
  /** Link wa.me para envio manual quando nao ha API conectada. */
  manualLink: string | null;
  notice: string;
}

export interface MessagePreviewDto {
  content: string;
  recipient: string | null;
  /** Variaveis sem dado real para preencher (ex.: sem agendamento vinculado). */
  missingVariables: string[];
}
