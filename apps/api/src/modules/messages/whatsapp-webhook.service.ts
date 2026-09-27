import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageStatus } from '@petflow/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { withProviderMessageTenant } from '../../db/context.js';
import { messages, reminders } from '../../db/schema/index.js';

/**
 * Webhook de STATUS da WhatsApp Business Cloud API (Meta).
 *
 * A Meta avisa quando uma mensagem enviada por nos foi entregue, lida ou
 * falhou. So entao a mensagem passa a "Entregue"/"Lida" -- nunca antes.
 * Autenticidade: assinatura HMAC-SHA256 do corpo BRUTO com o App Secret
 * (header X-Hub-Signature-256). Sem segredo configurado, nada e aceito.
 */

export interface WhatsappWebhookConfig {
  verifyToken: string | null;
  appSecret: string | null;
}

let configOverride: WhatsappWebhookConfig | null = null;

/** Configuracao do webhook (variaveis de ambiente; substituivel so em testes). */
export function getWhatsappWebhookConfig(): WhatsappWebhookConfig {
  return configOverride ?? { verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? null, appSecret: env.WHATSAPP_APP_SECRET ?? null };
}

/** Somente testes. */
export function setWhatsappWebhookConfigForTests(config: WhatsappWebhookConfig | null): void {
  configOverride = config;
}

/** Confere `X-Hub-Signature-256: sha256=<hex>` contra o corpo bruto. */
export function isValidMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface MetaStatusEvent {
  id: string;
  status: string;
  /** Numero (phone_number_id) do pet shop que enviou -- vem em value.metadata. */
  phoneNumberId?: string | null;
  errors?: { code?: number; title?: string; message?: string }[];
}

/** Mensagens RECEBIDAS por algum numero conectado (value.messages). */
export function countInboundMessages(payload: unknown): { phoneNumberId: string | null; count: number }[] {
  const result: { phoneNumberId: string | null; count: number }[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[]; metadata?: { phone_number_id?: string } } }).value;
      if (Array.isArray(value?.messages) && value.messages.length > 0) {
        result.push({ phoneNumberId: value.metadata?.phone_number_id ?? null, count: value.messages.length });
      }
    }
  }
  return result;
}

/** Extrai os eventos de status do payload da Meta (ignora mensagens recebidas e outros campos). */
export function extractStatusEvents(payload: unknown): MetaStatusEvent[] {
  const events: MetaStatusEvent[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { statuses?: unknown[]; metadata?: { phone_number_id?: string } } }).value;
      const statuses = value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const status of statuses) {
        const item = status as MetaStatusEvent;
        if (typeof item?.id === 'string' && typeof item?.status === 'string') {
          events.push({ ...item, phoneNumberId: value?.metadata?.phone_number_id ?? null });
        }
      }
    }
  }
  return events;
}

const META_TO_STATUS: Record<string, MessageStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Ordem de avanco: uma notificacao atrasada ("sent" depois de "read") nunca rebaixa o status. */
const RANK: Partial<Record<MessageStatus, number>> = { QUEUED: 1, SENT: 2, DELIVERED: 3, READ: 4 };

export type StatusApplyResult = 'UPDATED' | 'IGNORED' | 'UNKNOWN_MESSAGE' | 'TENANT_MISMATCH';

export async function applyStatusEvent(event: MetaStatusEvent): Promise<StatusApplyResult> {
  const next = META_TO_STATUS[event.status];
  if (!next) return 'IGNORED';

  const result = await withProviderMessageTenant(event.id, async (tx, tenantId) => {
    // Multi-tenant: o numero que a Meta diz ter enviado precisa ser o numero
    // conectado do MESMO pet shop dono da mensagem. Senao, ignora.
    if (event.phoneNumberId) {
      const owner = await tx.execute<{ tenant_id: string | null }>(
        sql`SELECT whatsapp_tenant_by_phone_number_id(${event.phoneNumberId}) AS tenant_id`,
      );
      if ((owner.rows[0]?.tenant_id ?? null) !== tenantId) return 'TENANT_MISMATCH' as const;
    }
    const [current] = await tx
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.providerMessageId, event.id)))
      .limit(1);
    if (!current) return 'UNKNOWN_MESSAGE' as const;

    if (next === 'FAILED') {
      // Falha depois de entregue/lida nao faz sentido: ignora.
      if (current.status === 'DELIVERED' || current.status === 'READ' || current.status === 'FAILED') return 'IGNORED' as const;
      const error = event.errors?.[0];
      const reason = [error?.code, error?.title ?? error?.message].filter(Boolean).join(' - ') || 'Falha informada pela Meta.';
      await tx
        .update(messages)
        .set({ status: 'FAILED', failureReason: `WhatsApp: ${reason}`.slice(0, 500) })
        .where(eq(messages.id, current.id));
      await tx
        .update(reminders)
        .set({ status: 'FAILED', note: `WhatsApp: ${reason}`.slice(0, 500) })
        .where(and(eq(reminders.tenantId, tenantId), eq(reminders.messageId, current.id)));
      return 'UPDATED' as const;
    }

    const currentRank = RANK[current.status] ?? 0;
    if ((RANK[next] ?? 0) <= currentRank || current.status === 'FAILED') return 'IGNORED' as const;
    await tx
      .update(messages)
      .set({ status: next, ...(next === 'SENT' ? { sentAt: new Date() } : {}) })
      .where(eq(messages.id, current.id));
    return 'UPDATED' as const;
  });

  return result ?? 'UNKNOWN_MESSAGE';
}
