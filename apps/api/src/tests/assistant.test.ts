import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider, setAiProviderForTests, type AiProvider } from '../integrations/ai/ai.provider.js';
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

/**
 * Assistente: as respostas saem das consultas sobre os dados reais do tenant;
 * o provider de IA (falso aqui) so escolhe a consulta e nunca ve dados.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let adminA: TestSession;

interface ToolResult {
  tool: string;
  answer: string;
  rows: { label: string; value: string }[];
  basis: string;
}

function run(session: TestSession, name: string) {
  return authed(server, session, { method: 'POST', url: `/api/assistant/tools/${name}` });
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Assistente A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Assistente B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
  adminA = await createUserAndLogin(server, shopA.owner, { role: 'ADMIN' });

  // A: produto com estoque baixo + venda paga (entra no "Recebido").
  await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/products',
    payload: { name: 'Racao Assistente A', salePrice: 50, minStock: 5, initialStock: 2 },
  });
  const sale = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/sales',
    payload: { items: [{ description: 'Coleira', quantity: 1, unitPrice: 123.45 }], payment: { method: 'PIX', paid: true } },
  });
  expect(sale.statusCode).toBe(201);

  // B: dados que NUNCA podem aparecer para A.
  await authed(server, shopB.owner, {
    method: 'POST',
    url: '/api/products',
    payload: { name: 'Produto Secreto B', salePrice: 10, minStock: 50, initialStock: 1 },
  });
  await authed(server, shopB.owner, {
    method: 'POST',
    url: '/api/sales',
    payload: { items: [{ description: 'Item B', quantity: 1, unitPrice: 999 }], payment: { method: 'CASH', paid: true } },
  });
});

afterEach(() => {
  setAiProviderForTests(null);
});

afterAll(async () => {
  await teardownTestApp();
});

describe('permissoes', () => {
  it('STAFF nao usa o assistente', async () => {
    expect((await authed(server, staffA, { method: 'GET', url: '/api/assistant/tools' })).statusCode).toBe(403);
    expect((await run(staffA, 'low_stock')).statusCode).toBe(403);
  });

  it('exige sessao', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/assistant/tools' })).statusCode).toBe(401);
  });

  it('ADMIN e OWNER listam as consultas', async () => {
    const response = await authed(server, adminA, { method: 'GET', url: '/api/assistant/tools' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ name: string }[]>().map((tool) => tool.name).sort()).toEqual(
      ['emptiest_hours', 'health_due', 'inactive_customers', 'low_stock', 'received_this_week'],
    );
  });

  it('consulta desconhecida e rejeitada', async () => {
    expect((await run(shopA.owner, 'drop_tables')).statusCode).toBe(422);
  });
});

describe('consultas sobre dados reais', () => {
  it('recebido da semana bate com o painel e so conta o proprio pet shop', async () => {
    const response = await run(shopA.owner, 'received_this_week');
    expect(response.statusCode).toBe(200);
    const body = response.json<ToolResult>();
    const overview = await authed(server, shopA.owner, { method: 'GET', url: '/api/dashboard/overview' });
    const received = overview.json<{ week: { receivedRevenue: number } }>().week.receivedRevenue;
    expect(received).toBe(123.45);
    expect(body.answer).toContain('123,45');
    expect(response.body).not.toContain('999');
  });

  it('estoque baixo lista so produtos do tenant', async () => {
    const body = (await run(shopA.owner, 'low_stock')).json<ToolResult>();
    expect(body.rows.map((row) => row.label)).toEqual(['Racao Assistente A']);
    expect(body.answer).toBe('1 produto está com estoque baixo.');
    const other = (await run(shopB.owner, 'low_stock')).json<ToolResult>();
    expect(other.rows.map((row) => row.label)).toEqual(['Produto Secreto B']);
  });

  it('sem dados, responde que nao ha dados (nao inventa)', async () => {
    const health = (await run(shopA.owner, 'health_due')).json<ToolResult>();
    expect(health.rows).toEqual([]);
    expect(health.answer).toContain('Nenhuma');
    const inactive = (await run(shopA.owner, 'inactive_customers')).json<ToolResult>();
    expect(inactive.rows).toEqual([]);
    const hours = (await run(shopA.owner, 'emptiest_hours')).json<ToolResult>();
    expect(hours.rows).toEqual([]);
    expect(hours.answer).toContain('Ainda não há atendimentos');
  });
});

describe('pergunta livre', () => {
  it('sem provider configurado: 503 honesto, status informa', async () => {
    const status = await authed(server, shopA.owner, { method: 'GET', url: '/api/assistant/status' });
    expect(status.json<{ languageModelConfigured: boolean }>().languageModelConfigured).toBe(false);
    const ask = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/assistant/ask',
      payload: { question: 'Quanto recebi?' },
    });
    expect(ask.statusCode).toBe(503);
  });

  it('provider so escolhe a consulta; os numeros vem do banco e ele nao recebe dados', async () => {
    const seen: unknown[] = [];
    const fake: AiProvider = {
      kind: 'anthropic',
      configured: true,
      async chooseTool(question, tools) {
        seen.push({ question, tools });
        return 'received_this_week';
      },
    };
    setAiProviderForTests(fake);
    const ask = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/assistant/ask',
      payload: { question: 'Quanto entrou de dinheiro nesses dias?' },
    });
    expect(ask.statusCode).toBe(200);
    const body = ask.json<{ matched: boolean; result: ToolResult }>();
    expect(body.matched).toBe(true);
    expect(body.result.answer).toContain('123,45');
    expect(JSON.stringify(seen)).not.toContain('123');
    expect(JSON.stringify(seen)).not.toContain('Racao');
  });

  it('provider sem consulta adequada: resposta honesta de "nao sei"', async () => {
    setAiProviderForTests({ kind: 'anthropic', configured: true, chooseTool: async () => null });
    const ask = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/assistant/ask',
      payload: { question: 'Qual a capital da Franca?' },
    });
    expect(ask.json<{ matched: boolean; result: null }>()).toMatchObject({ matched: false, result: null });
  });
});

describe('AnthropicProvider (fetch falso)', () => {
  const tools = [{ name: 'low_stock' as const, question: 'Estoque baixo?', description: 'x' }];

  it('le o tool_use e ignora nomes fora da lista', async () => {
    let sent: { headers: Record<string, string>; body: string } | null = null;
    const ok = new AnthropicProvider({ apiKey: 'chave-teste', model: 'm' }, async (_url, init) => {
      sent = { headers: init?.headers as Record<string, string>, body: String(init?.body) };
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'low_stock', input: {} }] }), { status: 200 });
    });
    expect(await ok.chooseTool('tem produto acabando?', tools)).toBe('low_stock');
    expect(sent!.headers['x-api-key']).toBe('chave-teste');
    expect(sent!.body).toContain('tem produto acabando?');

    const rogue = new AnthropicProvider({ apiKey: 'k', model: 'm' }, async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'delete_everything' }] }), { status: 200 }),
    );
    expect(await rogue.chooseTool('?', tools)).toBeNull();
  });

  it('erro do provider nao repassa corpo nem chave', async () => {
    const failing = new AnthropicProvider({ apiKey: 'chave-secreta', model: 'm' }, async () =>
      new Response('detalhes internos da conta', { status: 401 }),
    );
    await expect(failing.chooseTool('?', tools)).rejects.toThrow(/status 401/);
    await failing.chooseTool('?', tools).catch((error: Error) => {
      expect(error.message).not.toContain('chave-secreta');
      expect(error.message).not.toContain('detalhes internos');
    });
  });
});
