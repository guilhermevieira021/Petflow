import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '../../core/errors.js';
import { withSystem } from '../../db/context.js';
import {
  CaktoEventType,
  computeProPeriodEnd,
  parseCaktoPurchaseApprovedEvent,
  resolveTenantIdFromCaktoRefId,
} from '../../modules/billing/cakto-events.js';
import {
  applyBillingWebhookEvent,
  markBillingEventFailed,
  markBillingEventProcessed,
  recordBillingEvent,
} from '../../modules/billing/billing.service.js';

/**
 * Webhook da Cakto -- POST /api/webhooks/cakto.
 *
 * ================================================================
 * ESTADO ATUAL: autenticacao e idempotencia reais; ativacao de assinatura
 * so acontece quando o tenant puder ser identificado (ver CAKTO.md)
 * ================================================================
 *
 * A conta Cakto confirmou (painel "Adicionar Webhook") que a autenticidade
 * do evento vem de um campo `secret` DENTRO do corpo JSON, comparado com o
 * valor configurado no painel -- nao e assinatura HMAC em header. Isso esta
 * implementado abaixo, com comparacao em tempo constante.
 *
 * O UNICO evento confirmado ate agora e `purchase_approved` (payload
 * completo documentado em CAKTO.md). Para esse evento, este endpoint ja
 * calcula corretamente o novo periodo (30 dias a partir de `data.paidAt` --
 * nunca da data de cadastro, criacao de conta ou abertura do checkout) e
 * aplicaria a assinatura via `applyBillingWebhookEvent` -- MAS
 * `resolveTenantIdFromCaktoRefId()` sempre devolve `null` hoje, porque ainda
 * nao ha confirmacao de como correlacionar o evento a um tenant (o link de
 * checkout e o MESMO para qualquer pet shop). Enquanto isso nao for
 * confirmado, TODO evento -- mesmo autentico e bem formado -- fica
 * registrado em `billing_events` com `tenantId: null`, sem tocar em nenhuma
 * assinatura. Isso e intencional: aplicar a um tenant adivinhado arriscaria
 * ativar o PRO do pet shop errado.
 *
 * Qualquer `event` diferente de `purchase_approved` (atraso, cancelamento,
 * reembolso -- nomes ainda nao confirmados) e registrado mas nunca aplicado.
 */
export async function caktoWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', async (request) => {
    if (!env.CAKTO_WEBHOOK_SECRET) {
      throw new ServiceUnavailableError(
        'O webhook da Cakto ainda nao foi configurado nesta instalacao ' +
          '(falta o segredo do webhook). Ver CAKTO.md.',
      );
    }

    const body = request.body as Record<string, unknown> | null | undefined;
    const providedSecret = typeof body?.secret === 'string' ? body.secret : '';
    if (!providedSecret || !secretsMatch(providedSecret, env.CAKTO_WEBHOOK_SECRET)) {
      throw new ForbiddenError('Segredo do webhook invalido.');
    }

    const eventType = typeof body?.event === 'string' ? body.event : null;
    const data = body?.data;
    const eventId =
      data !== null && typeof data === 'object' && typeof (data as Record<string, unknown>).id === 'string'
        ? ((data as Record<string, unknown>).id as string)
        : null;

    if (!eventType || !eventId) {
      throw new BadRequestError('Payload do webhook sem "event" ou "data.id".');
    }

    request.log.info({ eventId, eventType }, 'Webhook Cakto: recebido');

    const outcome = await withSystem(async (tx) => {
      // tenantId: null no registro -- a correlacao acontece (se possivel)
      // so depois, no ramo purchase_approved abaixo.
      const row = await recordBillingEvent(tx, {
        provider: 'cakto',
        eventId,
        eventType,
        tenantId: null,
        payload: body ?? {},
      });

      if (!row) {
        request.log.info({ eventId, eventType }, 'Webhook Cakto: reentrega de evento ja processado, ignorado');
        return { applied: false as const, reason: 'duplicate' };
      }

      if (eventType !== CaktoEventType.PURCHASE_APPROVED) {
        request.log.info(
          { eventId, eventType },
          'Webhook Cakto: tipo de evento ainda nao mapeado -- gravado, sem aplicar a nenhuma assinatura',
        );
        return { applied: false as const, reason: 'unmapped_event_type' };
      }

      const parsed = parseCaktoPurchaseApprovedEvent(data);
      if (!parsed) {
        await markBillingEventFailed(tx, row.id, 'Payload sem "data.id" ou "data.paidAt" validos.');
        request.log.warn({ eventId, eventType }, 'Webhook Cakto: payload de purchase_approved incompleto');
        return { applied: false as const, reason: 'invalid_payload' };
      }

      const tenantId = resolveTenantIdFromCaktoRefId(parsed.refId);
      if (!tenantId) {
        request.log.warn(
          { eventId, eventType },
          'Webhook Cakto: tenant nao identificado (correlacao ainda nao confirmada) -- evento pendente para reconciliacao manual',
        );
        return { applied: false as const, reason: 'tenant_unresolved' };
      }

      const currentPeriodEnd = computeProPeriodEnd(parsed.paidAt);
      await applyBillingWebhookEvent(tx, {
        tenantId,
        status: 'ACTIVE',
        planCode: 'PRO',
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        provider: 'cakto',
        ...(parsed.providerSubscriptionId ? { providerSubscriptionId: parsed.providerSubscriptionId } : {}),
      });
      await markBillingEventProcessed(tx, row.id);
      request.log.info({ eventId, eventType, tenantId }, 'Webhook Cakto: assinatura atualizada para PRO/ACTIVE');
      return { applied: true as const, tenantId };
    });

    return { received: true, applied: outcome.applied };
  });
}

function secretsMatch(provided: string, configured: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  // Buffers de tamanho diferente nunca podem ir para `timingSafeEqual`
  // (ele lanca). Comparar com um buffer de mesmo tamanho aqui NAO reintroduz
  // vazamento de tempo util: a diferenca de comprimento ja e publica (o
  // corpo da requisicao e visivel a quem a enviou).
  if (providedBuffer.length !== configuredBuffer.length) return false;
  return timingSafeEqual(providedBuffer, configuredBuffer);
}
