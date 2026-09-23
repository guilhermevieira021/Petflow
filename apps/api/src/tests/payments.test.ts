import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  createTenantWithOwner,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestTenant,
} from './helpers.js';

/**
 * Rota de pagamentos: a tabela `payments` e as permissoes PAYMENTS_READ/WRITE
 * ja existiam, mas nao havia contrato/service/rota ate agora. Aqui cobrimos
 * o que o endpoint faz de fato: heranca de valor do agendamento, maquina de
 * estados, e isolamento entre tenants (mesmo padrao de business.test.ts).
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;

async function seedCustomerPetService(tenant: TestTenant, suffix: string) {
  const customer = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: `Cliente Pagamento ${suffix}`, phone: '11988887777' },
  });
  const customerId = customer.json<{ id: string }>().id;

  const pet = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId, name: `Pet ${suffix}`, species: 'DOG' },
  });
  const petId = pet.json<{ id: string }>().id;

  const service = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/services',
    payload: { name: `Servico Pagamento ${suffix}`, durationMinutes: 30, price: 80 },
  });
  const serviceId = service.json<{ id: string }>().id;

  return { customerId, petId, serviceId };
}

async function seedCompletedAppointment(tenant: TestTenant, ids: { customerId: string; petId: string; serviceId: string }) {
  const created = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/appointments',
    payload: { ...ids, startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), allowPast: true },
  });
  const appointmentId = created.json<{ id: string }>().id;

  await authed(server, tenant.owner, {
    method: 'PATCH',
    url: `/api/appointments/${appointmentId}/status`,
    payload: { status: 'IN_PROGRESS' },
  });
  await authed(server, tenant.owner, {
    method: 'PATCH',
    url: `/api/appointments/${appointmentId}/status`,
    payload: { status: 'COMPLETED' },
  });

  return appointmentId;
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Pagamento A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Pagamento B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Pagamentos', () => {
  it('herda o valor do agendamento quando amount e omitido', async () => {
    const ids = await seedCustomerPetService(shopA, 'heranca');
    const appointmentId = await seedCompletedAppointment(shopA, ids);

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, appointmentId, method: 'PIX' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ amount: number; status: string; paidAt: string | null }>();
    expect(body.amount).toBe(80);
    expect(body.status).toBe('PAID');
    expect(body.paidAt).not.toBeNull();
  });

  it('exige amount quando nao ha appointmentId', async () => {
    const ids = await seedCustomerPetService(shopA, 'sem-valor');

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, method: 'CASH' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('aceita um pagamento avulso, sem agendamento, com amount explicito', async () => {
    const ids = await seedCustomerPetService(shopA, 'avulso');

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, amount: 35.5, method: 'CASH', notes: 'Venda de produto avulso.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ amount: number; appointmentId: string | null }>();
    expect(body.amount).toBe(35.5);
    expect(body.appointmentId).toBeNull();
  });

  it('recusa agendamento que pertence a outro cliente do mesmo tenant', async () => {
    const ids = await seedCustomerPetService(shopA, 'dono-errado');
    const appointmentId = await seedCompletedAppointment(shopA, ids);

    const outroCliente = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Outro Cliente Pagamento', phone: '11988887777' },
    });
    const outroClienteId = outroCliente.json<{ id: string }>().id;

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: outroClienteId, appointmentId, method: 'PIX' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('maquina de estados: PENDING -> PAID e permitido, PAID -> PENDING e recusado', async () => {
    const ids = await seedCustomerPetService(shopA, 'estados');

    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, amount: 60, method: 'TRANSFER', status: 'PENDING' },
    });
    expect(created.statusCode).toBe(201);
    const paymentId = created.json<{ id: string; status: string; paidAt: string | null }>().id;
    expect(created.json<{ status: string; paidAt: string | null }>().paidAt).toBeNull();

    const paid = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/payments/${paymentId}/status`,
      payload: { status: 'PAID' },
    });
    expect(paid.statusCode).toBe(200);
    const paidBody = paid.json<{ status: string; paidAt: string | null }>();
    expect(paidBody.status).toBe('PAID');
    expect(paidBody.paidAt).not.toBeNull();

    const invalidBack = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/payments/${paymentId}/status`,
      payload: { status: 'PENDING' },
    });
    expect(invalidBack.statusCode).toBe(409);
  });

  it('pagamento de outro tenant e 404, nunca 403', async () => {
    const idsA = await seedCustomerPetService(shopA, 'isolamento');
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: idsA.customerId, amount: 42, method: 'CASH' },
    });
    const paymentId = created.json<{ id: string }>().id;

    const response = await authed(server, shopB.owner, {
      method: 'GET',
      url: `/api/payments/${paymentId}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('totalSpent do cliente passa a refletir pagamentos PAID de verdade', async () => {
    const ids = await seedCustomerPetService(shopA, 'total-spent');

    await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, amount: 25, method: 'PIX' },
    });
    await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/payments',
      payload: { customerId: ids.customerId, amount: 15, method: 'CASH', status: 'PENDING' },
    });

    const customer = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/customers/${ids.customerId}`,
    });
    // So o pagamento PAID (25) entra -- o PENDING (15) ainda nao foi recebido.
    expect(customer.json<{ totalSpent: number }>().totalSpent).toBe(25);
  });
});
