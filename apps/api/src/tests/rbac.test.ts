import { Permission, ROLE_PERMISSIONS, canManageRole, hasPermission } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * AUTORIZACAO.
 *
 * O ponto destes testes: NAO basta esconder o botao no frontend. Todos os
 * casos aqui chamam a API diretamente, como faria alguem com o DevTools
 * aberto ou um curl.
 */

let server: FastifyInstance;
let shop: TestTenant;
let admin: TestSession;
let staff: TestSession;

beforeAll(async () => {
  server = await setupTestApp();
  shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop RBAC' });
  // Este arquivo cria varios usuarios (admin, staff, e mais dentro dos testes
  // de escalonamento); o limite de 2 usuarios do TRIAL nao e o que se testa
  // aqui -- isso fica isolado em billing.test.ts.
  await upgradeToPro(shop.tenantId);
  admin = await createUserAndLogin(server, shop.owner, { role: 'ADMIN', name: 'Ana Admin' });
  staff = await createUserAndLogin(server, shop.owner, { role: 'STAFF', name: 'Silas Staff' });
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Matriz de permissoes', () => {
  it('OWNER e o unico papel que gerencia usuarios e configuracoes', () => {
    expect(hasPermission('OWNER', Permission.USERS_WRITE)).toBe(true);
    expect(hasPermission('ADMIN', Permission.USERS_WRITE)).toBe(false);
    expect(hasPermission('STAFF', Permission.USERS_WRITE)).toBe(false);

    expect(hasPermission('OWNER', Permission.SETTINGS_WRITE)).toBe(true);
    expect(hasPermission('ADMIN', Permission.SETTINGS_WRITE)).toBe(false);
    expect(hasPermission('STAFF', Permission.SETTINGS_WRITE)).toBe(false);
  });

  it('STAFF atende, mas nao exclui nem enxerga relatorios', () => {
    expect(hasPermission('STAFF', Permission.APPOINTMENTS_WRITE)).toBe(true);
    expect(hasPermission('STAFF', Permission.CUSTOMERS_WRITE)).toBe(true);
    expect(hasPermission('STAFF', Permission.CUSTOMERS_DELETE)).toBe(false);
    expect(hasPermission('STAFF', Permission.REPORTS_READ)).toBe(false);
  });

  it('cada papel superior contem todas as permissoes do inferior', () => {
    for (const permission of ROLE_PERMISSIONS.STAFF) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
    for (const permission of ROLE_PERMISSIONS.ADMIN) {
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('nenhum papel gerencia um papel acima do seu', () => {
    expect(canManageRole('ADMIN', 'OWNER')).toBe(false);
    expect(canManageRole('STAFF', 'ADMIN')).toBe(false);
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
  });
});

describe('Autorizacao aplicada na API (nao no frontend)', () => {
  it('STAFF recebe 403 ao tentar listar usuarios pela API', async () => {
    const response = await authed(server, staff, { method: 'GET', url: '/api/users' });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('INSUFFICIENT_PERMISSION');
  });

  it('ADMIN recebe 403 ao tentar criar usuario pela API', async () => {
    const response = await authed(server, admin, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Criado Por Admin',
        email: 'criado.por.admin@teste.com',
        password: 'senhaSegura1',
        role: 'STAFF',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('ADMIN pode ler a lista de usuarios, mas nao escrever', async () => {
    const read = await authed(server, admin, { method: 'GET', url: '/api/users' });
    expect(read.statusCode).toBe(200);

    const write = await authed(server, admin, {
      method: 'DELETE',
      url: `/api/users/${staff.userId}`,
    });
    expect(write.statusCode).toBe(403);
  });

  it('STAFF e ADMIN recebem 403 ao alterar configuracoes do pet shop', async () => {
    for (const session of [staff, admin]) {
      const response = await authed(server, session, {
        method: 'PATCH',
        url: '/api/tenants/current',
        payload: { name: 'Nome Alterado Indevidamente' },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('STAFF recebe 403 ao ler a trilha de auditoria', async () => {
    const response = await authed(server, staff, { method: 'GET', url: '/api/audit-logs' });
    expect(response.statusCode).toBe(403);
  });

  it('OWNER consegue tudo que os demais nao conseguem', async () => {
    const users = await authed(server, shop.owner, { method: 'GET', url: '/api/users' });
    const settings = await authed(server, shop.owner, {
      method: 'PATCH',
      url: '/api/tenants/current',
      payload: { name: 'Pet Shop RBAC Renomeado' },
    });
    const audit = await authed(server, shop.owner, { method: 'GET', url: '/api/audit-logs' });

    expect(users.statusCode).toBe(200);
    expect(settings.statusCode).toBe(200);
    expect(audit.statusCode).toBe(200);
  });

  it('todos os papeis enxergam o dashboard', async () => {
    for (const session of [shop.owner, admin, staff]) {
      const response = await authed(server, session, {
        method: 'GET',
        url: '/api/dashboard/overview',
      });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe('Escalonamento de privilegio', () => {
  it('OWNER nao pode alterar o proprio papel', async () => {
    const response = await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/users/${shop.owner.userId}`,
      payload: { role: 'STAFF' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('OWNER nao pode desativar o proprio acesso', async () => {
    const response = await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/users/${shop.owner.userId}`,
      payload: { active: false },
    });

    expect(response.statusCode).toBe(403);
  });

  it('OWNER nao pode excluir a si mesmo', async () => {
    const response = await authed(server, shop.owner, {
      method: 'DELETE',
      url: `/api/users/${shop.owner.userId}`,
    });

    expect(response.statusCode).toBe(403);
  });

  it('o pet shop nunca fica sem um proprietario ativo', async () => {
    const segundoDono = await createUserAndLogin(server, shop.owner, { role: 'OWNER' });

    // Com dois donos, rebaixar um e permitido.
    const rebaixa = await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/users/${segundoDono.userId}`,
      payload: { role: 'ADMIN' },
    });
    expect(rebaixa.statusCode).toBe(200);

    // Agora so resta um dono: rebaixa-lo deixaria a conta orfa.
    const conflito = await authed(server, segundoDono, {
      method: 'PATCH',
      url: `/api/users/${shop.owner.userId}`,
      payload: { role: 'ADMIN' },
    });
    expect([403, 409]).toContain(conflito.statusCode);
  });
});

describe('Validacao de entrada nas rotas protegidas', () => {
  it('recusa id que nao e UUID', async () => {
    const response = await authed(server, shop.owner, {
      method: 'GET',
      url: '/api/users/nao-e-uuid',
    });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response.body)).toBe('VALIDATION_ERROR');
  });

  it('recusa papel inexistente na criacao de usuario', async () => {
    const response = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Papel Invalido',
        email: 'papel.invalido@teste.com',
        password: 'senhaSegura1',
        role: 'SUPERADMIN',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('recusa campos desconhecidos no payload', async () => {
    const response = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'Campo Extra',
        email: 'campo.extra@teste.com',
        password: 'senhaSegura1',
        role: 'STAFF',
        tenantId: '00000000-0000-4000-8000-000000000000',
      },
    });

    // tenantId jamais pode vir do cliente -- o schema e .strict() justamente
    // para que uma tentativa dessas falhe de forma ruidosa.
    expect(response.statusCode).toBe(422);
  });
});
