import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaktoProvider } from '../integrations/billing/billing.provider.js';
import { billingEvents, subscriptions } from '../db/schema/index.js';
import { withSystem, withTenant } from '../db/context.js';
import { computeProPeriodEnd } from '../modules/billing/cakto-events.js';
import { applyBillingWebhookEvent, recordBillingEvent } from '../modules/billing/billing.service.js';
import { authed, createTenantWithOwner, errorCode, setupTestApp, teardownTestApp } from './helpers.js';

/**
 * Integracao Cakto.
 *
 * O que esta coberto aqui e exatamente o que ja e real hoje: o
 * `CaktoProvider` (checkout com o link estatico configurado), o webhook
 * validando o `secret` do corpo (confirmado com a conta Cakto -- painel
 * "Adicionar Webhook"), gravando o evento de forma idempotente, calculando
 * corretamente o periodo de 30 dias para `purchase_approved`, e a tabela
 * `billing_events` (idempotencia e isolamento entre tenants).
 *
 * `CAKTO_WEBHOOK_SECRET` so existe em `vitest.config.ts` para exercitar esse
 * caminho em teste -- NAO e o segredo real da Cakto.
 *
 * Correlacao de tenant: `resolveTenantIdFromCaktoEvent` casa
 * `data.customer.email` contra o OWNER ativo daquele email (globalmente
 * unico -- ver cakto-events.ts para o raciocinio completo). O describe
 * "Webhook completo -- ativacao real" abaixo prova isso ponta a ponta via
 * HTTP real: POST autenticado -> banco -> PRO/ACTIVE, e tambem que o
 * pagamento de um tenant NUNCA ativa outro.
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
      payload: caktoPayload({
        data: { id: 'evt_webhook_http_aceito', refId: '9vbgfmg', paidAt: '2026-06-26T12:00:00.000000+00:00' },
      }),
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
    expect(first.json<{ applied: boolean }>().applied).toBe(false);
    expect(second.json<{ applied: boolean }>().applied).toBe(false);

    const rows = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_webhook_http_reentrega')),
    );
    expect(rows).toHaveLength(1);
  });

  it('evento de tipo ainda nao mapeado (ex.: cancelamento/reembolso, nomes nao confirmados) e gravado mas nunca aplicado', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({
        event: 'evento_nao_reconhecido_ainda',
        data: { id: 'evt_tipo_desconhecido' },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean }>().applied).toBe(false);

    const rows = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_tipo_desconhecido')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('RECEIVED');
  });

  it('purchase_approved sem data.paidAt valido e marcado como FAILED, mas ainda responde 200 (nao gera retentativa infinita)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({ data: { id: 'evt_sem_paidat' } }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean }>().applied).toBe(false);

    const rows = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_sem_paidat')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.errorMessage).toContain('paidAt');
  });

  it('purchase_approved com email que nao bate com nenhum OWNER ativo nunca altera nenhuma subscription', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Webhook Email Desconhecido' });
    const before = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(before[0]!.status).toBe('TRIALING');

    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({
        data: {
          id: 'evt_purchase_email_desconhecido',
          refId: '9vbgfmg',
          paidAt: '2026-06-26T12:00:00.000000+00:00',
          // fulano@example.com (default de caktoPayload) nao e o email de
          // nenhum OWNER cadastrado -- correlacao deve falhar com seguranca.
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean }>().applied).toBe(false);

    // O tenant criado neste teste continua exatamente como estava --
    // nenhuma assinatura no banco foi tocada por este evento.
    const after = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(after[0]!.status).toBe('TRIALING');
    expect(after[0]!.provider).toBeNull();
  });
});

describe('Webhook completo -- ativacao real via HTTP (correlacao por email do OWNER)', () => {
  it('purchase_approved com o email do OWNER ativa PRO/ACTIVE de ponta a ponta, via POST real', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Ativacao Real' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({
        data: {
          id: 'evt_ativacao_real_http',
          customer: { name: 'Dono', email: shop.owner.email },
          paidAt: '2026-06-26T12:00:00.000000+00:00',
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean; tenantId?: string }>().applied).toBe(true);

    const [row] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(row!.status).toBe('ACTIVE');
    expect(row!.provider).toBe('cakto');
    expect(row!.currentPeriodEnd!.toISOString()).toBe('2026-07-26T12:00:00.000Z');

    const [eventRow] = await withSystem((tx) =>
      tx.select().from(billingEvents).where(eq(billingEvents.eventId, 'evt_ativacao_real_http')),
    );
    expect(eventRow!.status).toBe('PROCESSED');
    expect(eventRow!.tenantId).toBeNull(); // gravado antes de resolver o tenant, por design -- ver recordBillingEvent

    const status = await authed(server, shop.owner, { method: 'GET', url: '/api/billing/status' });
    expect(status.json<{ plan: { code: string }; subscription: { status: string } }>().plan.code).toBe('PRO');
  });

  it('email em caixa/espacamento diferente ainda correlaciona (normalizado igual ao cadastro)', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Email Maiusculo' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({
        data: {
          id: 'evt_ativacao_email_maiusculo',
          customer: { name: 'Dono', email: `  ${shop.owner.email.toUpperCase()}  ` },
          paidAt: '2026-06-26T12:00:00.000000+00:00',
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean }>().applied).toBe(true);
  });

  it('CRITICO: pagamento com o email do OWNER do Tenant A nunca ativa o Tenant B', async () => {
    const shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Isolamento Pagamento A' });
    const shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Isolamento Pagamento B' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/webhooks/cakto',
      payload: caktoPayload({
        data: {
          id: 'evt_isolamento_pagamento',
          customer: { name: 'Dono A', email: shopA.owner.email },
          paidAt: '2026-06-26T12:00:00.000000+00:00',
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ applied: boolean }>().applied).toBe(true);

    const [rowA] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shopA.tenantId)),
    );
    const [rowB] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shopB.tenantId)),
    );
    expect(rowA!.status).toBe('ACTIVE');
    expect(rowB!.status).toBe('TRIALING'); // intocado
    expect(rowB!.provider).toBeNull();
  });

  it('idempotencia ponta a ponta: reentrega via HTTP do mesmo evento ja aplicado nao reprocessa nem estende o periodo', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Idempotencia Ponta A Ponta' });
    const payload = caktoPayload({
      data: {
        id: 'evt_idempotencia_http_completo',
        customer: { name: 'Dono', email: shop.owner.email },
        paidAt: '2026-05-01T00:00:00.000000+00:00',
      },
    });

    const first = await server.inject({ method: 'POST', url: '/api/webhooks/cakto', payload });
    const second = await server.inject({ method: 'POST', url: '/api/webhooks/cakto', payload });
    expect(first.json<{ applied: boolean }>().applied).toBe(true);
    expect(second.json<{ applied: boolean }>().applied).toBe(false); // reentrega: recordBillingEvent devolve null, para antes de reaplicar

    const [row] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(row!.currentPeriodEnd!.toISOString()).toBe(computeProPeriodEnd(new Date('2026-05-01T00:00:00.000Z')).toISOString());
  });
});

describe('Ativacao da assinatura (via applyBillingWebhookEvent -- o mesmo caminho que o webhook usaria com a correlacao resolvida)', () => {
  it('compra aprovada leva o tenant de TRIALING para ACTIVE/PRO, com periodo de 30 dias a partir de paidAt', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Ativacao' });
    const paidAt = new Date('2026-06-26T12:00:00.000Z');
    const currentPeriodEnd = computeProPeriodEnd(paidAt);

    await withSystem((tx) =>
      applyBillingWebhookEvent(tx, {
        tenantId: shop.tenantId,
        status: 'ACTIVE',
        planCode: 'PRO',
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        provider: 'cakto',
        providerSubscriptionId: 'sub_cakto_exemplo',
      }),
    );

    const [row] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(row!.status).toBe('ACTIVE');
    expect(row!.provider).toBe('cakto');
    expect(row!.providerSubscriptionId).toBe('sub_cakto_exemplo');
    expect(row!.currentPeriodEnd!.toISOString()).toBe('2026-07-26T12:00:00.000Z');

    const status = await authed(server, shop.owner, { method: 'GET', url: '/api/billing/status' });
    const body = status.json<{
      plan: { code: string; limits: Record<string, number | null> };
      subscription: { status: string };
      trial: { active: boolean };
      access: { blocked: boolean };
    }>();
    // Sai do trial de verdade: plano PRO, limites liberados (null = ilimitado),
    // trial.active false -- o sistema nao trata mais este tenant como gratuito.
    expect(body.plan.code).toBe('PRO');
    expect(body.plan.limits.customers).toBeNull();
    expect(body.subscription.status).toBe('ACTIVE');
    expect(body.trial.active).toBe(false);
    expect(body.access.blocked).toBe(false);
  });

  it('idempotencia real: o mesmo evento (mesmo eventId) processado duas vezes nao soma dias ao periodo', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Sem Duplicar Periodo' });
    const paidAt = new Date('2026-03-01T00:00:00.000Z');
    const currentPeriodEnd = computeProPeriodEnd(paidAt);

    const apply = () =>
      withSystem(async (tx) => {
        const row = await recordBillingEvent(tx, {
          provider: 'cakto',
          eventId: 'evt_idempotencia_periodo',
          eventType: 'purchase_approved',
          tenantId: shop.tenantId,
          payload: {},
        });
        if (!row) return; // reentrega: nao reaplica
        await applyBillingWebhookEvent(tx, {
          tenantId: shop.tenantId,
          status: 'ACTIVE',
          planCode: 'PRO',
          currentPeriodEnd: currentPeriodEnd.toISOString(),
          provider: 'cakto',
        });
      });

    await apply();
    await apply(); // reentrega do MESMO evento

    const [row] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    // Continua sendo paidAt + 30 dias -- nao paidAt + 60.
    expect(row!.currentPeriodEnd!.toISOString()).toBe(currentPeriodEnd.toISOString());
  });

  it('renovacao: uma SEGUNDA compra aprovada (eventId diferente, paidAt mais recente) estende o periodo a partir da nova data', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cakto Renovacao' });

    const primeiroPagamento = new Date('2026-01-01T00:00:00.000Z');
    await withSystem((tx) =>
      applyBillingWebhookEvent(tx, {
        tenantId: shop.tenantId,
        status: 'ACTIVE',
        planCode: 'PRO',
        currentPeriodEnd: computeProPeriodEnd(primeiroPagamento).toISOString(),
        provider: 'cakto',
      }),
    );

    const segundoPagamento = new Date('2026-01-30T00:00:00.000Z');
    await withSystem((tx) =>
      applyBillingWebhookEvent(tx, {
        tenantId: shop.tenantId,
        status: 'ACTIVE',
        planCode: 'PRO',
        currentPeriodEnd: computeProPeriodEnd(segundoPagamento).toISOString(),
        provider: 'cakto',
      }),
    );

    const [row] = await withSystem((tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)),
    );
    expect(row!.status).toBe('ACTIVE');
    expect(row!.currentPeriodEnd!.toISOString()).toBe(computeProPeriodEnd(segundoPagamento).toISOString());
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
