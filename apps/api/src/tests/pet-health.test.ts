import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shiftDate, todayInTimeZone } from '../core/datetime.js';
import { dueStatusFor } from '../modules/health/health.service.js';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/** Historico clinico: persistencia, alertas de vencimento, permissoes e isolamento. */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let petA: string;
let petB: string;
const today = todayInTimeZone('America/Sao_Paulo');

interface RecordBody {
  id: string;
  type: string;
  title: string;
  dueStatus: string;
  nextDueOn: string | null;
}

async function createPet(tenant: TestTenant, name: string): Promise<string> {
  const customer = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: `Tutor ${name}`, phone: '11966665555' },
  });
  const pet = await authed(server, tenant.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId: customer.json<{ id: string }>().id, name, species: 'CAT' },
  });
  return pet.json<{ id: string }>().id;
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Saude A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Saude B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
  petA = await createPet(shopA, 'Mimi');
  petB = await createPet(shopB, 'Tom');
});

afterAll(async () => {
  await teardownTestApp();
});

describe('unidade', () => {
  it('classifica vencido, vencendo e em dia', () => {
    expect(dueStatusFor('2026-01-01', '2026-01-10')).toBe('OVERDUE');
    expect(dueStatusFor('2026-01-20', '2026-01-10')).toBe('DUE_SOON');
    expect(dueStatusFor('2026-06-01', '2026-01-10')).toBe('OK');
    expect(dueStatusFor(null, '2026-01-10')).toBe('NONE');
  });
});

describe('historico clinico', () => {
  it('STAFF registra vacina e o historico volta em ordem cronologica (mais recente primeiro)', async () => {
    const older = await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'DEWORMER', title: 'Vermifugo X', occurredOn: shiftDate(today, -200) },
    });
    expect(older.statusCode).toBe(201);
    const newer = await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'VACCINE', title: 'V4 felina', occurredOn: shiftDate(today, -350), nextDueOn: shiftDate(today, 10) },
    });
    expect(newer.json<RecordBody>().dueStatus).toBe('DUE_SOON');

    const list = await authed(server, staffA, { method: 'GET', url: `/api/pets/${petA}/health` });
    const records = list.json<RecordBody[]>();
    expect(records.map((record) => record.title)).toEqual(['Vermifugo X', 'V4 felina']);
  });

  it('valida: proxima data antes da aplicacao e tipo invalido sao 422', async () => {
    const dates = await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'VACCINE', title: 'Raiva', occurredOn: today, nextDueOn: shiftDate(today, -1) },
    });
    expect(dates.statusCode).toBe(422);
    const type = await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'SURGERY', title: 'X', occurredOn: today },
    });
    expect(type.statusCode).toBe(422);
  });

  it('reaplicar o mesmo item encerra o alerta do registro anterior', async () => {
    await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'VACCINE', title: 'Antirrabica', occurredOn: shiftDate(today, -400), nextDueOn: shiftDate(today, -35) },
    });
    let due = await authed(server, shopA.owner, { method: 'GET', url: '/api/health/due' });
    expect(due.json<{ title: string; dueStatus: string }[]>().find((item) => item.title === 'Antirrabica')?.dueStatus).toBe('OVERDUE');

    await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'VACCINE', title: 'antirrabica', occurredOn: shiftDate(today, -30), nextDueOn: shiftDate(today, 335) },
    });
    due = await authed(server, shopA.owner, { method: 'GET', url: '/api/health/due' });
    expect(due.json<{ title: string }[]>().some((item) => item.title.toLowerCase() === 'antirrabica')).toBe(false);

    const history = await authed(server, staffA, { method: 'GET', url: `/api/pets/${petA}/health` });
    const antirrabica = history.json<RecordBody[]>().filter((record) => record.title.toLowerCase() === 'antirrabica');
    expect(antirrabica.map((record) => record.dueStatus)).toEqual(['OK', 'NONE']);
  });

  it('o dashboard mostra os vencimentos no indicador de saude', async () => {
    const overview = await authed(server, shopA.owner, { method: 'GET', url: '/api/dashboard/overview' });
    const healthDue = overview.json<{ healthDue: { overdue: number; dueSoon: number } }>().healthDue;
    expect(healthDue.dueSoon).toBeGreaterThanOrEqual(1);
  });

  it('STAFF nao exclui registro clinico (403); ADMIN/OWNER exclui (exclusao logica)', async () => {
    const created = await authed(server, staffA, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'CLINICAL_NOTE', title: 'Otite leve', occurredOn: today, notes: 'Limpeza semanal' },
    });
    const { id } = created.json<RecordBody>();
    expect((await authed(server, staffA, { method: 'DELETE', url: `/api/pets/${petA}/health/${id}` })).statusCode).toBe(403);
    expect((await authed(server, shopA.owner, { method: 'DELETE', url: `/api/pets/${petA}/health/${id}` })).statusCode).toBe(204);
    const list = await authed(server, staffA, { method: 'GET', url: `/api/pets/${petA}/health` });
    expect(list.json<RecordBody[]>().some((record) => record.id === id)).toBe(false);
  });
});

describe('isolamento', () => {
  it('o pet shop B nao le nem registra no pet do A, e a lista de vencimentos e separada', async () => {
    expect((await authed(server, shopB.owner, { method: 'GET', url: `/api/pets/${petA}/health` })).statusCode).toBe(404);
    const write = await authed(server, shopB.owner, {
      method: 'POST',
      url: `/api/pets/${petA}/health`,
      payload: { type: 'VACCINE', title: 'Invasao', occurredOn: today },
    });
    expect(write.statusCode).toBe(404);

    await authed(server, shopB.owner, {
      method: 'POST',
      url: `/api/pets/${petB}/health`,
      payload: { type: 'VACCINE', title: 'V5 do B', occurredOn: shiftDate(today, -360), nextDueOn: shiftDate(today, 5) },
    });
    const dueB = await authed(server, shopB.owner, { method: 'GET', url: '/api/health/due' });
    const titles = dueB.json<{ title: string }[]>().map((item) => item.title);
    expect(titles).toContain('V5 do B');
    expect(titles).not.toContain('V4 felina');
  });
});
