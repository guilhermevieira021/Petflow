import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaktoProvider } from '../integrations/billing/billing.provider.js';
import { billingEvents } from '../db/schema/index.js';
import { withSystem, withTenant } from '../db/context.js';
import { recordBillingEvent } from '../modules/billing/billing.service.js';
import { createTenantWithOwner, errorCode, setupTestApp, teardownTestApp } from './helpers.js';

/**
 * Integracao Cakto.
 *
 * O que esta coberto aqui e exatamente o que ja e real hoje: o
 * `CaktoProvider` (checkout com o link estatico configurado), o webhook
 * validando o `secret` do corpo (confirmado com a conta Cakto -- painel
 * "Adicionar Webhook") e gravando o evento de forma idempotente, e a tabela
 * `billing_events` (idempotencia e isolamento entre tenants).
 *
 * `CAKTO_WEBHOOK_SECRET` so existe em `vitest.config.ts` para exercitar esse
 * caminho em teste -- NAO e o segredo real da Cakto.
 *
 * O que NAO esta coberto (de proposito, ate a conta Cakto fornecer os dados
 * que faltam): mapear o evento para um status de assinatura e aplicar via
 * `applyBillingWebhookEvent`, porque isso exige saber o nome de TODOS os
 * eventos reais e como correlacionar o evento a um tenant -- ver CAKTO.md.
 */

let server: FastifyInstance;

beforeAll(async () => {
  server = await setupTestApp();
});

afterAll(async () => {
  await teardownTestApp();
});

describe('CaktoProvider', () => {
  it('devolve o link de checkout configurado, sem chamar nenhuma API externa', async () => {
    const provider = new CaktoProvider('https://pay.cakto.com.br/upofina_1130180');
    expect(provider.configured).toBe(true);
    expect(provider.name).toBe('cakto');

    const session = await provider.createCheckoutSession({
      tenantId: '11111111-1111-4111-8111-111111111111',
      planCode: 'PRO',
      priceCents: 9990,
    });

    expect(session.checkoutUrl).toBe('https://pay.cakto.com.br/upofina_1130180');
  });

  it('o link devolvido e sempre o mesmo, independente do tenant -- por isso o webhook ainda precisa de um jeito de saber quem comprou', async () => {
    const provider = new CaktoProvider('https://pay.cakto.com.br/upofina_1130180');
    const sessionA = await provider.createCheckoutSession({
      tenantId: '11111111-1111-4111-8111-111111111111',
      planCode: 'PRO',
      priceCents: 9990,
    });
    const sessionB = await provider.createCheckoutSession({
      tenantId: '22222222-2222-4222-8222-222222222222',
      planCode: 'PRO',
      priceCents: 9990,
    });
    expect(sessionA.checkoutUrl).toBe(sessionB.checkoutUrl);
  });
});

const TEST_WEBHOOK_SECRET = 'segredo-de-teste-nao-e-o-real';

function caktoPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    secret: TEST_WEBHOOK_SECRET,
    event: 'purchase_approved',
    data: {
      id: 'evt_webhook_http_1',
      refId: '9vbgfmg',
      customer: { name: 'Fulano', email: 'fulano@example.com' },
    },
    ...overrides,
  };
}

describe('Webhook -- POST /api/webhooks/cakto', () => {
  // O ambiente de teste (vitest.config.ts) SEMPRE define CAKTO_WEBHOOK_SECRET
  // -- o env e um singleton carregado uma unica vez por processo, entao nao
  // ha como testar aqui o estado "variavel ausente" (503) sem reiniciar o
  // processo. Esse ramo (`if (!env.CAKTO_WEBHOOK_SECRET)` em
  // cakto-webhook.routes.ts) e simples o suficiente para ficar coberto por
  // leitura de codigo; o que importa testar de verdade e o comportamento com
  // a variavel presente, que e o caso real em qualquer ambiente configurado.

  it('rejeita com 403 quando o secret do corpo nao bate com o configurado', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({ secret: 'secret-errado' }),
    });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('FORBIDDEN');
  });

  it('rejeita com 403 quando o corpo nao tem secret nenhum', async () => {
    const { secret: _secret, ...payloadWithoutSecret } = caktoPayload();
    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: payloadWithoutSecret,
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejeita com 400 quando o secret bate mas falta "event" ou "data.id"', async () => {
    const semEvent = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({ event: undefined }),
    });
    expect(semEvent.statusCode).toBe(400);

    const semDataId = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({ data: { refId: '9vbgfmg' } }),
    });
    expect(semDataId.statusCode).toBe(400);
  });

  it('aceita (200) um evento autentico, grava em billing_events com tenantId nulo -- ainda nao ha correlacao de tenant confirmada', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({ data: { id: 'evt_webhook_http_aceito' } }),
    });
    expect(response.statusCode).toBe(200);

    const rows = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_webhook_http_aceito')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('cakto');
    expect(rows[0]!.eventType).toBe('purchase_approved');
    expect(rows[0]!.tenantId).toBeNull();
    expect(rows[0]!.status).toBe('RECEIVED');
  });

  it('reentrega do mesmo evento via HTTP nao grava duas vezes', async () => {
    const payload = caktoPayload({ data: { id: 'evt_webhook_http_reentrega' } });

    const first = await server.inject({ method: 'POST', url: '/api/webhooks/cakto', payload });
    const second = await server.inject({ method: 'POST', url: '/api/webhooks/cakto', payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const rows = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_webhook_http_reentrega')),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('billing_events: idempotencia', () => {
  it('o mesmo evento (provider + eventId) recebido duas vezes so e gravado uma', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Idempotencia' });

    const first = await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_teste_idempotencia_1',
        eventType: 'evento.de.teste',
        tenantId: shop.tenantId,
        payload: { tentativa: 1 },
      }),
    );
    expect(first).not.toBeNull();

    // Reentrega do MESMO evento -- comportamento normal de qualquer gateway
    // de pagamento, que reenvia ate receber 2xx.
    const second = await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_teste_idempotencia_1',
        eventType: 'evento.de.teste',
        tenantId: shop.tenantId,
        payload: { tentativa: 2 },
      }),
    );
    expect(second).toBeNull();

    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(billingEvents)
        .where(and(eq(billingEvents.provider, 'cakto'), eq(billingEvents.eventId, 'evt_teste_idempotencia_1'))),
    );
    expect(rows).toHaveLength(1);
    // A linha gravada e a da PRIMEIRA tentativa -- a segunda nunca sobrescreve.
    expect((rows[0]!.payload as { tentativa: number }).tentativa).toBe(1);
  });

  it('eventos com event_id diferente sao gravados normalmente', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Eventos Distintos' });

    const first = await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_a',
        eventType: 'evento.de.teste',
        tenantId: shop.tenantId,
        payload: {},
      }),
    );
    const second = await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_b',
        eventType: 'evento.de.teste',
        tenantId: shop.tenantId,
        payload: {},
      }),
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });
});

describe('billing_events: isolamento entre tenants', () => {
  it('um tenant nunca enxerga eventos de billing de outro tenant', async () => {
    const shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Isolamento A' });
    const shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Isolamento B' });

    await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_isolamento_a',
        eventType: 'evento.de.teste',
        tenantId: shopA.tenantId,
        payload: {},
      }),
    );
    await withSystem((tx) =>
      recordBillingEvent(tx, {
        provider: 'cakto',
        eventId: 'evt_isolamento_b',
        eventType: 'evento.de.teste',
        tenantId: shopB.tenantId,
        payload: {},
      }),
    );

    // Consulta DELIBERADAMENTE sem filtro de tenant, simulando um bug de
    // aplicacao -- a policy de RLS precisa salvar a situacao sozinha, o
    // mesmo padrao usado em tenant-isolation.test.ts para as demais tabelas.
    const visibleFromA = await withTenant(shopA.tenantId, (tx) => tx.select().from(billingEvents));
    expect(visibleFromA).toHaveLength(1);
    expect(visibleFromA[0]!.eventId).toBe('evt_isolamento_a');

    const visibleFromB = await withTenant(shopB.tenantId, (tx) => tx.select().from(billingEvents));
    expect(visibleFromB).toHaveLength(1);
    expect(visibleFromB[0]!.eventId).toBe('evt_isolamento_b');
  });
});
