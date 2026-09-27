import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  login,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/**
 * Fase 4 -- tema visual por pet shop, guardado em tenants.settings.appearance
 * (sem migration). Todos leem; so quem pode alterar configuracoes troca.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
const password = 'senhaSegura1';

function appearance(session: TestSession) {
  return authed(server, session, { method: 'GET', url: '/api/tenants/current/appearance' });
}

function saveAppearance(session: TestSession, value: Record<string, unknown>) {
  return authed(server, session, { method: 'PATCH', url: '/api/tenants/current', payload: { settings: { appearance: value } } });
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Tema A', password });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Tema B', password });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
});

afterAll(async () => {
  await teardownTestApp();
});

describe('aparencia do pet shop', () => {
  it('padrao: tema Original com a cor propria (comportamento anterior aos temas)', async () => {
    const response = await appearance(shopA.owner);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ theme: 'original', brandColorMode: 'custom', primaryColor: '#2F6BFF', logoUrl: null });
  });

  it('qualquer papel le a aparencia (STAFF incluso); sem sessao, nao', async () => {
    expect((await appearance(staffA)).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/api/tenants/current/appearance' })).statusCode).toBe(401);
  });

  it('proprietario troca o tema; STAFF nao', async () => {
    const saved = await saveAppearance(shopA.owner, { theme: 'forest', brandColorMode: 'theme' });
    expect(saved.statusCode).toBe(200);
    expect((await appearance(shopA.owner)).json()).toMatchObject({ theme: 'forest', brandColorMode: 'theme' });
    // STAFF ve o mesmo tema...
    expect((await appearance(staffA)).json()).toMatchObject({ theme: 'forest' });
    // ...mas nao altera.
    expect((await saveAppearance(staffA, { theme: 'ocean', brandColorMode: 'theme' })).statusCode).toBe(403);
    expect((await appearance(shopA.owner)).json()).toMatchObject({ theme: 'forest' });
  });

  it('tema ou modo invalido e recusado', async () => {
    expect((await saveAppearance(shopA.owner, { theme: 'neon', brandColorMode: 'theme' })).statusCode).toBe(422);
    expect((await saveAppearance(shopA.owner, { theme: 'ocean', brandColorMode: 'rainbow' })).statusCode).toBe(422);
    expect((await saveAppearance(shopA.owner, { theme: 'ocean', brandColorMode: 'theme', extra: 1 })).statusCode).toBe(422);
  });

  it('a escolha permanece apos logout e novo login', async () => {
    await saveAppearance(shopA.owner, { theme: 'lavender', brandColorMode: 'custom' });
    const logout = await authed(server, shopA.owner, { method: 'POST', url: '/api/auth/logout' });
    expect(logout.statusCode).toBeLessThan(300);
    expect((await appearance(shopA.owner)).statusCode).toBe(401);

    const again = await login(server, shopA.owner.email, password);
    expect((await appearance(again)).json()).toMatchObject({ theme: 'lavender', brandColorMode: 'custom' });
    shopA.owner = again;
  });

  it('trocar o tema nao apaga as outras configuracoes; a cor propria continua', async () => {
    await authed(server, shopA.owner, {
      method: 'PATCH',
      url: '/api/tenants/current',
      payload: { primaryColor: '#123456', settings: { automationEnabled: true, inactiveCustomerDays: 60 } },
    });
    await saveAppearance(shopA.owner, { theme: 'sunset', brandColorMode: 'theme' });
    const tenant = (await authed(server, shopA.owner, { method: 'GET', url: '/api/tenants/current' })).json<{
      primaryColor: string;
      settings: { automationEnabled: boolean; inactiveCustomerDays: number; appearance: { theme: string } };
    }>();
    expect(tenant.settings).toMatchObject({ automationEnabled: true, inactiveCustomerDays: 60, appearance: { theme: 'sunset' } });
    expect(tenant.primaryColor.toLowerCase()).toBe('#123456');
    expect((await appearance(shopA.owner)).json()).toMatchObject({ theme: 'sunset', primaryColor: '#123456' });
  });

  it('cada pet shop tem o proprio tema', async () => {
    expect((await appearance(shopB.owner)).json()).toMatchObject({ theme: 'original', brandColorMode: 'custom' });
    await saveAppearance(shopB.owner, { theme: 'ocean', brandColorMode: 'theme' });
    expect((await appearance(shopA.owner)).json()).toMatchObject({ theme: 'sunset' });
    expect((await appearance(shopB.owner)).json()).toMatchObject({ theme: 'ocean' });
  });
});
