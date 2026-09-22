import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subscriptions } from '../db/schema/index.js';
import { withSystem } from '../db/context.js';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  errorCode,
  setupTestApp,
  teardownTestApp,
  type TestTenant,
} from './helpers.js';

/**
 * Entitlements, trial e paywall.
 *
 * Este e o nucleo comercial do produto: se qualquer teste aqui falhar, o
 * frontend pode ate mostrar os numeros certos, mas o backend nao estaria
 * impedindo de verdade que alguem ultrapasse o plano.
 */

let server: FastifyInstance;
let shop: TestTenant;

beforeAll(async () => {
  server = await setupTestApp();
  shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Billing' });
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Status da assinatura', () => {
  it('todo tenant nasce em TRIALING, com o plano TRIAL e trial ativo', async () => {
    const response = await authed(server, shop.owner, { method: 'GET', url: '/api/billing/status' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      plan: { code: string; limits: Record<string, number | null> };
      subscription: { status: string; trialEndsAt: string | null };
      trial: { active: boolean; hoursRemaining: number | null };
      access: { blocked: boolean };
      usage: Record<string, { used: number; limit: number | null }>;
    }>();

    expect(body.plan.code).toBe('TRIAL');
    expect(body.plan.limits.customers).toBe(10);
    expect(body.subscription.status).toBe('TRIALING');
    expect(body.trial.active).toBe(true);
    expect(body.trial.hoursRemaining).toBeGreaterThan(0);
    expect(body.access.blocked).toBe(false);
    expect(body.usage.customers).toEqual({ used: 0, limit: 10 });
  });

  it('GET /auth/me tambem carrega o billing, sem chamada extra', async () => {
    const response = await authed(server, shop.owner, { method: 'GET', url: '/api/auth/me' });
    const body = response.json<{ billing: { plan: { code: string } } }>();
    expect(body.billing.plan.code).toBe('TRIAL');
  });

  it('apenas OWNER acessa billing -- STAFF recebe 403', async () => {
    const staff = await createUserAndLogin(server, shop.owner, { role: 'STAFF' });
    const response = await authed(server, staff, { method: 'GET', url: '/api/billing/status' });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('INSUFFICIENT_PERMISSION');
  });
});

describe('Recursos que dependem do plano', () => {
  it('o plano TRIAL nao tem relatorios avancados', async () => {
    const response = await authed(server, shop.owner, {
      method: 'GET',
      url: '/api/reports/overview?from=2020-01-01&to=2030-01-01',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ advanced: boolean; topServices: unknown }>();
    expect(body.advanced).toBe(false);
    expect(body.topServices).toBeNull();
  });
});

describe('Checkout sem provider configurado', () => {
  it('responde 200 com checkoutUrl nulo, nunca finge um pagamento aprovado', async () => {
    const response = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/billing/checkout',
      payload: { planCode: 'PRO' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ checkoutUrl: string | null; message: string }>();
    expect(body.checkoutUrl).toBeNull();
    expect(body.message.length).toBeGreaterThan(0);
  });
});

// Testes especificos da integracao Cakto (webhook, idempotencia, CaktoProvider)
// ficam em cakto.test.ts.

describe('Limites do trial sao aplicados pelo backend', () => {
  it('bloqueia a criacao do 6o servico (limite trial = 5)', async () => {
    for (let index = 1; index <= 5; index += 1) {
      const response = await authed(server, shop.owner, {
        method: 'POST',
        url: '/api/services',
        payload: { name: `Servico ${index}`, durationMinutes: 30, price: 50 },
      });
      expect(response.statusCode).toBe(201);
    }

    const sixth = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Servico excedente', durationMinutes: 30, price: 50 },
    });

    expect(sixth.statusCode).toBe(409);
    expect(errorCode(sixth.body)).toBe('LIMIT_REACHED');
    expect(sixth.json<{ error: { message: string } }>().error.message).toContain('5');
  });

  it('bloqueia a criacao do 11o cliente (limite trial = 10)', async () => {
    for (let index = 1; index <= 10; index += 1) {
      const response = await authed(server, shop.owner, {
        method: 'POST',
        url: '/api/customers',
        payload: { name: `Cliente Trial ${index}`, phone: '11988887777' },
      });
      expect(response.statusCode).toBe(201);
    }

    const eleventh = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente excedente', phone: '11988887777' },
    });

    expect(eleventh.statusCode).toBe(409);
    expect(errorCode(eleventh.body)).toBe('LIMIT_REACHED');
  });

  it('desativar um cliente libera a cota para um novo', async () => {
    const list = await authed(server, shop.owner, { method: 'GET', url: '/api/customers?pageSize=1' });
    const firstId = list.json<{ data: { id: string }[] }>().data[0]?.id;
    expect(firstId).toBeTruthy();

    const deactivate = await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/customers/${firstId}`,
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const created = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Reposicao', phone: '11988887777' },
    });
    expect(created.statusCode).toBe(201);
  });

  it('bloqueia a criacao do 3o usuario (limite trial = 2)', async () => {
    // Tenant dedicado: `shop` ja tem um STAFF criado por um teste anterior
    // neste mesmo arquivo (o de permissao de billing), entao reaproveita-lo
    // aqui testaria um numero errado por acidente.
    const fresh = await createTenantWithOwner(server, { tenantName: 'Pet Shop Limite De Usuarios' });

    // O OWNER ja conta como 1. Mais 1 chega no limite; o 3o estoura.
    const second = await authed(server, fresh.owner, {
      method: 'POST',
      url: '/api/users',
      payload: { name: 'Segundo Usuario', email: 'segundo.usuario@teste.com', password: 'senhaSegura1', role: 'STAFF' },
    });
    expect(second.statusCode).toBe(201);

    const third = await authed(server, fresh.owner, {
      method: 'POST',
      url: '/api/users',
      payload: { name: 'Terceiro Usuario', email: 'terceiro.usuario@teste.com', password: 'senhaSegura1', role: 'STAFF' },
    });
    expect(third.statusCode).toBe(409);
    expect(errorCode(third.body)).toBe('LIMIT_REACHED');
  });
});

describe('Paywall quando o trial expira', () => {
  it('bloqueia escrita e devolve access.blocked=true quando o trial vence', async () => {
    const expired = await createTenantWithOwner(server, { tenantName: 'Pet Shop Trial Vencido' });

    // Sem maquina do tempo na API: forcamos a expiracao direto no banco,
    // exatamente como aconteceria organicamente 48h depois do cadastro.
    await withSystem((tx) =>
      tx
        .update(subscriptions)
        .set({ trialEndsAt: new Date(Date.now() - 60_000) })
        .where(eq(subscriptions.tenantId, expired.tenantId)),
    );

    const status = await authed(server, expired.owner, { method: 'GET', url: '/api/billing/status' });
    const statusBody = status.json<{ access: { blocked: boolean; reason: string | null }; trial: { active: boolean } }>();
    expect(statusBody.access.blocked).toBe(true);
    expect(statusBody.access.reason).toBe('TRIAL_EXPIRED');
    expect(statusBody.trial.active).toBe(false);

    const createAttempt = await authed(server, expired.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Pos Trial', phone: '11988887777' },
    });
    expect(createAttempt.statusCode).toBe(403);
    expect(errorCode(createAttempt.body)).toBe('SUBSCRIPTION_REQUIRED');

    // Leitura continua funcionando: os dados do usuario nao somem.
    const dashboard = await authed(server, expired.owner, {
      method: 'GET',
      url: '/api/dashboard/overview',
    });
    expect(dashboard.statusCode).toBe(200);
  });

  it('mesmo com o trial vencido, ainda e possivel cancelar um agendamento existente', async () => {
    const tenant = await createTenantWithOwner(server, { tenantName: 'Pet Shop Cancela Mesmo Vencido' });

    const customer = await authed(server, tenant.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Antes Do Vencimento', phone: '11988887777' },
    });
    const customerId = customer.json<{ id: string }>().id;

    const pet = await authed(server, tenant.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Rex', species: 'DOG' },
    });
    const petId = pet.json<{ id: string }>().id;

    const service = await authed(server, tenant.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Banho Simples', durationMinutes: 30, price: 40 },
    });
    const serviceId = service.json<{ id: string }>().id;

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const appointment = await authed(server, tenant.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, startsAt },
    });
    const appointmentId = appointment.json<{ id: string }>().id;

    await withSystem((tx) =>
      tx
        .update(subscriptions)
        .set({ trialEndsAt: new Date(Date.now() - 60_000) })
        .where(eq(subscriptions.tenantId, tenant.tenantId)),
    );

    const cancel = await authed(server, tenant.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'CANCELLED', reason: 'Cliente pediu para remarcar.' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json<{ status: string }>().status).toBe('CANCELLED');
  });
});
