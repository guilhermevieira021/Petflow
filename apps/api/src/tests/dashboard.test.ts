import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '../db/context.js';
import { payments } from '../db/schema/index.js';
import { authed, createTenantWithOwner, setupTestApp, teardownTestApp, type TestTenant } from './helpers.js';

/**
 * Indicadores de HOJE e da SEMANA no dashboard.
 *
 * Data de referencia fixa (2026-09-23, uma quarta-feira -- confirmado via
 * `new Date('2026-09-23T00:00:00Z').getUTCDay() === 3`) em vez de "hoje" de
 * verdade: sem isso o teste seria nao-deterministico dependendo do dia em
 * que a suite roda, e especificamente fragil perto da virada de semana.
 *
 * Semana de calendario (domingo-sabado) contendo 2026-09-23:
 *   domingo 2026-09-20  ...  sabado 2026-09-26
 */
const REFERENCE_DATE = '2026-09-23';
const WEEK_START = '2026-09-20';
const WEEK_END = '2026-09-26';

async function seedAppointment(
  server: FastifyInstance,
  tenant: TestTenant,
  params: { customerId: string; petId: string; serviceId: string; startsAt: string; price: number },
): Promise<string> {
  const response = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/appointments',
    payload: {
      customerId: params.customerId,
      petId: params.petId,
      serviceId: params.serviceId,
      startsAt: params.startsAt,
      price: params.price,
      allowPast: true,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Falha ao criar agendamento de teste: ${response.body}`);
  }
  return response.json<{ id: string }>().id;
}

let server: FastifyInstance;

beforeAll(async () => {
  server = await setupTestApp();
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Dashboard -- indicadores de hoje e da semana', () => {
  it('semana inclui dias futuros da mesma semana e exclui dias de outras semanas; cancelado nunca entra no previsto', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Dashboard Semana' });

    const customer = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Dashboard', phone: '11988887777' },
    });
    const customerId = customer.json<{ id: string }>().id;

    const pet = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Rex', species: 'DOG' },
    });
    const petId = pet.json<{ id: string }>().id;

    const service = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Banho', durationMinutes: 60, price: 90 },
    });
    const serviceId = service.json<{ id: string }>().id;

    // 1. Quarta (REFERENCE_DATE, "hoje") -- conta em today E em week.
    await seedAppointment(server, shop, {
      customerId,
      petId,
      serviceId,
      startsAt: '2026-09-23T15:00:00.000Z',
      price: 100,
    });

    // 2. Sexta da MESMA semana, dia FUTURO em relacao a "hoje" -- conta so em week.
    await seedAppointment(server, shop, {
      customerId,
      petId,
      serviceId,
      startsAt: '2026-09-25T15:00:00.000Z',
      price: 50,
    });

    // 3. Segunda da semana SEGUINTE -- fora da janela, nao conta em nenhum dos dois.
    await seedAppointment(server, shop, {
      customerId,
      petId,
      serviceId,
      startsAt: '2026-09-28T15:00:00.000Z',
      price: 200,
    });

    // 4. Quinta da mesma semana, mas CANCELADO -- nunca entra no previsto,
    // nem hoje nem na semana (mesma regra dos dois).
    const cancelledId = await seedAppointment(server, shop, {
      customerId,
      petId,
      serviceId,
      startsAt: '2026-09-24T15:00:00.000Z',
      price: 999,
    });
    const cancel = await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/appointments/${cancelledId}/status`,
      payload: { status: 'CANCELLED', reason: 'Teste de dashboard.' },
    });
    expect(cancel.statusCode).toBe(200);

    // Pagamentos gravados direto no banco -- ainda nao existe endpoint de
    // pagamento na aplicacao (so o seed de desenvolvimento grava nessa
    // tabela hoje), entao e assim que qualquer teste real precisa fazer isso.
    await withSystem((tx) =>
      tx.insert(payments).values([
        {
          tenantId: shop.tenantId,
          customerId,
          amount: '40.00',
          method: 'CASH',
          status: 'PAID',
          paidAt: new Date('2026-09-23T18:00:00.000Z'), // hoje -- conta em today E week
        },
        {
          tenantId: shop.tenantId,
          customerId,
          amount: '25.00',
          method: 'PIX',
          status: 'PAID',
          paidAt: new Date('2026-09-21T18:00:00.000Z'), // segunda da mesma semana -- so em week
        },
        {
          tenantId: shop.tenantId,
          customerId,
          amount: '999.00',
          method: 'PIX',
          status: 'PAID',
          paidAt: new Date('2026-09-28T18:00:00.000Z'), // semana seguinte -- fora da janela
        },
      ]),
    );

    const response = await authed(server, shop.owner, {
      method: 'GET',
      url: `/api/dashboard/overview?date=${REFERENCE_DATE}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      today: { expectedRevenue: number; receivedRevenue: number };
      week: { weekStart: string; weekEnd: string; expectedRevenue: number; receivedRevenue: number };
    }>();

    expect(body.week.weekStart).toBe(WEEK_START);
    expect(body.week.weekEnd).toBe(WEEK_END);

    // Hoje: so o agendamento 1 (100) e o pagamento de hoje (40).
    expect(body.today.expectedRevenue).toBe(100);
    expect(body.today.receivedRevenue).toBe(40);

    // Semana: agendamentos 1+2 (100+50=150, o 3 fica de fora por estar na
    // semana seguinte, o cancelado nunca entra) e pagamentos de hoje+segunda
    // (40+25=65, o de semana seguinte fica de fora).
    expect(body.week.expectedRevenue).toBe(150);
    expect(body.week.receivedRevenue).toBe(65);
  });

  it('nunca confunde "nao realizado" com cliente perdido -- e so previsto menos recebido, calculavel a partir dos mesmos dois numeros ja expostos', async () => {
    const shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Dashboard Nao Realizado' });

    const customer = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Nao Realizado', phone: '11988887777' },
    });
    const customerId = customer.json<{ id: string }>().id;
    const pet = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Mel', species: 'CAT' },
    });
    const petId = pet.json<{ id: string }>().id;
    const service = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/services',
      payload: { name: 'Tosa', durationMinutes: 45, price: 70 },
    });
    const serviceId = service.json<{ id: string }>().id;

    await seedAppointment(server, shop, {
      customerId,
      petId,
      serviceId,
      startsAt: '2026-09-23T15:00:00.000Z',
      price: 120,
    });

    const response = await authed(server, shop.owner, {
      method: 'GET',
      url: `/api/dashboard/overview?date=${REFERENCE_DATE}`,
    });
    const body = response.json<{ today: { expectedRevenue: number; receivedRevenue: number } }>();

    // Nao ha um campo "naoRealizado" separado no contrato -- de proposito:
    // e uma subtracao trivial dos dois numeros ja existentes, calculada no
    // frontend, para nunca poder divergir da fonte real (previsto/recebido).
    expect(body.today.expectedRevenue).toBe(120);
    expect(body.today.receivedRevenue).toBe(0);
    const naoRealizado = body.today.expectedRevenue - body.today.receivedRevenue;
    expect(naoRealizado).toBe(120);
  });
});
