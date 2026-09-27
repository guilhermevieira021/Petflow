import {
  buildPagination,
  type ListRemindersQuery,
  type Paginated,
  type ProcessRemindersInput,
  type ProcessRemindersResultDto,
  type ReminderDto,
  type ReminderSchedulerStatusDto,
  type ReminderStatus,
} from '@petflow/contracts';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { toCount, toIso, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import { withTenant, type TenantContext } from '../../db/context.js';
import { appointments, customers, messages, messageTemplates, pets, reminders, services } from '../../db/schema/index.js';
import type { WhatsappProvider } from '../../integrations/whatsapp/whatsapp.provider.js';
import { getTenant } from '../tenants/tenants.service.js';
import { compose, dispatchQueuedMessages, insertComposedMessage } from './whatsapp.service.js';

/**
 * Lembretes de atendimento: GERACAO separada do ENVIO.
 *
 *  1. Agendar (este arquivo, chamado pela agenda): criar ou remarcar um
 *     atendimento grava UM lembrete PENDING em `reminders`, para
 *     (inicio - settings.appointmentReminderHours). Nada e enviado.
 *  2. Processar (`processDueReminders`): pega os lembretes vencidos, gera a
 *     mensagem com dados reais e registra o resultado REAL -- SENT so com
 *     aceite da WhatsApp Business API; sem API, REGISTERED ("registrado, nao
 *     enviado") com link wa.me na tela.
 *
 * Ainda NAO existe worker/cron: o processamento roda quando alguem aciona
 * "Processar lembretes". `processDueReminders(..., { trigger: 'scheduled' })`
 * e o ponto de entrada pronto para um worker (exige automationEnabled).
 */

const ACTIVE_APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

/** Cancela o lembrete pendente do agendamento (remarcado, cancelado, concluido). */
export async function cancelAppointmentReminders(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
  note: string,
): Promise<void> {
  await tx
    .update(reminders)
    .set({ status: 'CANCELLED', note })
    .where(
      and(
        eq(reminders.tenantId, context.tenantId),
        eq(reminders.appointmentId, appointmentId),
        eq(reminders.type, 'APPOINTMENT'),
        eq(reminders.status, 'PENDING'),
      ),
    );
}

/**
 * Agenda (ou reagenda) o lembrete de um atendimento. Idempotente: no maximo um
 * PENDING por agendamento (indice unico parcial na 0011).
 */
export async function scheduleAppointmentReminder(
  tx: Transaction,
  context: TenantContext,
  appointmentId: string,
): Promise<void> {
  const [appointment] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
    .limit(1);
  if (!appointment) return;

  await cancelAppointmentReminders(tx, context, appointmentId, 'Agendamento remarcado.');

  const isActive = (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(appointment.status);
  if (!isActive || appointment.startsAt.getTime() <= Date.now()) return;

  const tenant = await getTenant(tx, context);
  const reminderAt = new Date(appointment.startsAt.getTime() - tenant.settings.appointmentReminderHours * 3_600_000);
  // Agendamento marcado "em cima da hora": o lembrete ja nasce vencido.
  const scheduledAt = reminderAt.getTime() < Date.now() ? new Date() : reminderAt;

  await tx.insert(reminders).values({
    tenantId: context.tenantId,
    customerId: appointment.customerId,
    petId: appointment.petId,
    appointmentId,
    type: 'APPOINTMENT',
    scheduledAt,
    status: 'PENDING',
  });
}

/**
 * Agendamentos futuros criados antes deste modulo (ou sem lembrete) ganham o
 * lembrete que falta. Nunca recria lembrete ja processado.
 */
async function ensureUpcomingReminders(tx: Transaction, context: TenantContext): Promise<void> {
  const missing = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, context.tenantId),
        inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        gt(appointments.startsAt, new Date()),
        sql`NOT EXISTS (
          SELECT 1 FROM reminders r
          WHERE r.appointment_id = appointments.id AND r.type = 'APPOINTMENT' AND r.status <> 'CANCELLED'
        )`,
      ),
    )
    .limit(500);
  for (const row of missing) await scheduleAppointmentReminder(tx, context, row.id);
}

interface ProcessOutcome {
  reminderId: string;
  status: ReminderStatus;
  note: string | null;
  messageId: string | null;
}

/**
 * Processa os lembretes vencidos (e, opcionalmente, os que vencem nas
 * proximas `aheadHours`). A geracao das mensagens acontece numa transacao; o
 * envio pela API, depois do commit (uma chamada HTTP nao segura locks).
 */
export async function processDueReminders(
  context: TenantContext,
  input: ProcessRemindersInput & { trigger?: 'manual' | 'scheduled' },
  provider: WhatsappProvider,
): Promise<ProcessRemindersResultDto> {
  const trigger = input.trigger ?? 'manual';

  const outcome = await withTenant(context.tenantId, async (tx) => {
    const tenant = await getTenant(tx, context);
    // Worker automatico so age com envio automatico autorizado pelo pet shop.
    if (trigger === 'scheduled' && !tenant.settings.automationEnabled) return null;

    await ensureUpcomingReminders(tx, context);

    const [template] = await tx
      .select({ active: messageTemplates.active })
      .from(messageTemplates)
      .where(and(eq(messageTemplates.tenantId, context.tenantId), eq(messageTemplates.type, 'APPOINTMENT_REMINDER')))
      .limit(1);
    const templateActive = template?.active ?? true;

    const limit = new Date(Date.now() + input.aheadHours * 3_600_000);
    const due = await tx
      .select({ reminder: reminders, startsAt: appointments.startsAt, appointmentStatus: appointments.status })
      .from(reminders)
      .innerJoin(appointments, eq(appointments.id, reminders.appointmentId))
      .where(
        and(
          eq(reminders.tenantId, context.tenantId),
          eq(reminders.type, 'APPOINTMENT'),
          eq(reminders.status, 'PENDING'),
          lte(reminders.scheduledAt, limit),
        ),
      )
      .orderBy(asc(reminders.scheduledAt))
      .limit(200)
      .for('update', { of: reminders });

    const results: ProcessOutcome[] = [];
    for (const row of due) {
      const base = { reminderId: row.reminder.id, messageId: null };
      if (!(ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(row.appointmentStatus)) {
        results.push({ ...base, status: 'CANCELLED', note: 'Agendamento nao esta mais ativo.' });
        continue;
      }
      if (row.startsAt.getTime() <= Date.now()) {
        results.push({ ...base, status: 'SKIPPED', note: 'O atendimento ja comecou.' });
        continue;
      }
      if (!templateActive) {
        results.push({ ...base, status: 'SKIPPED', note: 'Template de lembrete desativado.' });
        continue;
      }
      const composition = await compose(tx, context, {
        customerId: row.reminder.customerId,
        petId: row.reminder.petId,
        appointmentId: row.reminder.appointmentId,
        templateType: 'APPOINTMENT_REMINDER',
      });
      if (composition.missingVariables.length > 0) {
        results.push({
          ...base,
          status: 'SKIPPED',
          note: `Template com variavel sem dado: ${composition.missingVariables.map((name) => `{{${name}}}`).join(', ')}.`,
        });
        continue;
      }
      const message = await insertComposedMessage(tx, context, composition, provider);
      // Sem API: mensagem DRAFT -> lembrete REGISTERED. Com API: a mensagem
      // esta QUEUED; o status final (SENT/FAILED) e gravado apos o envio.
      results.push({ reminderId: row.reminder.id, status: 'REGISTERED', note: null, messageId: message.id });
    }

    for (const result of results) {
      await tx
        .update(reminders)
        .set({ status: result.status, note: result.note, messageId: result.messageId, sentAt: new Date() })
        .where(eq(reminders.id, result.reminderId));
    }
    return results;
  });

  if (outcome === null) {
    return {
      processed: 0,
      sent: 0,
      registered: 0,
      failed: 0,
      skipped: 0,
      providerConnected: provider.configured,
      notice: 'Envio automático não autorizado nas configurações: nenhum lembrete processado.',
    };
  }

  const messageIds = outcome.map((result) => result.messageId).filter((id): id is string => id !== null);
  let sent = 0;
  let failed = 0;
  if (provider.configured && messageIds.length > 0) {
    await dispatchQueuedMessages(context, messageIds, provider);
    // Espelha no lembrete o resultado REAL do envio.
    const statuses = await withTenant(context.tenantId, async (tx) => {
      const rows = await tx
        .select({ id: messages.id, status: messages.status, failureReason: messages.failureReason })
        .from(messages)
        .where(and(eq(messages.tenantId, context.tenantId), inArray(messages.id, messageIds)));
      for (const row of rows) {
        const status: ReminderStatus = row.status === 'SENT' ? 'SENT' : row.status === 'FAILED' ? 'FAILED' : 'REGISTERED';
        await tx
          .update(reminders)
          .set({ status, note: status === 'FAILED' ? row.failureReason : null })
          .where(and(eq(reminders.tenantId, context.tenantId), eq(reminders.messageId, row.id)));
      }
      return rows;
    });
    sent = statuses.filter((row) => row.status === 'SENT').length;
    failed = statuses.filter((row) => row.status === 'FAILED').length;
  }

  const generated = messageIds.length;
  const registered = generated - sent - failed;
  const skipped = outcome.filter((result) => result.status === 'SKIPPED' || result.status === 'CANCELLED').length;
  return {
    processed: outcome.length,
    sent,
    registered,
    failed,
    skipped,
    providerConnected: provider.configured,
    notice: provider.configured
      ? `${sent} lembrete(s) enviado(s) pela API do WhatsApp${failed > 0 ? `, ${failed} com falha` : ''}.`
      : generated > 0
        ? `${generated} lembrete(s) registrado(s), mas NÃO enviado(s): o WhatsApp não está configurado. Use "Enviar pelo WhatsApp" em cada um.`
        : 'Nenhum lembrete vencido para processar.',
  };
}

export async function listReminders(
  tx: Transaction,
  context: TenantContext,
  query: ListRemindersQuery,
): Promise<Paginated<ReminderDto>> {
  const filters = [eq(reminders.tenantId, context.tenantId), eq(reminders.type, 'APPOINTMENT')];
  if (query.status) filters.push(eq(reminders.status, query.status));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(reminders).where(where);
  const rows = await tx
    .select({
      reminder: reminders,
      customerName: customers.name,
      customerWhatsapp: sql<string | null>`coalesce(${customers.whatsapp}, ${customers.phone})`,
      petName: pets.name,
      serviceName: services.name,
      startsAt: appointments.startsAt,
      messageContent: messages.content,
      messageStatus: messages.status,
    })
    .from(reminders)
    .innerJoin(customers, eq(customers.id, reminders.customerId))
    .leftJoin(pets, eq(pets.id, reminders.petId))
    .leftJoin(appointments, eq(appointments.id, reminders.appointmentId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(messages, eq(messages.id, reminders.messageId))
    .where(where)
    .orderBy(query.status === 'PENDING' ? asc(reminders.scheduledAt) : desc(reminders.updatedAt), desc(reminders.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => ({
      id: row.reminder.id,
      appointmentId: row.reminder.appointmentId,
      appointmentStartsAt: toIso(row.startsAt),
      customerId: row.reminder.customerId,
      customerName: row.customerName,
      customerWhatsapp: row.customerWhatsapp,
      petName: row.petName,
      serviceName: row.serviceName,
      scheduledAt: toIsoRequired(row.reminder.scheduledAt),
      status: row.reminder.status,
      note: row.reminder.note,
      messageId: row.reminder.messageId,
      messageContent: row.messageContent,
      messageStatus: row.messageStatus,
      processedAt: row.reminder.status === 'PENDING' ? null : toIso(row.reminder.sentAt),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getReminderSchedulerStatus(tx: Transaction, context: TenantContext): Promise<ReminderSchedulerStatusDto> {
  const tenant = await getTenant(tx, context);
  const [row] = await tx
    .select({
      pending: sql<string>`count(*)`,
      dueNow: sql<string>`count(*) FILTER (WHERE ${reminders.scheduledAt} <= now())`,
    })
    .from(reminders)
    .where(and(eq(reminders.tenantId, context.tenantId), eq(reminders.type, 'APPOINTMENT'), eq(reminders.status, 'PENDING')));
  return {
    automaticProcessing: false,
    reminderHours: tenant.settings.appointmentReminderHours,
    pending: toCount(row?.pending),
    dueNow: toCount(row?.dueNow),
    notice:
      'Os lembretes são agendados automaticamente, mas o processamento automático (worker/cron) ainda não está ativo. Use "Processar lembretes" para gerar os vencidos.',
  };
}

