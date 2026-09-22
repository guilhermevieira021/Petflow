import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  errorCode,
  login,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

let server: FastifyInstance;
let shop: TestTenant;

beforeAll(async () => {
  server = await setupTestApp();
  shop = await createTenantWithOwner(server, { tenantName: 'Pet Shop Autenticacao' });
  // Este arquivo cria varios usuarios de teste ao longo de muitos `it()`; sem
  // isso esbarraria no limite de 2 usuarios do TRIAL por um motivo que nao
  // tem nada a ver com o que estes testes verificam. Os limites do trial em
  // si sao testados, de proposito, em billing.test.ts.
  await upgradeToPro(shop.tenantId);
});

afterAll(async () => {
  await teardownTestApp();
});

describe('Cadastro', () => {
  it('cria o tenant e o primeiro OWNER numa unica operacao', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        tenantName: 'Cantinho dos Bichos',
        userName: 'Rita Duarte',
        email: 'rita@cantinho.com',
        password: 'minhaSenha1',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { role: string; tenantId: string } }>();
    expect(body.user.role).toBe('OWNER');
    expect(body.user.tenantId).toBeTruthy();
    expect(response.body).not.toContain('passwordHash');
  });

  it('recusa email ja cadastrado', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        tenantName: 'Outro Pet Shop',
        userName: 'Outra Pessoa',
        email: shop.owner.email,
        password: 'minhaSenha1',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(errorCode(response.body)).toBe('EMAIL_ALREADY_USED');
  });

  it('recusa senha fraca com mensagem por campo', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        tenantName: 'Pet Shop Senha Fraca',
        userName: 'Fulano de Tal',
        email: 'fraca@exemplo.com',
        password: 'abc',
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { fields: { field: string }[] } }>();
    expect(body.error.fields.some((field) => field.field === 'password')).toBe(true);
  });
});

describe('Login', () => {
  it('autentica com credenciais corretas e emite os cookies', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: shop.owner.email, password: 'senhaSegura1' },
    });

    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    const serialized = Array.isArray(cookies) ? cookies.join(' ') : String(cookies);
    // O token de sessao precisa ser inacessivel ao JavaScript da pagina.
    expect(serialized).toContain('petflow_session');
    expect(serialized).toContain('HttpOnly');
    // O token CSRF, ao contrario, PRECISA ser legivel para voltar no header.
    expect(serialized).toContain('petflow_csrf');
  });

  it('recusa senha incorreta sem revelar se o email existe', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: shop.owner.email, password: 'senhaErrada9' },
    });

    expect(response.statusCode).toBe(401);
    expect(errorCode(response.body)).toBe('INVALID_CREDENTIALS');
    expect(response.json<{ error: { message: string } }>().error.message).toBe(
      'Email ou senha incorretos.',
    );
  });

  it('devolve exatamente a mesma resposta para email inexistente', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-existe@exemplo.com', password: 'senhaErrada9' },
    });

    expect(response.statusCode).toBe(401);
    expect(errorCode(response.body)).toBe('INVALID_CREDENTIALS');
  });

  it('bloqueia usuario desativado', async () => {
    const staff = await createUserAndLogin(server, shop.owner, { role: 'STAFF' });

    await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/users/${staff.userId}`,
      payload: { active: false },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: staff.email, password: 'senhaSegura1' },
    });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('ACCOUNT_INACTIVE');
  });

  it('invalida a sessao aberta quando o usuario e desativado', async () => {
    const staff = await createUserAndLogin(server, shop.owner, { role: 'STAFF' });

    const before = await authed(server, staff, { method: 'GET', url: '/api/auth/me' });
    expect(before.statusCode).toBe(200);

    await authed(server, shop.owner, {
      method: 'PATCH',
      url: `/api/users/${staff.userId}`,
      payload: { active: false },
    });

    const after = await authed(server, staff, { method: 'GET', url: '/api/auth/me' });
    expect(after.statusCode).toBe(401);
  });
});

describe('Rotas protegidas', () => {
  it('nega acesso sem sessao', async () => {
    for (const url of ['/api/auth/me', '/api/users', '/api/dashboard/overview', '/api/tenants/current']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    }
  });

  it('nega acesso com cookie de sessao forjado', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `petflow_session=${'a'.repeat(43)}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('/me devolve usuario, marca do tenant, permissoes e onboarding', async () => {
    const response = await authed(server, shop.owner, { method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      user: { role: string };
      tenant: { primaryColor: string; slug: string };
      permissions: string[];
      onboarding: { completed: boolean; steps: { key: string; done: boolean }[] };
    }>();

    expect(body.user.role).toBe('OWNER');
    expect(body.tenant.slug).toBeTruthy();
    expect(body.permissions).toContain('settings:write');
    expect(body.onboarding.steps.length).toBeGreaterThan(0);
    expect(body.onboarding.completed).toBe(false);
  });
});

describe('Protecao CSRF', () => {
  it('recusa mutacao sem o header X-CSRF-Token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: shop.owner.cookie },
      payload: { name: 'Sem CSRF', email: 'semcsrf@teste.com', password: 'senhaSegura1', role: 'STAFF' },
    });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('INVALID_CSRF_TOKEN');
  });

  it('recusa mutacao com token CSRF de outra sessao', async () => {
    const outro = await createTenantWithOwner(server, { tenantName: 'Pet Shop CSRF' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: shop.owner.cookie, 'x-csrf-token': outro.owner.csrf },
      payload: { name: 'Token Trocado', email: 'trocado@teste.com', password: 'senhaSegura1', role: 'STAFF' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('permite leitura sem o header CSRF', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: shop.owner.cookie },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('Logout e troca de senha', () => {
  it('logout revoga a sessao imediatamente', async () => {
    const staff = await createUserAndLogin(server, shop.owner, { role: 'STAFF' });

    const logout = await authed(server, staff, { method: 'POST', url: '/api/auth/logout' });
    expect(logout.statusCode).toBe(204);

    const after = await authed(server, staff, { method: 'GET', url: '/api/auth/me' });
    expect(after.statusCode).toBe(401);
  });

  it('exige a senha atual correta para troca-la', async () => {
    const staff: TestSession = await createUserAndLogin(server, shop.owner, { role: 'STAFF' });

    const wrong = await authed(server, staff, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: {
        currentPassword: 'senhaTotalmenteErrada1',
        password: 'novaSenha123',
        passwordConfirmation: 'novaSenha123',
      },
    });
    expect(wrong.statusCode).toBe(401);

    const right = await authed(server, staff, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: {
        currentPassword: 'senhaSegura1',
        password: 'novaSenha123',
        passwordConfirmation: 'novaSenha123',
      },
    });
    expect(right.statusCode).toBe(200);

    const relogin = await login(server, staff.email, 'novaSenha123');
    expect(relogin.userId).toBe(staff.userId);
  });

  it('recusa confirmacao de senha divergente', async () => {
    const response = await authed(server, shop.owner, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: {
        currentPassword: 'senhaSegura1',
        password: 'novaSenha123',
        passwordConfirmation: 'outraCoisa123',
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('Recuperacao de senha', () => {
  it('responde 202 mesmo para email inexistente (anti-enumeracao)', async () => {
    const existing = await server.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: shop.owner.email },
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'ninguem@exemplo.com' },
    });

    expect(existing.statusCode).toBe(202);
    expect(missing.statusCode).toBe(202);
    expect(existing.body).toBe(missing.body);
  });

  it('recusa token de redefinicao invalido', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        token: 'token-que-nao-existe',
        password: 'novaSenha123',
        passwordConfirmation: 'novaSenha123',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
