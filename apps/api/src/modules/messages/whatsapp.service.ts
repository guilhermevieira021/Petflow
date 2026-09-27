import {
  AuditAction,
  AuditEntity,
  DEFAULT_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_TYPE_LABELS,
  TEMPLATE_TO_MESSAGE_TYPE,
  TEMPLATE_VARIABLE_PATTERN,
  canonicalTemplateVariable,
  hasMalformedPlaceholder,
  templateVariablesIn,
  type MessageDto,
  type MessagePreviewDto,
  type MessageTemplateDto,
  type MessageTemplateType,
  type SendMessageInput,
  type TemplateVariable,
  type UpsertMessageTemplateInput,
  type WhatsappStatusDto,
} from '@petflow/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { BusinessRuleError, NotFoundError } from '../../core/errors.js';
import { toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import { withTenant, type TenantContext } from '../../db/context.js';
import { appointments, customers, messages, messageTemplates, pets, services, tenants } from '../../db/schema/index.js';
import type { WhatsappProvider } from '../../integrations/whatsapp/whatsapp.provider.js';
import { recordAudit } from '../audit/audit.service.js';
import { getTenant } from '../tenants/tenants.service.js';
import { toMessageDto } from './messages.service.js';

type AutomaticType = Exclude<MessageTemplateType, 'CUSTOM'>;
const AUTOMATIC_TYPES = Object.keys(DEFAULT_MESSAGE_TEMPLATES) as AutomaticType[];

// -----------------------------------------------------------------------------
// Status da conexao
// -----------------------------------------------------------------------------

export async function getWhatsappStatus(
  tx: Transaction,
  context: TenantContext,
  provider: WhatsappProvider,
): Promise<WhatsappStatusDto> {
  const tenant = await getTenant(tx, context);
  return {
    provider: provider.kind,
    connected: provider.configured,
    automationEnabled: tenant.settings.automationEnabled,
    message: provider.configured
      ? 'WhatsApp Business do seu pet shop conectado pela API oficial. As mensagens saem pelo seu número.'
      : 'WhatsApp não conectado. As mensagens ficam registradas como "não enviadas" e você pode enviá-las pelo link do WhatsApp. Para enviar pelo sistema, conecte o WhatsApp Business do seu pet shop em Configurações › WhatsApp.',
  };
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

function rowToTemplateDto(row: typeof messageTemplates.$inferSelect): MessageTemplateDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    body: row.body,
    active: row.active,
    isDefault: false,
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listTemplates(tx: Transaction, context: TenantContext): Promise<MessageTemplateDto[]> {
  const rows = await tx
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.tenantId, context.tenantId))
    .orderBy(asc(messageTemplates.createdAt));

  const automatic = AUTOMATIC_TYPES.map((type) => {
    const row = rows.find((candidate) => candidate.type === type);
    if (row) return rowToTemplateDto(row);
    return {
      id: null,
      type,
      name: DEFAULT_MESSAGE_TEMPLATES[type].name,
      body: DEFAULT_MESSAGE_TEMPLATES[type].body,
      active: true,
      isDefault: true,
      updatedAt: null,
    } satisfies MessageTemplateDto;
  });

  return [...automatic, ...rows.filter((row) => row.type === 'CUSTOM').map(rowToTemplateDto)];
}

/** Personaliza um template automatico (um por tipo). */
export async function upsertAutomaticTemplate(
  tx: Transaction,
  context: TenantContext,
  type: MessageTemplateType,
  input: UpsertMessageTemplateInput,
): Promise<MessageTemplateDto> {
  if (type === 'CUSTOM') throw new BusinessRuleError('Use a criacao de template personalizado para este tipo.');

  const [existing] = await tx
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.tenantId, context.tenantId), eq(messageTemplates.type, type)))
    .limit(1);

  const [row] = existing
    ? await tx
        .update(messageTemplates)
        .set({ name: input.name, body: input.body, active: input.active })
        .where(eq(messageTemplates.id, existing.id))
        .returning()
    : await tx
        .insert(messageTemplates)
        .values({ tenantId: context.tenantId, type, name: input.name, body: input.body, active: input.active })
        .returning();
  if (!row) throw new Error('Falha ao salvar template.');

  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_TEMPLATE_UPDATED,
    entity: AuditEntity.MESSAGE_TEMPLATE,
    entityId: row.id,
    metadata: { type, active: input.active },
  });
  return rowToTemplateDto(row);
}

/** Volta um tipo automatico ao texto padrao do sistema. */
export async function resetAutomaticTemplate(
  tx: Transaction,
  context: TenantContext,
  type: MessageTemplateType,
): Promise<void> {
  if (type === 'CUSTOM') throw new BusinessRuleError('Templates personalizados sao removidos pela exclusao.');
  await tx
    .delete(messageTemplates)
    .where(and(eq(messageTemplates.tenantId, context.tenantId), eq(messageTemplates.type, type)));
  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_TEMPLATE_UPDATED,
    entity: AuditEntity.MESSAGE_TEMPLATE,
    metadata: { type, reset: true },
  });
}

export async function createCustomTemplate(
  tx: Transaction,
  context: TenantContext,
  input: UpsertMessageTemplateInput,
): Promise<MessageTemplateDto> {
  const [row] = await tx
    .insert(messageTemplates)
    .values({ tenantId: context.tenantId, type: 'CUSTOM', name: input.name, body: input.body, active: input.active })
    .returning();
  if (!row) throw new Error('Falha ao salvar template.');
  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_TEMPLATE_UPDATED,
    entity: AuditEntity.MESSAGE_TEMPLATE,
    entityId: row.id,
    metadata: { type: 'CUSTOM', created: true },
  });
  return rowToTemplateDto(row);
}

async function findCustomTemplate(tx: Transaction, context: TenantContext, templateId: string) {
  const [row] = await tx
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.id, templateId),
        eq(messageTemplates.tenantId, context.tenantId),
        eq(messageTemplates.type, 'CUSTOM'),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Template');
  return row;
}

export async function updateCustomTemplate(
  tx: Transaction,
  context: TenantContext,
  templateId: string,
  input: UpsertMessageTemplateInput,
): Promise<MessageTemplateDto> {
  await findCustomTemplate(tx, context, templateId);
  const [row] = await tx
    .update(messageTemplates)
    .set({ name: input.name, body: input.body, active: input.active })
    .where(eq(messageTemplates.id, templateId))
    .returning();
  if (!row) throw new Error('Falha ao salvar template.');
  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_TEMPLATE_UPDATED,
    entity: AuditEntity.MESSAGE_TEMPLATE,
    entityId: templateId,
    metadata: { type: 'CUSTOM' },
  });
  return rowToTemplateDto(row);
}

export async function deleteCustomTemplate(tx: Transaction, context: TenantContext, templateId: string): Promise<void> {
  await findCustomTemplate(tx, context, templateId);
  await tx.delete(messageTemplates).where(eq(messageTemplates.id, templateId));
  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_TEMPLATE_UPDATED,
    entity: AuditEntity.MESSAGE_TEMPLATE,
    entityId: templateId,
    metadata: { type: 'CUSTOM', deleted: true },
  });
}

// -----------------------------------------------------------------------------
// Composicao: resolve o texto com dados REAIS do tenant
// -----------------------------------------------------------------------------

export interface Composition {
  content: string;
  recipient: string;
  missingVariables: string[];
  templateId: string | null;
  messageType: MessageDto['type'];
  customerId: string;
  petId: string | null;
  appointmentId: string | null;
}

/** Numero internacional (so digitos) para o WhatsApp: 55 + DDD + numero. */
export function toWhatsappRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
}

/**
 * Substitui as variaveis por dados reais. Aceita os nomes antigos da Fase 2
 * ({{cliente}}, {{pet}}, {{petshop}}) como sinonimos. Variavel sem dado,
 * desconhecida ou chave mal formada vai para `missing` -- quem chama NUNCA
 * registra/envia texto com placeholder sobrando.
 */
export function renderTemplate(body: string, values: Partial<Record<TemplateVariable, string>>): { content: string; missing: string[] } {
  const missing = new Set<string>();
  const content = body.replace(new RegExp(TEMPLATE_VARIABLE_PATTERN.source, 'g'), (match, name: string) => {
    const canonical = canonicalTemplateVariable(name);
    const value = canonical ? values[canonical] : undefined;
    if (value === undefined || value === '') {
      missing.add(name);
      return match;
    }
    return value;
  });
  if (hasMalformedPlaceholder(content)) missing.add('formato');
  return { content, missing: [...missing] };
}

async function resolveBody(
  tx: Transaction,
  context: TenantContext,
  input: SendMessageInput,
): Promise<{ body: string; templateId: string | null; messageType: MessageDto['type'] }> {
  if (input.templateId) {
    const row = await findCustomTemplate(tx, context, input.templateId);
    if (!row.active) throw new BusinessRuleError('Este template esta desativado.');
    return { body: row.body, templateId: row.id, messageType: 'MANUAL' };
  }
  if (input.templateType && input.templateType !== 'CUSTOM') {
    const [row] = await tx
      .select()
      .from(messageTemplates)
      .where(and(eq(messageTemplates.tenantId, context.tenantId), eq(messageTemplates.type, input.templateType)))
      .limit(1);
    if (row && !row.active) {
      throw new BusinessRuleError(`O template "${MESSAGE_TEMPLATE_TYPE_LABELS[input.templateType]}" esta desativado.`);
    }
    return {
      body: row?.body ?? DEFAULT_MESSAGE_TEMPLATES[input.templateType].body,
      templateId: row?.id ?? null,
      messageType: TEMPLATE_TO_MESSAGE_TYPE[input.templateType],
    };
  }
  if (!input.content) throw new BusinessRuleError('Escolha um template ou escreva a mensagem.');
  const unknown = templateVariablesIn(input.content).filter((name) => canonicalTemplateVariable(name) === null);
  if (unknown.length > 0) throw new BusinessRuleError(`Variavel desconhecida: {{${unknown[0]}}}.`);
  if (hasMalformedPlaceholder(input.content)) {
    throw new BusinessRuleError('Ha uma variavel mal escrita. Use o formato {{nome_da_variavel}}.');
  }
  return { body: input.content, templateId: null, messageType: 'MANUAL' };
}

export async function compose(tx: Transaction, context: TenantContext, input: SendMessageInput): Promise<Composition> {
  const [customer] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, context.tenantId)))
    .limit(1);
  if (!customer) throw new NotFoundError('Cliente');

  let appointment: { startsAt: Date; petId: string; serviceName: string } | null = null;
  if (input.appointmentId) {
    const [row] = await tx
      .select({ startsAt: appointments.startsAt, petId: appointments.petId, customerId: appointments.customerId, serviceName: services.name })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, context.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundError('Agendamento');
    if (row.customerId !== customer.id) throw new BusinessRuleError('O agendamento pertence a outro cliente.');
    appointment = row;
  }

  const petId = input.petId ?? appointment?.petId ?? null;
  let petName: string | undefined;
  if (petId) {
    const [pet] = await tx
      .select({ name: pets.name, customerId: pets.customerId })
      .from(pets)
      .where(and(eq(pets.id, petId), eq(pets.tenantId, context.tenantId)))
      .limit(1);
    if (!pet) throw new NotFoundError('Pet');
    if (pet.customerId !== customer.id) throw new BusinessRuleError('O pet pertence a outro cliente.');
    petName = pet.name;
  }

  const [tenant] = await tx
    .select({ name: tenants.name, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, context.tenantId))
    .limit(1);
  const timeZone = tenant?.timezone ?? 'America/Sao_Paulo';

  const { body, templateId, messageType } = await resolveBody(tx, context, input);
  const values: Partial<Record<TemplateVariable, string>> = {
    nome_cliente: customer.name.split(' ')[0] ?? customer.name,
    nome_pet: petName,
    nome_petshop: tenant?.name,
    servico: appointment?.serviceName,
    data: appointment
      ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone }).format(appointment.startsAt)
      : undefined,
    horario: appointment
      ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(appointment.startsAt)
      : undefined,
  };
  const { content, missing } = renderTemplate(body, values);

  return {
    content,
    recipient: toWhatsappRecipient(customer.whatsapp ?? customer.phone),
    missingVariables: missing,
    templateId,
    messageType,
    customerId: customer.id,
    petId,
    appointmentId: input.appointmentId ?? null,
  };
}

export async function previewMessage(tx: Transaction, context: TenantContext, input: SendMessageInput): Promise<MessagePreviewDto> {
  const composition = await compose(tx, context, input);
  return { content: composition.content, recipient: composition.recipient, missingVariables: composition.missingVariables };
}

export async function insertComposedMessage(
  tx: Transaction,
  context: TenantContext,
  composition: Composition,
  provider: WhatsappProvider,
): Promise<typeof messages.$inferSelect> {
  const [row] = await tx
    .insert(messages)
    .values({
      tenantId: context.tenantId,
      customerId: composition.customerId,
      petId: composition.petId,
      appointmentId: composition.appointmentId,
      type: composition.messageType,
      channel: 'WHATSAPP',
      content: composition.content,
      // Sem API conectada a mensagem NAO sai daqui: fica DRAFT
      // ("registrada, nao enviada"). Com API, entra na fila (QUEUED) e o
      // despacho apos o commit decide SENT ou FAILED.
      status: provider.configured ? 'QUEUED' : 'DRAFT',
      recipient: composition.recipient,
      templateId: composition.templateId,
      provider: provider.kind,
    })
    .returning();
  if (!row) throw new Error('Falha ao registrar mensagem.');

  await recordAudit(tx, context, {
    action: AuditAction.MESSAGE_QUEUED,
    entity: AuditEntity.MESSAGE,
    entityId: row.id,
    metadata: { type: composition.messageType, customerId: composition.customerId, provider: provider.kind },
  });
  return row;
}

/** Registra a mensagem (DRAFT sem API, QUEUED com API). O envio acontece em `dispatchQueuedMessages`, fora da transacao. */
export async function registerMessage(
  tx: Transaction,
  context: TenantContext,
  input: SendMessageInput,
  provider: WhatsappProvider,
): Promise<{ messageId: string; content: string; recipient: string }> {
  const composition = await compose(tx, context, input);
  if (composition.missingVariables.length > 0) {
    throw new BusinessRuleError(
      `A mensagem usa ${composition.missingVariables.map((name) => `{{${name}}}`).join(', ')}, mas nao ha dado para preencher. Vincule um agendamento ou ajuste o texto.`,
    );
  }
  const row = await insertComposedMessage(tx, context, composition, provider);
  return { messageId: row.id, content: composition.content, recipient: composition.recipient };
}

/**
 * Envia as mensagens em fila (QUEUED) informadas. Roda FORA da transacao de
 * negocio: uma chamada HTTP externa nao pode segurar locks do banco. Cada
 * resultado e gravado com o status real: SENT (aceita pela API) ou FAILED.
 */
export async function dispatchQueuedMessages(
  context: TenantContext,
  messageIds: string[],
  provider: WhatsappProvider,
): Promise<void> {
  if (!provider.configured || messageIds.length === 0) return;

  const queued = await withTenant(context.tenantId, (tx) =>
    tx
      .select({ id: messages.id, recipient: messages.recipient, content: messages.content })
      .from(messages)
      .where(and(eq(messages.tenantId, context.tenantId), inArray(messages.id, messageIds), eq(messages.status, 'QUEUED'))),
  );

  for (const message of queued) {
    let patch: Partial<typeof messages.$inferInsert>;
    try {
      if (!message.recipient) throw new Error('Mensagem sem destinatario.');
      const result = await provider.send(message.recipient, message.content);
      patch = { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId, failureReason: null };
    } catch (error) {
      patch = { status: 'FAILED', failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Falha no envio.' };
    }
    await withTenant(context.tenantId, (tx) =>
      tx
        .update(messages)
        .set(patch)
        .where(and(eq(messages.id, message.id), eq(messages.status, 'QUEUED'))),
    );
  }
}

export async function getMessage(tx: Transaction, context: TenantContext, messageId: string): Promise<MessageDto> {
  const [row] = await tx
    .select({ message: messages, customerName: customers.name, petName: pets.name })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .leftJoin(pets, eq(pets.id, messages.petId))
    .where(and(eq(messages.id, messageId), eq(messages.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Mensagem');
  return toMessageDto(row);
}

// -----------------------------------------------------------------------------
// Disparos automaticos (confirmacao / cancelamento de agendamento)
// -----------------------------------------------------------------------------

/**
 * Chamado dentro da transacao da mudanca de status. So registra quando o pet
 * shop ligou `automationEnabled` e o template do tipo esta ativo. Devolve o id
 * para o despacho apos o commit (se houver API conectada).
 */
export async function enqueueAppointmentMessage(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
  templateType: 'APPOINTMENT_CONFIRMATION' | 'APPOINTMENT_CANCELLATION' | 'APPOINTMENT_RESCHEDULE' | 'POST_SERVICE_FOLLOWUP',
  provider: WhatsappProvider,
): Promise<string | null> {
  const tenant = await getTenant(tx, context);
  if (!tenant.settings.automationEnabled) return null;

  const [template] = await tx
    .select({ active: messageTemplates.active })
    .from(messageTemplates)
    .where(and(eq(messageTemplates.tenantId, context.tenantId), eq(messageTemplates.type, templateType)))
    .limit(1);
  if (template && !template.active) return null;

  const [appointment] = await tx
    .select({ customerId: appointments.customerId, petId: appointments.petId })
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
    .limit(1);
  if (!appointment) return null;

  const composition = await compose(tx, context, {
    customerId: appointment.customerId,
    petId: appointment.petId,
    appointmentId,
    templateType,
  });
  // Template personalizado com variavel sem dado: nao enviar texto quebrado.
  if (composition.missingVariables.length > 0) return null;

  const row = await insertComposedMessage(tx, context, composition, provider);
  return row.id;
}

/** Despacha (apos o commit) o que ficou em fila para um agendamento. */
export async function dispatchQueuedForAppointment(
  context: TenantContext,
  appointmentId: string,
  provider: WhatsappProvider,
): Promise<void> {
  if (!provider.configured) return;
  const rows = await withTenant(context.tenantId, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, context.tenantId),
          eq(messages.appointmentId, appointmentId),
          eq(messages.status, 'QUEUED'),
        ),
      ),
  );
  await dispatchQueuedMessages(
    context,
    rows.map((row) => row.id),
    provider,
  );
}
