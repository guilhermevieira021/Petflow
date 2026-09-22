import type { Role } from '@petflow/contracts';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { closeDatabase } from '../db/client.js';
import { withSystem } from '../db/context.js';
import { runMigrations } from '../db/migrator.js';
import { buildServer } from '../http/server.js';
import { applyBillingWebhookEvent } from '../modules/billing/billing.service.js';

/**
 * Harness dos testes de integracao.
 *
 * Cada arquivo de teste recebe uma instancia propria de PGlite em memoria,
 * com o schema real aplicado pelas migrations reais -- incluindo policies de
 * RLS, roles e constraints. Nada aqui e mock: os testes de isolamento so tem
 * valor se exercitarem o mesmo banco que roda em producao.
 */

export interface TestSession {
  cookie: string;
  csrf: string;
  userId: string;
  tenantId: string;
  email: string;
  role: Role;
}

export interface TestTenant {
  tenantId: string;
  owner: TestSession;
}

let app: FastifyInstance | null = null;

export async function setupTestApp(): Promise<FastifyInstance> {
  if (app) return app;
  await runMigrations();
  app = await buildServer();
  await app.ready();
  return app;
}

export async function teardownTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
  await closeDatabase();
}

function collectCookies(headers: Record<string, unknown>): { cookie: string; csrf: string } {
  const raw = headers['set-cookie'];
  const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];

  const pairs: string[] = [];
  let csrf = '';

  for (const entry of entries) {
    const [pair] = entry.split(';');
    if (!pair) continue;
    pairs.push(pair);
    const [name, value] = pair.split('=');
    if (name === 'petflow_csrf' && value) csrf = decodeURIComponent(value);
  }

  return { cookie: pairs.join('; '), csrf };
}

let emailCounter = 0;

/** Cria um pet shop novo com o seu OWNER e ja devolve a sessao autenticada. */
export async function createTenantWithOwner(
  server: FastifyInstance,
  options: { tenantName?: string; password?: string } = {},
): Promise<TestTenant> {
  emailCounter += 1;
  const email = `owner${emailCounter}@teste.com`;
  const password = options.password ?? 'senhaSegura1';

  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      tenantName: options.tenantName ?? `Pet Shop ${emailCounter}`,
      userName: `Dono ${emailCounter}`,
      email,
      password,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Falha ao registrar tenant de teste: ${response.body}`);
  }

  const body = response.json<{ user: { id: string; tenantId: string } }>();
  const { cookie, csrf } = collectCookies(response.headers as Record<string, unknown>);

  return {
    tenantId: body.user.tenantId,
    owner: {
      cookie,
      csrf,
      userId: body.user.id,
      tenantId: body.user.tenantId,
      email,
      role: 'OWNER',
    },
  };
}

/**
 * Move um tenant de teste para PRO/ACTIVE, sem passar pelo checkout.
 *
 * Uso: arquivos de teste cujo foco NAO e entitlements (auth, rbac, CRUD de
 * negocio) chamam isto logo apos criar o tenant, para que criar varios
 * usuarios/clientes/servicos ao longo do arquivo nunca esbarre nos limites do
 * TRIAL por acidente. Os limites do TRIAL em si sao testados de proposito, e
 * isoladamente, em billing.test.ts -- reutiliza o mesmo caminho de producao
 * (`applyBillingWebhookEvent`, a unica porta que muda uma assinatura).
 */
export async function upgradeToPro(tenantId: string): Promise<void> {
  await withSystem((tx) =>
    applyBillingWebhookEvent(tx, {
      tenantId,
      status: 'ACTIVE',
      planCode: 'PRO',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  );
}

/** Cria um usuario adicional no tenant e faz login com ele. */
export async function createUserAndLogin(
  server: FastifyInstance,
  owner: TestSession,
  params: { role: Role; name?: string; password?: string },
): Promise<TestSession> {
  emailCounter += 1;
  const email = `membro${emailCounter}@teste.com`;
  const password = params.password ?? 'senhaSegura1';

  const created = await authed(server, owner, {
    method: 'POST',
    url: '/api/users',
    payload: {
      name: params.name ?? `Usuario ${emailCounter}`,
      email,
      password,
      role: params.role,
    },
  });

  if (created.statusCode !== 201) {
    throw new Error(`Falha ao criar usuario de teste: ${created.body}`);
  }

  return login(server, email, password);
}

export async function login(
  server: FastifyInstance,
  email: string,
  password: string,
): Promise<TestSession> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Falha no login de teste: ${response.body}`);
  }

  const body = response.json<{ user: { id: string; tenantId: string; role: Role } }>();
  const { cookie, csrf } = collectCookies(response.headers as Record<string, unknown>);

  return {
    cookie,
    csrf,
    userId: body.user.id,
    tenantId: body.user.tenantId,
    email,
    role: body.user.role,
  };
}

/** Requisicao autenticada: injeta cookie de sessao e token CSRF. */
export function authed(
  server: FastifyInstance,
  session: TestSession,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return server.inject({
    ...options,
    headers: {
      ...options.headers,
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
    },
  });
}

/** Extrai o codigo de erro do envelope padrao da API. */
export function errorCode(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? '';
  } catch {
    return '';
  }
}
