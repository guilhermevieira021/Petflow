import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '../../core/errors.js';
import { withSystem } from '../../db/context.js';
import { recordBillingEvent } from '../../modules/billing/billing.service.js';

/**
 * Webhook da Cakto -- POST /api/webhooks/cakto.
 *
 * ================================================================
 * ESTADO ATUAL: autenticacao confirmada, aplicacao ainda pendente
 * (ver CAKTO.md)
 * ================================================================
 *
 * A conta Cakto confirmou (painel "Adicionar Webhook") que a autenticidade
 * do evento vem de um campo `secret` DENTRO do corpo JSON, comparado com o
 * valor configurado no painel -- nao e assinatura HMAC em header. Isso ja
 * esta implementado abaixo, com comparacao em tempo constante.
 *
 * Ainda faltam duas informacoes da conta Cakto para ATIVAR uma assinatura a
 * partir de um evento, nenhuma das quais pode ser adivinhada com seguranca:
 *
 *   1. Os nomes REAIS de todos os eventos que a Cakto envia (confirmado ate
 *      agora: "purchase_approved" para compra aprovada; faltam os de atraso,
 *      cancelamento e reembolso) -- para mapear corretamente para
 *      TRIALING/ACTIVE/PAST_DUE/CANCELLED/EXPIRED.
 *   2. Como correlacionar o evento a um TENANT do nosso sistema, ja que o
 *      link de checkout configurado (`CAKTO_PRO_CHECKOUT_URL`) e o MESMO
 *      link estatico para qualquer pet shop -- o campo `refId` do payload e
 *      candidato, mas ainda nao confirmado como algo que controlamos.
 *
 * Por isso, hoje este endpoint: valida a autenticidade de verdade, grava o
 * evento em `billing_events` de forma idempotente (para nao perder nada e
 * nao processar duas vezes quando a Cakto reentregar), mas NAO chama
 * `applyBillingWebhookEvent()` -- ainda nao ha como saber com seguranca qual
 * tenant deve mudar de status. O evento fica registrado com `tenantId: null`
 * e status `RECEIVED`, disponivel para reconciliacao manual ate os dois
 * itens acima serem confirmados.
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

    // tenantId: null -- ver comentario do modulo. A correlacao com um tenant
    // ainda nao foi confirmada com a conta Cakto (item 2 acima).
    await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId,
        eventType,
        tenantId: null,
        payload: body ?? {},
      }),
    );

    return { received: true };
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
