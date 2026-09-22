import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  createTenantWithOwner,
  errorCode,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestTenant,
} from './helpers.js';

/**
 * Clientes, pets, servicos e agenda: CRUD, propriedade cruzada e conflito de
 * horario. Isolamento entre tenants para estas entidades ja e coberto em
 * detalhe em tenant-isolation.test.ts (nivel banco); aqui o foco e o
 * comportamento observavel via HTTP.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let entityCounter = 0;

/**
 * Cria cliente+pet+servico de teste com nomes unicos a cada chamada.
 * Servico repetido com o MESMO nome no mesmo tenant e rejeitado (409) por
 * design -- reaproveitar um nome fixo aqui derrubaria os proprios testes.
 */
async function seedBusinessEntities(tenant: TestTenant) {
  entityCounter += 1;
  const suffix = entityCounter;

  const customer = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: `Joana Ferreira ${suffix}`, phone: '11988887777' },
  });
  const customerId = customer.json<{ id: string }>().id;

  const pet = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId, name: `Bidu ${suffix}`, species: 'DOG' },
  });
  const petId = pet.json<{ id: string }>().id;

  const service = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/services',
    payload: { name: `Banho e Tosa ${suffix}`, durationMinutes: 60, price: 90 },
  });
  const serviceId = service.json<{ id: string }>().id;

  return { customerId, petId, serviceId };
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Negocio A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Negocio B' });
  // O foco deste arquivo e comportamento de CRUD/estado, nao entitlements --
  // que ja tem cobertura dedicada em billing.test.ts.
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Clientes', () => {
  it('valida campos obrigatorios e formato de telefone', async () => {
    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'A', phone: '123' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { fields: { field: string }[] } }>();
    expect(body.error.fields.some((f) => f.field === 'name')).toBe(true);
    expect(body.error.fields.some((f) => f.field === 'phone')).toBe(true);
  });

  it('cria, busca e desativa um cliente', async () => {
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Marcia Nunes', phone: '11988887777', email: 'marcia@exemplo.com' },
    });
    expect(created.statusCode).toBe(201);
    const customerId = created.json<{ id: string }>().id;

    const found = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/customers/${customerId}`,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json<{ petsCount: number; totalSpent: number }>().petsCount).toBe(0);

    const deactivated = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/customers/${customerId}`,
      payload: { active: false },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json<{ active: boolean }>().active).toBe(false);
  });

  it('cliente de outro tenant e 404, nunca 403', async () => {
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Exclusivo A', phone: '11988887777' },
    });
    const customerId = created.json<{ id: string }>().id;

    const response = await authed(server, shopB.owner, {
      method: 'GET',
      url: `/api/customers/${customerId}`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('Pets', () => {
  it('recusa pet vinculado a cliente de outro tenant', async () => {
    const customerA = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Dono Do Tenant A', phone: '11988887777' },
    });
    const customerIdA = customerA.json<{ id: string }>().id;

    const response = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId: customerIdA, name: 'Invasor', species: 'DOG' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('recusa peso negativo e especie invalida', async () => {
    const customer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Tutor Validacao', phone: '11988887777' },
    });
    const customerId = customer.json<{ id: string }>().id;

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Pet Invalido', species: 'DRAGON', weightKg: -5 },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('Servicos', () => {
  it('recusa nome duplicado dentro do mesmo tenant', async () => {
    await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Hidratacao', durationMinutes: 45, price: 70 },
    });

    const duplicate = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'hidratacao', durationMinutes: 45, price: 70 },
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it('o mesmo nome e permitido em tenants diferentes', async () => {
    const response = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Hidratacao', durationMinutes: 45, price: 70 },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('Agenda', () => {
  it('cria um agendamento herdando preco e duracao do servico', async () => {
    const { customerId, petId, serviceId } = await seedBusinessEntities(shopA);
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, startsAt },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ price: number; status: string; endsAt: string }>();
    expect(body.price).toBe(90);
    expect(body.status).toBe('SCHEDULED');
  });

  it('recusa agendamento com pet que nao pertence ao cliente informado', async () => {
    const { petId, serviceId } = await seedBusinessEntities(shopA);
    const otherCustomer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Outro Cliente', phone: '11988887777' },
    });
    const otherCustomerId = otherCustomer.json<{ id: string }>().id;

    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: {
        customerId: otherCustomerId,
        petId,
        serviceId,
        startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('recusa agendamento no horario ja ocupado pelo mesmo profissional', async () => {
    const { customerId, petId, serviceId } = await seedBusinessEntities(shopA);

    const professional = await authed(server, shopA.owner, {
      method: 'GET',
      url: '/api/users?pageSize=1',
    });
    const professionalId = professional.json<{ data: { id: string }[] }>().data[0]?.id;

    const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const first = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, professionalId, startsAt },
    });
    expect(first.statusCode).toBe(201);

    const conflictStart = new Date(new Date(startsAt).getTime() + 15 * 60_000).toISOString();
    const second = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, professionalId, startsAt: conflictStart },
    });

    expect(second.statusCode).toBe(409);
    expect(errorCode(second.body)).toBe('TIME_SLOT_TAKEN');
  });

  it('recusa horario no passado sem allowPast', async () => {
    const { customerId, petId, serviceId } = await seedBusinessEntities(shopA);
    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: {
        customerId,
        petId,
        serviceId,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('segue a maquina de estados: nao pula de agendado direto para concluido', async () => {
    const { customerId, petId, serviceId } = await seedBusinessEntities(shopA);
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString() },
    });
    const appointmentId = created.json<{ id: string }>().id;

    const invalid = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'COMPLETED' },
    });
    expect(invalid.statusCode).toBe(409);
    expect(errorCode(invalid.body)).toBe('INVALID_STATUS_TRANSITION');

    const toConfirmed = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'CONFIRMED' },
    });
    expect(toConfirmed.statusCode).toBe(200);

    const toInProgress = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(toInProgress.statusCode).toBe(200);

    const toCompleted = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'COMPLETED' },
    });
    expect(toCompleted.statusCode).toBe(200);
    expect(toCompleted.json<{ status: string }>().status).toBe('COMPLETED');

    const reopen = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}/status`,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(reopen.statusCode).toBe(409);
  });

  it('agendamento de outro tenant e 404', async () => {
    const { customerId, petId, serviceId } = await seedBusinessEntities(shopB);
    const created = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    });
    const appointmentId = created.json<{ id: string }>().id;

    const response = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/appointments/${appointmentId}`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('Recuperacao de clientes e mensagens', () => {
  it('lista candidatos a recuperacao e registra uma mensagem manual', async () => {
    const retention = await authed(server, shopA.owner, { method: 'GET', url: '/api/retention' });
    expect(retention.statusCode).toBe(200);

    const { customerId } = await seedBusinessEntities(shopA);
    const message = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/messages',
      payload: { customerId, type: 'MANUAL', content: 'Ola! Tudo bem?' },
    });
    expect(message.statusCode).toBe(201);
    expect(message.json<{ status: string }>().status).toBe('OPENED_EXTERNALLY');

    const list = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages' });
    expect(list.statusCode).toBe(200);
  });
});

describe('Relatorios', () => {
  it('devolve relatorio com topServices no plano PRO (advanced_reports)', async () => {
    // shopA foi promovido a PRO no beforeAll deste arquivo; o comportamento
    // "basico, sem topServices" do TRIAL e testado especificamente em
    // billing.test.ts, no tenant que permanece em TRIAL de proposito.
    const from = '2020-01-01';
    const to = '2030-01-01';
    const response = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/reports/overview?from=${from}&to=${to}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ advanced: boolean; topServices: unknown }>();
    expect(body.advanced).toBe(true);
    expect(Array.isArray(body.topServices)).toBe(true);
  });
});
