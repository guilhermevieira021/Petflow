import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common.js';

export const MessageType = {
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_CANCELLATION: 'APPOINTMENT_CANCELLATION',
  APPOINTMENT_RESCHEDULE: 'APPOINTMENT_RESCHEDULE',
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
  APPOINTMENT_RESCHEDULE: 'Reagendamento',
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
  APPOINTMENT_RESCHEDULE: 'APPOINTMENT_RESCHEDULE',
  POST_SERVICE_FOLLOWUP: 'POST_SERVICE_FOLLOWUP',
  RETURN_INVITE: 'RETURN_INVITE',
  CUSTOM: 'CUSTOM',
} as const;
export type MessageTemplateType = (typeof MessageTemplateType)[keyof typeof MessageTemplateType];

export const MESSAGE_TEMPLATE_TYPE_LABELS: Record<MessageTemplateType, string> = {
  APPOINTMENT_CONFIRMATION: 'Confirmação de agendamento',
  APPOINTMENT_REMINDER: 'Lembrete de agendamento',
  APPOINTMENT_CANCELLATION: 'Cancelamento',
  APPOINTMENT_RESCHEDULE: 'Reagendamento',
  POST_SERVICE_FOLLOWUP: 'Pós-atendimento',
  RETURN_INVITE: 'Mensagem de retorno',
  CUSTOM: 'Personalizada',
};

/** Tipo de mensagem registrado quando um template e usado. */
export const TEMPLATE_TO_MESSAGE_TYPE: Record<MessageTemplateType, MessageType> = {
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CANCELLATION: 'APPOINTMENT_CANCELLATION',
  APPOINTMENT_RESCHEDULE: 'APPOINTMENT_RESCHEDULE',
  POST_SERVICE_FOLLOWUP: 'POST_SERVICE_FOLLOWUP',
  RETURN_INVITE: 'RETURN_INVITE',
  CUSTOM: 'MANUAL',
};

/**
 * Quando cada template automatico e gerado. O ENVIO e sempre separado da
 * geracao: sem WhatsApp Business API, a mensagem fica "Registrada (nao
 * enviada)" com link wa.me; lembretes agendados dependem de um worker/cron.
 */
export const MESSAGE_TEMPLATE_TRIGGERS: Record<Exclude<MessageTemplateType, 'CUSTOM'>, string> = {
  APPOINTMENT_CONFIRMATION: 'Ao confirmar um agendamento (com envio automático autorizado).',
  APPOINTMENT_REMINDER: 'Ao gerar os lembretes dos próximos atendimentos.',
  APPOINTMENT_CANCELLATION: 'Ao cancelar um agendamento (com envio automático autorizado).',
  APPOINTMENT_RESCHEDULE: 'Ao mudar a data ou o horário de um agendamento (com envio automático autorizado).',
  POST_SERVICE_FOLLOWUP: 'Ao concluir um atendimento (com envio automático autorizado).',
  RETURN_INVITE: 'Manualmente, na tela de recuperação de clientes.',
};

/** Variaveis aceitas nos templates. Resolvidas no servidor com dados reais. */
export const TEMPLATE_VARIABLES = ['nome_cliente', 'nome_pet', 'servico', 'data', 'horario', 'nome_petshop'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * Nomes antigos (Fase 2), aceitos para nao quebrar templates ja salvos.
 * Novos textos devem usar os nomes de TEMPLATE_VARIABLES.
 */
export const LEGACY_TEMPLATE_VARIABLE_ALIASES: Readonly<Record<string, TemplateVariable>> = {
  cliente: 'nome_cliente',
  pet: 'nome_pet',
  petshop: 'nome_petshop',
};

/** Nome canonico de uma variavel (resolve aliases antigos); null se desconhecida. */
export function canonicalTemplateVariable(name: string): TemplateVariable | null {
  if ((TEMPLATE_VARIABLES as readonly string[]).includes(name)) return name as TemplateVariable;
  return LEGACY_TEMPLATE_VARIABLE_ALIASES[name] ?? null;
}

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  nome_cliente: 'Primeiro nome do cliente',
  nome_pet: 'Nome do pet',
  servico: 'Serviço agendado',
  data: 'Data do agendamento',
  horario: 'Horário do agendamento',
  nome_petshop: 'Nome do pet shop',
};

/** Textos padrao, usados enquanto o pet shop nao personaliza. */
export const DEFAULT_MESSAGE_TEMPLATES: Record<Exclude<MessageTemplateType, 'CUSTOM'>, { name: string; body: string }> = {
  APPOINTMENT_CONFIRMATION: {
    name: 'Confirmação de agendamento',
    body: 'Olá, {{nome_cliente}}! O atendimento do {{nome_pet}} ({{servico}}) está confirmado para {{data}} às {{horario}}. Até lá! — {{nome_petshop}}',
  },
  APPOINTMENT_REMINDER: {
    name: 'Lembrete de agendamento',
    body: 'Olá, {{nome_cliente}}! O {{nome_pet}} tem {{servico}} agendado em {{data}} às {{horario}}. Até lá! — {{nome_petshop}}',
  },
  APPOINTMENT_CANCELLATION: {
    name: 'Cancelamento',
    body: 'Olá, {{nome_cliente}}. O atendimento do {{nome_pet}} marcado para {{data}} às {{horario}} foi cancelado. Se quiser remarcar, é só responder esta mensagem. — {{nome_petshop}}',
  },
  APPOINTMENT_RESCHEDULE: {
    name: 'Reagendamento',
    body: 'Olá, {{nome_cliente}}! O atendimento do {{nome_pet}} ({{servico}}) foi remarcado para {{data}} às {{horario}}. Qualquer dúvida, é só responder. — {{nome_petshop}}',
  },
  POST_SERVICE_FOLLOWUP: {
    name: 'Pós-atendimento',
    body: 'Olá, {{nome_cliente}}! Obrigado por trazer o {{nome_pet}} para {{servico}} hoje. Como ele ficou? — {{nome_petshop}}',
  },
  RETURN_INVITE: {
    name: 'Mensagem de retorno',
    body: 'Olá, {{nome_cliente}}! Já faz um tempinho desde a última visita do {{nome_pet}}. Que tal agendar o próximo cuidado? — {{nome_petshop}}',
  },
};

/** Nomes de variaveis usados no texto, na ordem em que aparecem. */
export function templateVariablesIn(body: string): string[] {
  return [...body.matchAll(TEMPLATE_VARIABLE_PATTERN)].map((match) => match[1] ?? '');
}

/** `{{ nome }}` -- letras minusculas e _ (ex.: {{nome_cliente}}). */
export const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Chaves soltas que nao formam uma variavel valida (ex.: "{{nome cliente}}",
 * "{{Pet}}", "{{servico" sem fechar). Viraria placeholder quebrado no texto
 * final, entao o template e recusado.
 */
export function hasMalformedPlaceholder(body: string): boolean {
  const withoutValid = body.replace(TEMPLATE_VARIABLE_PATTERN, '');
  return withoutValid.includes('{{') || withoutValid.includes('}}');
}

const templateBodySchema = z
  .string({ required_error: 'Escreva a mensagem.' })
  .trim()
  .min(1, 'A mensagem nao pode ficar vazia.')
  .max(2000, 'A mensagem deve ter no maximo 2000 caracteres.')
  .refine(
    (body) => templateVariablesIn(body).every((name) => canonicalTemplateVariable(name) !== null),
    'A mensagem usa uma variavel desconhecida. Use apenas as variaveis listadas.',
  )
  .refine((body) => !hasMalformedPlaceholder(body), 'Ha uma variavel mal escrita. Use o formato {{nome_da_variavel}}.');

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

// -----------------------------------------------------------------------------
// Lembretes: GERACAO separada do ENVIO
//
// Geracao: criar/remarcar um agendamento agenda um lembrete PENDING para
// (inicio - antecedencia). Envio: `processDueReminders` (worker/cron no
// futuro, ou o botao "Processar lembretes") gera a mensagem e registra o
// resultado real. Nada e marcado como enviado sem aceite da API.
// -----------------------------------------------------------------------------

export const ReminderStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  REGISTERED: 'REGISTERED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  PENDING: 'Agendado',
  SENT: 'Enviado pela API',
  REGISTERED: 'Registrado (não enviado)',
  FAILED: 'Falhou',
  SKIPPED: 'Não gerado',
  CANCELLED: 'Cancelado',
};

export const listRemindersQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ReminderStatus).optional(),
});
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;

export interface ReminderDto {
  id: string;
  appointmentId: string | null;
  appointmentStartsAt: string | null;
  customerId: string;
  customerName: string;
  customerWhatsapp: string | null;
  petName: string | null;
  serviceName: string | null;
  scheduledAt: string;
  status: ReminderStatus;
  /** Motivo quando SKIPPED/FAILED/CANCELLED. */
  note: string | null;
  messageId: string | null;
  /** Texto gerado (para envio manual via wa.me quando nao ha API). */
  messageContent: string | null;
  messageStatus: MessageStatus | null;
  processedAt: string | null;
}

export const processRemindersInputSchema = z
  .object({
    /**
     * Processa tambem os lembretes agendados ate N horas a frente (ex.:
     * "mandar hoje os lembretes de amanha"). Padrao: so os ja vencidos.
     */
    aheadHours: z.number().int().min(0).max(72).default(0),
  })
  .strict();
export type ProcessRemindersInput = z.infer<typeof processRemindersInputSchema>;

export interface ProcessRemindersResultDto {
  processed: number;
  /** Aceitos pela WhatsApp Business API. */
  sent: number;
  /** Mensagem gerada, mas nao enviada (API nao configurada). */
  registered: number;
  failed: number;
  skipped: number;
  /** true = WhatsApp Business API configurada no servidor. */
  providerConnected: boolean;
  notice: string;
}

export interface ReminderSchedulerStatusDto {
  /** Processamento automatico periodico (worker/cron). Ainda nao existe. */
  automaticProcessing: false;
  reminderHours: number;
  pending: number;
  dueNow: number;
  notice: string;
}
