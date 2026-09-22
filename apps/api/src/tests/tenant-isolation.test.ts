import { DEFAULT_TENANT_SETTINGS } from '@petflow/contracts';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant } from '../db/context.js';
import { appointments, customers, pets, services, tenants } from '../db/schema/index.js';
import { toMoneyLiteral } from '../core/serialization.js';
import {
  authed,
  createTenantWithOwner,
  errorCode,
  setupTestApp,
  teardownTestApp,
  type TestTenant,
} from './helpers.js';

/**
 * ISOLAMENTO MULTI-TENANT -- o teste mais importante deste projeto.
 *
 * Se qualquer caso aqui falhar, o produto nao pode ser vendido: significa que
 * um pet shop consegue enxergar os clientes do concorrente.
 *
 * Testamos em duas alturas:
 *   - HTTP: o comportamento que o cliente da API observa.
 *   - Banco: as policies de RLS, exercitadas com consultas DELIBERADAMENTE
 *     escritas sem filtro de tenant, simulando um bug de aplicacao.
 */

let server: FastifyInstance;
let petShopA: TestTenant;
let petShopB: TestTenant;

/** Dados de negocio plantados direto no banco, um conjunto por tenant. */
interface Fixtures {
  customerId: string;
  petId: string;
  serviceId: string;
  appointmentId: string;
}

const fixtures = new Map<string, Fixtures>();

async function seedBusinessData(tenantId: string, label: string): Promise<void> {
  const created = await withSystem(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ tenantId, name: `Cliente ${label}`, phone: '11988887777' })
      .returning({ id: customers.id });
    if (!customer) throw new Error('fixture: cliente');

    const [pet] = await tx
      .insert(pets)
      .values({ tenantId, customerId: customer.id, name: `Pet ${label}`, species: 'DOG' })
      .returning({ id: pets.id });
    if (!pet) throw new Error('fixture: pet');

    const [service] = await tx
      .insert(services)
      .values({
        tenantId,
        name: `Banho ${label}`,
        durationMinutes: 60,
        price: toMoneyLiteral(80),
      })
      .returning({ id: services.id });
    if (!service) throw new Error('fixture: servico');

    const startsAt = new Date(Date.now() + 86_400_000);
    const [appointment] = await tx
      .insert(appointments)
      .values({
        tenantId,
        customerId: customer.id,
        petId: pet.id,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        price: toMoneyLiteral(80),
      })
      .returning({ id: appointments.id });
    if (!appointment) throw new Error('fixture: agendamento');

    return {
      customerId: customer.id,
      petId: pet.id,
      serviceId: service.id,
      appointmentId: appointment.id,
    };
  });

  fixtures.set(tenantId, created);
}

beforeAll(async () => {
  server = await setupTestApp();
  petShopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop A' });
  petShopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop B' });
  await seedBusinessData(petShopA.tenantId, 'A');
  await seedBusinessData(petShopB.tenantId, 'B');
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Isolamento via HTTP', () => {
  it('o Tenant A recebe 404 ao buscar um usuario do Tenant B', async () => {
    const response = await authed(server, petShopA.owner, {
      method: 'GET',
      url: `/api/users/${petShopB.owner.userId}`,
    });

    // 404 e nao 403: confirmar a existencia do registro ja seria um vazamento.
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(petShopB.owner.email);
  });

  it('o Tenant A nao consegue alterar um usuario do Tenant B', async () => {
    const response = await authed(server, petShopA.owner, {
      method: 'PATCH',
      url: `/api/users/${petShopB.owner.userId}`,
      payload: { name: 'Invadido' },
    });

    expect(response.statusCode).toBe(404);

    // E o usuario alvo continua intacto.
    const unchanged = await authed(server, petShopB.owner, {
      method: 'GET',
      url: `/api/users/${petShopB.owner.userId}`,
    });
    expect(unchanged.json<{ name: string }>().name).not.toBe('Invadido');
  });

  it('o Tenant A nao consegue excluir um usuario do Tenant B', async () => {
    const response = await authed(server, petShopA.owner, {
      method: 'DELETE',
      url: `/api/users/${petShopB.owner.userId}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('a listagem de usuarios devolve apenas os do proprio tenant', async () => {
    const response = await authed(server, petShopA.owner, { method: 'GET', url: '/api/users' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { id: string; tenantId: string }[] }>();
    expect(body.data.length).toBeGreaterThan(0);
    for (const user of body.data) {
      expect(user.tenantId).toBe(petShopA.tenantId);
    }
    expect(body.data.some((user) => user.id === petShopB.owner.userId)).toBe(false);
  });

  it('o dashboard nao mistura dados de tenants diferentes', async () => {
    const fromA = await authed(server, petShopA.owner, {
      method: 'GET',
      url: '/api/dashboard/overview',
    });
    const fromB = await authed(server, petShopB.owner, {
      method: 'GET',
      url: '/api/dashboard/overview',
    });

    expect(fromA.statusCode).toBe(200);
    expect(fromB.statusCode).toBe(200);
    expect(fromA.json<{ customers: { total: number } }>().customers.total).toBe(1);
    expect(fromB.json<{ customers: { total: number } }>().customers.total).toBe(1);
  });

  it('nenhuma resposta da API expoe hash de senha', async () => {
    const list = await authed(server, petShopA.owner, { method: 'GET', url: '/api/users' });
    const me = await authed(server, petShopA.owner, { method: 'GET', url: '/api/auth/me' });

    for (const body of [list.body, me.body]) {
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('password_hash');
      expect(body).not.toContain('scrypt$');
    }
  });
});

describe('Isolamento no banco (Row Level Security)', () => {
  const businessTables = [
    { label: 'clientes', table: customers },
    { label: 'pets', table: pets },
    { label: 'servicos', table: services },
    { label: 'agendamentos', table: appointments },
  ] as const;

  for (const { label, table } of businessTables) {
    it(`uma consulta de ${label} SEM filtro de tenant ainda assim nao vaza`, async () => {
      // Esta consulta e o bug que tememos: alguem esqueceu o WHERE tenant_id.
      // A policy de RLS precisa salvar a situacao sozinha.
      const rows = await withTenant(petShopA.tenantId, (tx) => tx.select().from(table));

      expect(rows.length).toBe(1);
      for (const row of rows) {
        expect(row.tenantId).toBe(petShopA.tenantId);
      }
    });
  }

  it('buscar pelo ID exato de um registro do outro tenant devolve vazio', async () => {
    const targetB = fixtures.get(petShopB.tenantId);
    expect(targetB).toBeDefined();

    const rows = await withTenant(petShopA.tenantId, (tx) =>
      tx.select().from(customers).where(eq(customers.id, targetB!.customerId)),
    );

    expect(rows).toHaveLength(0);
  });

  it('SQL cru sem filtro tambem e barrado', async () => {
    const result = await withTenant(petShopA.tenantId, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS total FROM customers`),
    );

    const total = (result.rows[0] as { total: number } | undefined)?.total;
    expect(total).toBe(1);
  });

  it('inserir registro marcado com o tenant alheio e rejeitado pelo banco', async () => {
    await expect(
      withTenant(petShopA.tenantId, (tx) =>
        tx
          .insert(customers)
          .values({ tenantId: petShopB.tenantId, name: 'Cliente Plantado', phone: '11911112222' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('atualizar registro do outro tenant nao afeta nenhuma linha', async () => {
    const targetB = fixtures.get(petShopB.tenantId);
    expect(targetB).toBeDefined();

    await withTenant(petShopA.tenantId, (tx) =>
      tx.update(customers).set({ name: 'Sequestrado' }).where(eq(customers.id, targetB!.customerId)),
    );

    const [row] = await withSystem((tx) =>
      tx.select({ name: customers.name }).from(customers).where(eq(customers.id, targetB!.customerId)),
    );
    expect(row?.name).toBe('Cliente B');
  });

  it('excluir registro do outro tenant nao afeta nenhuma linha', async () => {
    const targetB = fixtures.get(petShopB.tenantId);

    await withTenant(petShopA.tenantId, (tx) =>
      tx.delete(customers).where(eq(customers.id, targetB!.customerId)),
    );

    const [row] = await withSystem((tx) =>
      tx.select({ id: customers.id }).from(customers).where(eq(customers.id, targetB!.customerId)),
    );
    expect(row).toBeDefined();
  });

  it('o proprio registro do tenant so aparece para ele', async () => {
    const rows = await withTenant(petShopA.tenantId, (tx) => tx.select().from(tenants));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(petShopA.tenantId);
  });
});

describe('Integridade referencial entre tenants', () => {
  it('o banco recusa um pet ligado ao cliente de outro tenant', async () => {
    const targetB = fixtures.get(petShopB.tenantId);

    // A FK composta (customer_id, tenant_id) torna essa combinacao impossivel,
    // independentemente do que a aplicacao tentar fazer.
    await expect(
      withSystem((tx) =>
        tx.insert(pets).values({
          tenantId: petShopA.tenantId,
          customerId: targetB!.customerId,
          name: 'Pet Impossivel',
          species: 'DOG',
        }),
      ),
    ).rejects.toThrow();
  });

  it('o banco recusa um agendamento com servico de outro tenant', async () => {
    const targetA = fixtures.get(petShopA.tenantId);
    const targetB = fixtures.get(petShopB.tenantId);
    const startsAt = new Date(Date.now() + 172_800_000);

    await expect(
      withSystem((tx) =>
        tx.insert(appointments).values({
          tenantId: petShopA.tenantId,
          customerId: targetA!.customerId,
          petId: targetA!.petId,
          serviceId: targetB!.serviceId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          price: toMoneyLiteral(80),
        }),
      ),
    ).rejects.toThrow();
  });

  it('o banco recusa um tenant sem os campos obrigatorios do dominio', async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(tenants).values({ name: 'X', slug: 'ok', settings: DEFAULT_TENANT_SETTINGS }),
      ),
    ).rejects.toThrow(/tenants_name_not_blank/);
  });
});

describe('Codigos de erro do isolamento', () => {
  it('usa NOT_FOUND, e nunca FORBIDDEN, para recurso de outro tenant', async () => {
    const response = await authed(server, petShopA.owner, {
      method: 'GET',
      url: `/api/users/${petShopB.owner.userId}`,
    });

    expect(errorCode(response.body)).toBe('NOT_FOUND');
  });
});
