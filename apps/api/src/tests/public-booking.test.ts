import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shiftDate, todayInTimeZone, zonedTimeToUtc } from '../core/datetime.js';
import { withSystem } from '../db/context.js';
import { subscriptions } from '../db/schema/index.js';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  errorCode,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/**
 * Agendamento publico: o link so existe quando o pet shop liga, so expoe
 * dados publicos, respeita expediente/conflitos, e o aceite passa pelo fluxo
 * normal de cadastro + agenda (com as mesmas regras e o mesmo isolamento).
 */

const TZ = 'America/Sao_Paulo';
let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let slugA: string;
let slugB: string;
let serviceA: string;
const bookingDate = shiftDate(todayInTimeZone(TZ), 3);
const at = (time: string, date = bookingDate) => zonedTimeToUtc(date, time, TZ).toISOString();

async function slugOf(tenant: TestTenant): Promise<string> {
  const response = await authed(server, tenant.owner, { method: 'GET', url: '/api/tenants/current' });
  return response.json<{ slug: string }>().slug;
}

async function enableBooking(tenant: TestTenant, overrides: Record<string, unknown> = {}): Promise<void> {
  const response = await authed(server, tenant.owner, {
    method: 'PATCH',
    url: '/api/tenants/current',
    payload: {
      timezone: TZ,
      settings: {
        businessHours: { start: '08:00', end: '12:00', weekdays: [0, 1, 2, 3, 4, 5, 6] },
        publicBooking: { enabled: true, minLeadHours: 0, maxDaysAhead: 30, slotIntervalMinutes: 60, ...overrides },
      },
    },
  });
  expect(response.statusCode).toBe(200);
}

function publicRequest(slug: string, payload: Record<string, unknown>) {
  return server.inject({
    method: 'POST',
    url: `/api/public/booking/${slug}/requests`,
    payload: {
      serviceId: serviceA,
      customerName: 'Maria Tutora',
      customerPhone: '11988887777',
      petName: 'Bidu',
      petSpecies: 'DOG',
      ...payload,
    },
  });
}

async function availability(slug: string, date = bookingDate, serviceId = serviceA) {
  const response = await server.inject({
    method: 'GET',
    url: `/api/public/booking/${slug}/availability?serviceId=${serviceId}&date=${date}`,
  });
  return { statusCode: response.statusCode, body: response.json<{ slots: string[]; reason: string }>() };
}

async function pending(session: TestSession) {
  const response = await authed(server, session, { method: 'GET', url: '/api/booking-requests' });
  expect(response.statusCode).toBe(200);
  return response.json<{ id: string; startsAt: string; status: string; matchedCustomerId: string | null }[]>();
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Link A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Link B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
  slugA = await slugOf(shopA);
  slugB = await slugOf(shopB);
  const service = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/services',
    payload: { name: 'Banho Link', durationMinutes: 60, price: 60 },
  });
  serviceA = service.json<{ id: string }>().id;
});

afterAll(async () => {
  await teardownTestApp();
});

describe('perfil publico', () => {
  it('nao existe enquanto o pet shop nao liga o link (mesmo 404 de slug inexistente)', async () => {
    const off = await server.inject({ method: 'GET', url: `/api/public/booking/${slugA}` });
    expect(off.statusCode).toBe(404);
    const missing = await server.inject({ method: 'GET', url: '/api/public/booking/nao-existe-mesmo' });
    expect(missing.statusCode).toBe(404);
    const request = await publicRequest(slugA, { startsAt: at('09:00') });
    expect(request.statusCode).toBe(404);
  });

  it('ligado, devolve so dados publicos e servicos ativos', async () => {
    await enableBooking(shopA);
    const response = await server.inject({ method: 'GET', url: `/api/public/booking/${slugA}` });
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown> & { services: { id: string }[] }>();
    expect(body.name).toBe('Pet Shop Link A');
    expect(body.services.map((service) => service.id)).toEqual([serviceA]);
    expect(Object.keys(body).sort()).toEqual(['logoUrl', 'maxDaysAhead', 'name', 'primaryColor', 'services', 'timezone']);
    expect(response.body).not.toContain(shopA.owner.email);
    expect(response.body).not.toContain(shopA.tenantId);
  });
});

describe('disponibilidade', () => {
  it('lista a grade do expediente e explica dias sem horario', async () => {
    const open = await availability(slugA);
    expect(open.statusCode).toBe(200);
    expect(open.body.reason).toBe('OPEN');
    expect(open.body.slots).toEqual([at('08:00'), at('09:00'), at('10:00'), at('11:00')]);

    expect((await availability(slugA, shiftDate(todayInTimeZone(TZ), -1))).body.reason).toBe('OUT_OF_RANGE');
    expect((await availability(slugA, shiftDate(todayInTimeZone(TZ), 45))).body.reason).toBe('OUT_OF_RANGE');
  });

  it('respeita dias fechados e a antecedencia minima', async () => {
    await enableBooking(shopA, { minLeadHours: 168 });
    const tooSoon = await availability(slugA);
    expect(tooSoon.body.slots).toEqual([]);
    expect(tooSoon.body.reason).toBe('FULL');

    await authed(server, shopA.owner, {
      method: 'PATCH',
      url: '/api/tenants/current',
      payload: { settings: { businessHours: { start: '08:00', end: '12:00', weekdays: [] } } },
    });
    expect((await availability(slugA)).body.reason).toBe('CLOSED_DAY');
    await enableBooking(shopA);
  });

  it('agendamento existente tira o horario da grade', async () => {
    const customer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Ocupado', phone: '11911112222' },
    });
    const customerId = customer.json<{ id: string }>().id;
    const pet = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Ocupado', species: 'CAT' },
    });
    const appointment = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId: pet.json<{ id: string }>().id, serviceId: serviceA, startsAt: at('10:00') },
    });
    expect(appointment.statusCode).toBe(201);
    expect((await availability(slugA)).body.slots).toEqual([at('08:00'), at('09:00'), at('11:00')]);
  });

  it('servico de outro pet shop nao e encontrado', async () => {
    await enableBooking(shopB);
    expect((await availability(slugB, bookingDate, serviceA)).statusCode).toBe(404);
  });
});

describe('solicitacao publica', () => {
  it('valida os campos', async () => {
    const response = await publicRequest(slugA, { startsAt: at('08:00'), customerName: '', petSpecies: 'DRAGON' });
    expect(response.statusCode).toBe(422);
  });

  it('recusa horario fora da grade livre (antes do expediente ou ja ocupado)', async () => {
    const early = await publicRequest(slugA, { startsAt: at('07:00') });
    expect(early.statusCode).toBe(422);
    const busy = await publicRequest(slugA, { startsAt: at('10:00') });
    expect(busy.statusCode).toBe(422);
  });

  it('honeypot preenchido e rejeitado', async () => {
    const response = await publicRequest(slugA, { startsAt: at('08:00'), website: 'x' });
    expect(response.statusCode).toBe(422);
    expect(await pending(shopA.owner)).toHaveLength(0);
  });

  it('registra a solicitacao, reserva o horario e nao cria cliente nem agendamento sozinha', async () => {
    const response = await publicRequest(slugA, { startsAt: at('08:00') });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ status: string }>().status).toBe('PENDING');

    expect((await availability(slugA)).body.slots).not.toContain(at('08:00'));
    const again = await publicRequest(slugA, { startsAt: at('08:00'), customerPhone: '11977776666' });
    expect(again.statusCode).toBe(422);

    const list = await pending(shopA.owner);
    expect(list).toHaveLength(1);
    expect(list[0]?.matchedCustomerId).toBeNull();

    const customers = await authed(server, shopA.owner, { method: 'GET', url: '/api/customers?search=Maria' });
    expect(JSON.stringify(customers.json())).not.toContain('Maria Tutora');
  });
});

describe('lado do pet shop', () => {
  it('outro pet shop nao ve nem responde a solicitacao', async () => {
    const [request] = await pending(shopA.owner);
    expect(await pending(shopB.owner)).toHaveLength(0);
    const accept = await authed(server, shopB.owner, { method: 'POST', url: `/api/booking-requests/${request?.id}/accept` });
    expect(accept.statusCode).toBe(404);
    const reject = await authed(server, shopB.owner, {
      method: 'POST',
      url: `/api/booking-requests/${request?.id}/reject`,
      payload: {},
    });
    expect(reject.statusCode).toBe(404);
  });

  it('aceitar cria cliente, pet e agendamento pelo fluxo normal', async () => {
    const [request] = await pending(shopA.owner);
    const response = await authed(server, staffA, { method: 'POST', url: `/api/booking-requests/${request?.id}/accept` });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ appointment: { id: string; startsAt: string; petId: string }; customerId: string; petId: string }>();
    expect(body.appointment.startsAt).toBe(at('08:00'));
    expect(body.appointment.petId).toBe(body.petId);

    const customer = await authed(server, shopA.owner, { method: 'GET', url: `/api/customers/${body.customerId}` });
    expect(customer.json<{ name: string; tenantId?: string }>().name).toBe('Maria Tutora');
    const appointment = await authed(server, shopA.owner, { method: 'GET', url: `/api/appointments/${body.appointment.id}` });
    expect(appointment.statusCode).toBe(200);

    expect(await pending(shopA.owner)).toHaveLength(0);
    const accepted = await authed(server, shopA.owner, { method: 'GET', url: '/api/booking-requests?status=ACCEPTED' });
    expect(accepted.json<{ appointmentId: string }[]>()[0]?.appointmentId).toBe(body.appointment.id);

    const twice = await authed(server, shopA.owner, { method: 'POST', url: `/api/booking-requests/${request?.id}/accept` });
    expect(twice.statusCode).toBe(409);
  });

  it('segunda solicitacao do mesmo telefone reaproveita cliente e pet', async () => {
    const created = await publicRequest(slugA, { startsAt: at('09:00'), petName: ' bidu ' });
    expect(created.statusCode).toBe(201);
    const [request] = await pending(shopA.owner);
    expect(request?.matchedCustomerId).not.toBeNull();

    const response = await authed(server, shopA.owner, { method: 'POST', url: `/api/booking-requests/${request?.id}/accept` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ customerId: string }>().customerId).toBe(request?.matchedCustomerId);
    const pets = await authed(server, shopA.owner, { method: 'GET', url: `/api/pets?customerId=${request?.matchedCustomerId}` });
    const list = pets.json<{ data?: unknown[] } | unknown[]>();
    const items = Array.isArray(list) ? list : (list.data ?? []);
    expect(items).toHaveLength(1);
  });

  it('conflito no aceite desfaz tudo e mantem a solicitacao pendente', async () => {
    const created = await publicRequest(slugA, { startsAt: at('11:00'), customerPhone: '11955554444', petName: 'Rex' });
    expect(created.statusCode).toBe(201);
    const [request] = await pending(shopA.owner);

    // Enquanto a solicitacao aguardava, a loja ocupou o horario manualmente.
    const customer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Balcao', phone: '11933332222' },
    });
    const customerId = customer.json<{ id: string }>().id;
    const pet = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/pets',
      payload: { customerId, name: 'Balcao', species: 'DOG' },
    });
    const manual = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/appointments',
      payload: { customerId, petId: pet.json<{ id: string }>().id, serviceId: serviceA, startsAt: at('11:00') },
    });
    expect(manual.statusCode).toBe(201);

    const accept = await authed(server, shopA.owner, { method: 'POST', url: `/api/booking-requests/${request?.id}/accept` });
    expect(accept.statusCode).toBe(409);
    expect(await pending(shopA.owner)).toHaveLength(1);
    const search = await authed(server, shopA.owner, { method: 'GET', url: '/api/customers?search=11955554444' });
    expect(JSON.stringify(search.json())).not.toContain('Maria Tutora');
  });

  it('recusar registra o motivo', async () => {
    const [request] = await pending(shopA.owner);
    const response = await authed(server, staffA, {
      method: 'POST',
      url: `/api/booking-requests/${request?.id}/reject`,
      payload: { reason: 'Horario ocupado' },
    });
    expect(response.statusCode).toBe(204);
    const rejected = await authed(server, shopA.owner, { method: 'GET', url: '/api/booking-requests?status=REJECTED' });
    expect(rejected.json<{ rejectionReason: string }[]>()[0]?.rejectionReason).toBe('Horario ocupado');
    const again = await authed(server, shopA.owner, { method: 'POST', url: `/api/booking-requests/${request?.id}/reject`, payload: {} });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again.body)).toBeTruthy();
  });

  it('rotas internas exigem sessao', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/booking-requests' });
    expect(response.statusCode).toBe(401);
  });
});

describe('acesso bloqueado', () => {
  it('pet shop com trial vencido some do link publico', async () => {
    const expired = await createTenantWithOwner(server, { tenantName: 'Pet Shop Vencido' });
    await enableBooking(expired);
    const slug = await slugOf(expired);
    expect((await server.inject({ method: 'GET', url: `/api/public/booking/${slug}` })).statusCode).toBe(200);

    await withSystem((tx) =>
      tx.update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(subscriptions.tenantId, expired.tenantId)),
    );
    expect((await server.inject({ method: 'GET', url: `/api/public/booking/${slug}` })).statusCode).toBe(404);
  });
});
