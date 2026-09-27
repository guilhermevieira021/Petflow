import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ServiceUnavailableError, UnauthenticatedError } from '../../core/errors.js';
import {
  applyStatusEvent,
  countInboundMessages,
  extractStatusEvents,
  getWhatsappWebhookConfig,
  isValidMetaSignature,
} from '../../modules/messages/whatsapp-webhook.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * /api/webhooks/whatsapp -- webhook da Meta (sem sessao).
 *
 *  GET  -> verificacao de assinatura do webhook (hub.challenge), exige
 *          WHATSAPP_VERIFY_TOKEN.
 *  POST -> notificacoes de status, exige WHATSAPP_APP_SECRET e assinatura
 *          valida. Sem configuracao: 503, nunca aceita payload sem validar.
 */
export async function whatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Corpo bruto so neste plugin (encapsulado): a assinatura HMAC e calculada
  // sobre os bytes exatos que a Meta enviou.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request: FastifyRequest, body: Buffer, done) => {
    request.rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/', async (request, reply) => {
    const { verifyToken } = getWhatsappWebhookConfig();
    if (!verifyToken) {
      throw new ServiceUnavailableError('Webhook do WhatsApp nao configurado nesta instalacao.');
    }
    const query = request.query as Record<string, string | undefined>;
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken && query['hub.challenge']) {
      return reply.type('text/plain').send(query['hub.challenge']);
    }
    return reply.status(403).send({ message: 'Token de verificacao invalido.' });
  });

  app.post('/', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { appSecret } = getWhatsappWebhookConfig();
    if (!appSecret) {
      throw new ServiceUnavailableError('Webhook do WhatsApp nao configurado nesta instalacao.');
    }
    const signature = request.headers['x-hub-signature-256'];
    if (!request.rawBody || !isValidMetaSignature(request.rawBody, typeof signature === 'string' ? signature : undefined, appSecret)) {
      throw new UnauthenticatedError('Assinatura invalida.');
    }

    const events = extractStatusEvents(request.body);
    const results = { updated: 0, ignored: 0, unknown: 0, mismatched: 0, inbound: 0 };
    for (const event of events) {
      const result = await applyStatusEvent(event);
      if (result === 'UPDATED') results.updated += 1;
      else if (result === 'IGNORED') results.ignored += 1;
      else if (result === 'TENANT_MISMATCH') results.mismatched += 1;
      else results.unknown += 1;
    }
    // Mensagens recebidas dos clientes: reconhecidas (200), ainda nao
    // armazenadas -- caixa de entrada fica para uma proxima fase.
    results.inbound = countInboundMessages(request.body).reduce((sum, item) => sum + item.count, 0);
    request.log.info({ events: events.length, ...results }, 'whatsapp webhook');
    // 200 sempre que autentico: a Meta reenvia em caso de erro.
    return reply.send({ received: events.length, ...results });
  });
}
