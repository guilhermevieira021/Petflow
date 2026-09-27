import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OpenAIProvider, setAiProviderForTests, type OpenAIChatClient } from '../integrations/ai/ai.provider.js';
import {
  authed,
  createTenantWithOwner,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestTenant,
} from './helpers.js';

/**
 * Fase 5 -- IA central com OpenAI. A chave e do servidor; o modelo so escolhe
 * a consulta; os numeros vem do banco do pet shop logado.
 */

const SECRET_KEY = 'sk-test-SEGREDO-que-nunca-pode-vazar-123';

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;

/** Cliente falso do SDK: registra o pedido e devolve a funcao escolhida. */
function fakeClient(toolName: string | null, sink: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = []): OpenAIChatClient {
  return {
    chat: {
      completions: {
        async create(body) {
          sink.push(body);
          return {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: toolName ? 'tool_calls' : 'stop',
                logprobs: null,
                message: {
                  role: 'assistant',
                  content: toolName ? null : 'Nao sei.',
                  refusal: null,
                  tool_calls: toolName
                    ? [{ id: 'call_1', type: 'function', function: { name: toolName, arguments: '{}' } }]
                    : undefined,
                },
              },
            ],
          } as OpenAI.Chat.ChatCompletion;
        },
      },
    },
  };
}

function ask(tenant: TestTenant, question: string) {
  return authed(server, tenant.owner, { method: 'POST', url: '/api/assistant/ask', payload: { question } });
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop IA A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop IA B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);

  const product = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/products',
    payload: { name: 'Racao IA A', salePrice: 100, costPrice: 60, initialStock: 10 },
  });
  await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/sales',
    payload: { items: [{ productId: product.json<{ id: string }>().id, quantity: 2 }], payment: { method: 'PIX', paid: true } },
  });
  // B tem numeros bem diferentes -- nunca podem aparecer para A.
  const productB = await authed(server, shopB.owner, {
    method: 'POST',
    url: '/api/products',
    payload: { name: 'Produto Secreto B', salePrice: 777, costPrice: 500, initialStock: 3 },
  });
  await authed(server, shopB.owner, {
    method: 'POST',
    url: '/api/sales',
    payload: { items: [{ productId: productB.json<{ id: string }>().id, quantity: 1 }], payment: { method: 'CASH', paid: true } },
  });
});

afterEach(() => setAiProviderForTests(null));

afterAll(async () => {
  await teardownTestApp();
});

describe('OpenAI (SDK oficial) no assistente', () => {
  it('pergunta livre: o modelo escolhe a consulta e o numero vem do banco do tenant', async () => {
    const sent: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, fakeClient('sales_today', sent)));

    const response = await ask(shopA, 'Quanto vendi hoje?');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ matched: true, result: { tool: 'sales_today' } });
    expect(response.json<{ result: { answer: string } }>().result.answer).toContain('200,00');

    // O que foi para a OpenAI: so a pergunta e as ferramentas. Nenhum dado.
    const request = JSON.stringify(sent[0]);
    expect(sent[0]?.model).toBe('gpt-test');
    expect(sent[0]?.tools?.map((tool) => (tool.type === 'function' ? tool.function.name : ''))).toContain('sales_today');
    expect(request).not.toContain('Racao IA A');
    expect(request).not.toContain('200');
  });

  it('tenant isolado: B pergunta a mesma coisa e so ve os proprios numeros', async () => {
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, fakeClient('top_products')));
    const a = await ask(shopA, 'Qual produto vendeu mais?');
    const b = await ask(shopB, 'Qual produto vendeu mais?');
    expect(a.body).toContain('Racao IA A');
    expect(a.body).not.toContain('Produto Secreto B');
    expect(b.body).toContain('Produto Secreto B');
    expect(b.body).not.toContain('Racao IA A');
  });

  it('a chave nunca aparece em nenhuma resposta da API', async () => {
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, fakeClient('stock_overview')));
    const responses = [
      await authed(server, shopA.owner, { method: 'GET', url: '/api/assistant/status' }),
      await authed(server, shopA.owner, { method: 'GET', url: '/api/assistant/tools' }),
      await ask(shopA, 'Quanto tenho em estoque?'),
    ];
    for (const response of responses) {
      expect(response.body).not.toContain(SECRET_KEY);
      expect(response.body).not.toContain('sk-');
    }
    expect(responses[0]?.json()).toMatchObject({ languageModelConfigured: true, provider: 'openai' });
  });

  it('erro da OpenAI: 503 honesto, sem repassar a mensagem do provider', async () => {
    const failing: OpenAIChatClient = {
      chat: {
        completions: {
          async create() {
            throw new OpenAI.APIError(401, { message: `Incorrect API key provided: ${SECRET_KEY}` }, 'Incorrect API key', undefined);
          },
        },
      },
    };
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, failing));
    const response = await ask(shopA, 'Quanto vendi hoje?');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(SECRET_KEY);
    expect(response.body).not.toContain('Incorrect API key');
  });

  it('modelo sem ferramenta adequada: "nao sei", sem inventar', async () => {
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, fakeClient(null)));
    const response = await ask(shopA, 'Qual a capital da Franca?');
    expect(response.json()).toMatchObject({ matched: false, result: null });
  });

  it('modelo que tenta chamar funcao inexistente e ignorado', async () => {
    setAiProviderForTests(new OpenAIProvider({ apiKey: SECRET_KEY, model: 'gpt-test' }, fakeClient('drop_database')));
    const response = await ask(shopA, 'Apague tudo');
    expect(response.json()).toMatchObject({ matched: false });
  });

  it('sem configuracao: status informa ausencia e a pergunta livre responde 503', async () => {
    const status = await authed(server, shopA.owner, { method: 'GET', url: '/api/assistant/status' });
    expect(status.json()).toMatchObject({ languageModelConfigured: false, provider: 'none' });
    expect((await ask(shopA, 'Quanto vendi hoje?')).statusCode).toBe(503);
  });
});

describe('consultas novas (dados reais, sem IA)', () => {
  const run = (tenant: TestTenant, name: string) =>
    authed(server, tenant.owner, { method: 'POST', url: `/api/assistant/tools/${name}` });

  it('quanto vendi hoje / quanto tenho em estoque / mais vendido / atendimentos amanha', async () => {
    const today = (await run(shopA, 'sales_today')).json<{ rows: { label: string; value: string }[] }>();
    expect(today.rows).toEqual(
      expect.arrayContaining([
        { label: 'Vendido', value: expect.stringContaining('200,00') },
        { label: 'Vendas', value: '1' },
      ]),
    );
    const stock = (await run(shopA, 'stock_overview')).json<{ answer: string }>();
    expect(stock.answer).toContain('480,00'); // 8 unidades x custo 60
    const top = (await run(shopA, 'top_products')).json<{ answer: string }>();
    expect(top.answer).toContain('Racao IA A');
    const tomorrow = (await run(shopA, 'appointments_tomorrow')).json<{ answer: string; rows: unknown[] }>();
    expect(tomorrow.answer).toContain('Nenhum atendimento');
    expect(tomorrow.rows).toEqual([]);
  });
});
