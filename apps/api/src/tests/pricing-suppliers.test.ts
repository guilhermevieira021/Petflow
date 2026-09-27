import { createHmac } from 'node:crypto';
import {
  isDryFoodCategory,
  marginOf,
  markupOf,
  priceForMargin,
  pricingProfileFromCategory,
  roundToCents,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setWhatsappProviderForTests, type WhatsappProvider } from '../integrations/whatsapp/whatsapp.provider.js';
import { setWhatsappWebhookConfigForTests } from '../modules/messages/whatsapp-webhook.service.js';
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
 * Fase 3 (continuacao): preco sugerido (margem x markup), fornecedores,
 * motivos de saida, custo da entrada, indicadores de estoque e webhook de
 * status do WhatsApp.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;

interface Product {
  id: string;
  name: string;
  salePrice: number;
  costPrice: number | null;
  margin: number | null;
  supplierId: string | null;
  supplierName: string | null;
  stockQuantity: number;
}

function suggestion(session: TestSession, query: string) {
  return authed(server, session, { method: 'GET', url: `/api/pricing/suggestion?${query}` });
}

async function createProduct(session: TestSession, payload: Record<string, unknown>) {
  return authed(server, session, { method: 'POST', url: '/api/products', payload });
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Preco A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Preco B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
});

afterEach(() => {
  setWhatsappProviderForTests(null);
  setWhatsappWebhookConfigForTests(null);
});

afterAll(async () => {
  await teardownTestApp();
});

describe('calculo de margem (unidade)', () => {
  it('preco = custo / (1 - margem)', () => {
    expect(priceForMargin(60, 0.2)).toBe(75);
    expect(priceForMargin(100, 0.25)).toBe(133.33);
    expect(priceForMargin(80, 0.35)).toBe(123.08);
  });

  it('margem nao e markup: 60 x 1,20 = 72 tem margem de so 16,7%', () => {
    const markupPrice = roundToCents(60 * 1.2);
    expect(markupPrice).toBe(72);
    expect(marginOf(markupPrice, 60)).toBeCloseTo(0.1667, 4);
    expect(marginOf(75, 60)).toBeCloseTo(0.2, 10);
    expect(markupOf(75, 60)).toBeCloseTo(0.25, 10);
    expect(priceForMargin(60, 0.2)).not.toBe(markupPrice);
  });

  it('entradas invalidas e casos sem dado', () => {
    expect(() => priceForMargin(60, 1)).toThrow();
    expect(() => priceForMargin(-1, 0.2)).toThrow();
    expect(marginOf(0, 10)).toBeNull();
    expect(marginOf(10, null)).toBeNull();
    expect(markupOf(10, 0)).toBeNull();
  });

  it('faixa da racao lida do nome da categoria', () => {
    expect(pricingProfileFromCategory('Ração Standard')).toBe('DRY_FOOD_STANDARD');
    expect(pricingProfileFromCategory('racao popular')).toBe('DRY_FOOD_STANDARD');
    expect(pricingProfileFromCategory('Ração Premium')).toBe('DRY_FOOD_PREMIUM');
    expect(pricingProfileFromCategory('Rações Super Premium')).toBe('DRY_FOOD_SUPER_PREMIUM');
    expect(pricingProfileFromCategory('Ração')).toBeNull();
    expect(pricingProfileFromCategory('Petiscos Premium')).toBeNull();
    expect(isDryFoodCategory('Ração')).toBe(true);
    expect(isDryFoodCategory('Higiene')).toBe(false);
  });
});

describe('preco sugerido (API)', () => {
  it('Racao Standard, custo R$ 60: margem 20% -> R$ 75,00, com faixa e aviso', async () => {
    const response = await suggestion(staffA, 'cost=60&category=Ra%C3%A7%C3%A3o%20Standard');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'SUGGESTED',
      price: 75,
      margin: 0.2,
      source: 'REFERENCE_MARGIN',
      profile: 'DRY_FOOD_STANDARD',
      range: { minMargin: 0.15, maxMargin: 0.2, minPrice: 70.59, maxPrice: 75 },
    });
    expect(response.json<{ disclaimer: string }>().disclaimer).toContain('Não é preço de mercado');
  });

  it('faixa escolhida explicitamente para "Ração"', async () => {
    const premium = (await suggestion(shopA.owner, 'cost=100&category=Ra%C3%A7%C3%A3o&profile=DRY_FOOD_PREMIUM')).json();
    expect(premium).toMatchObject({ status: 'SUGGESTED', margin: 0.3, price: 142.86 });
    const superPremium = (await suggestion(shopA.owner, 'cost=80&profile=DRY_FOOD_SUPER_PREMIUM')).json();
    expect(superPremium).toMatchObject({ margin: 0.4, price: 133.33 });
  });

  it('"Ração" sem faixa pede a faixa; categoria sem referencia nem historico: dados insuficientes', async () => {
    expect((await suggestion(shopA.owner, 'cost=50&category=Ra%C3%A7%C3%A3o')).json()).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      needsProfile: true,
    });
    const none = (await suggestion(shopA.owner, 'cost=50&category=Higiene')).json<{ status: string; explanation: string }>();
    expect(none.status).toBe('INSUFFICIENT_DATA');
    expect(none.explanation).toContain('Não temos dados suficientes');
  });

  it('usa a margem mediana que o proprio pet shop pratica (e so a dele)', async () => {
    // Margens 30%, 40%, 50% -> mediana 40%.
    for (const [price, cost] of [
      [100, 70],
      [100, 60],
      [100, 50],
    ]) {
      const created = await createProduct(shopA.owner, { name: `Shampoo ${cost}`, category: 'Higiene', salePrice: price, costPrice: cost });
      expect(created.statusCode).toBe(201);
    }
    const own = (await suggestion(shopA.owner, 'cost=60&category=higiene')).json();
    expect(own).toMatchObject({ status: 'SUGGESTED', source: 'OWN_CATEGORY_HISTORY', margin: 0.4, price: 100, sampleSize: 3 });
    // B nao tem historico: nao enxerga o do A.
    expect((await suggestion(shopB.owner, 'cost=60&category=Higiene')).json()).toMatchObject({ status: 'INSUFFICIENT_DATA' });
  });

  it('custo invalido e rejeitado', async () => {
    expect((await suggestion(shopA.owner, 'cost=0')).statusCode).toBe(422);
    expect((await suggestion(shopA.owner, 'cost=abc')).statusCode).toBe(422);
  });
});

describe('produto: preco, custo e margem', () => {
  it('margem calculada no produto; sem custo, margem nula', async () => {
    const withCost = (await createProduct(shopA.owner, { name: 'Racao Teste', salePrice: 75, costPrice: 60 })).json<Product>();
    expect(withCost.margin).toBe(0.2);
    const withoutCost = (await createProduct(shopA.owner, { name: 'Brinquedo Teste', salePrice: 20 })).json<Product>();
    expect(withoutCost.margin).toBeNull();
  });

  it('produto sem preco de venda e recusado (com erro no campo)', async () => {
    const response = await createProduct(shopA.owner, { name: 'Sem preco', costPrice: 10 });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('salePrice');
  });
});

describe('fornecedores', () => {
  let supplierA: string;

  it('cadastro, nome unico por pet shop e permissoes', async () => {
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/suppliers',
      payload: { name: 'Distribuidora Pet Sul', document: '12.345.678/0001-90', phone: '(11) 3333-4444' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ document: '12345678000190', phone: '1133334444', productCount: 0 });
    supplierA = created.json<{ id: string }>().id;

    const dup = await authed(server, shopA.owner, { method: 'POST', url: '/api/suppliers', payload: { name: 'distribuidora pet sul' } });
    expect(dup.statusCode).toBe(409);
    const staff = await authed(server, staffA, { method: 'POST', url: '/api/suppliers', payload: { name: 'Outro' } });
    expect(staff.statusCode).toBe(403);
    const other = await authed(server, shopB.owner, { method: 'POST', url: '/api/suppliers', payload: { name: 'Distribuidora Pet Sul' } });
    expect(other.statusCode).toBe(201);
  });

  it('produto associa fornecedor do proprio pet shop; o de outro, nao', async () => {
    const product = await createProduct(shopA.owner, { name: 'Areia Teste', salePrice: 30, supplierId: supplierA });
    expect(product.json<Product>()).toMatchObject({ supplierId: supplierA, supplierName: 'Distribuidora Pet Sul' });
    const foreign = await createProduct(shopB.owner, { name: 'Areia B', salePrice: 30, supplierId: supplierA });
    expect(foreign.statusCode).toBe(404);
    const list = await authed(server, shopB.owner, { method: 'GET', url: '/api/suppliers' });
    expect(list.json<{ id: string }[]>().some((item) => item.id === supplierA)).toBe(false);
    const patch = await authed(server, shopB.owner, { method: 'PATCH', url: `/api/suppliers/${supplierA}`, payload: { active: false } });
    expect(patch.statusCode).toBe(404);
  });

  it('fornecedor desativado nao e aceito em produto novo', async () => {
    await authed(server, shopA.owner, { method: 'PATCH', url: `/api/suppliers/${supplierA}`, payload: { active: false } });
    const product = await createProduct(shopA.owner, { name: 'Outra Areia', salePrice: 30, supplierId: supplierA });
    expect(product.statusCode).toBe(422);
    await authed(server, shopA.owner, { method: 'PATCH', url: `/api/suppliers/${supplierA}`, payload: { active: true } });
  });
});

describe('entrada com custo e saida por motivo', () => {
  let productId: string;

  it('entrada registra o custo da compra e, se pedido, atualiza o custo do produto', async () => {
    const product = (await createProduct(shopA.owner, { name: 'Golden Adultos 15kg', barcode: '7896000000017', salePrice: 109.9, costPrice: 80, minStock: 5, initialStock: 12 })).json<Product>();
    productId = product.id;

    const keep = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/inventory/entries',
      payload: { type: 'IN', items: [{ productId, quantity: 10, unitCost: 82.5 }] },
    });
    expect(keep.json<{ products: Product[] }>().products[0]).toMatchObject({ stockQuantity: 22, costPrice: 80 });

    const update = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/inventory/entries',
      payload: { type: 'IN', updateCostPrice: true, items: [{ productId, quantity: 1, unitCost: 85 }] },
    });
    const updated = update.json<{ products: Product[] }>().products[0]!;
    expect(updated).toMatchObject({ stockQuantity: 23, costPrice: 85 });
    expect(updated.margin).toBeCloseTo((109.9 - 85) / 109.9, 4);

    const movements = await authed(server, shopA.owner, { method: 'GET', url: `/api/inventory/movements?productId=${productId}` });
    const [last] = movements.json<{ data: { unitCost: number | null; userName: string | null }[] }>().data;
    expect(last).toMatchObject({ unitCost: 85 });
    expect(last?.userName).toBeTruthy();
  });

  it('saida: perda, avaria, ajuste e "venda fora do caixa" (que nao entra no Recebido)', async () => {
    const received = async () =>
      (await authed(server, shopA.owner, { method: 'GET', url: '/api/dashboard/overview' })).json<{ today: { receivedRevenue: number } }>().today
        .receivedRevenue;
    const before = await received();

    for (const exitReason of ['LOSS', 'DAMAGE', 'ADJUSTMENT', 'SALE']) {
      const response = await authed(server, shopA.owner, {
        method: 'POST',
        url: '/api/inventory/entries',
        payload: { type: 'OUT', exitReason, items: [{ productId, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(201);
    }
    const other = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/inventory/entries',
      payload: { type: 'OUT', exitReason: 'OTHER', items: [{ productId, quantity: 1 }] },
    });
    expect(other.statusCode).toBe(422);

    const movements = await authed(server, shopA.owner, { method: 'GET', url: `/api/inventory/movements?productId=${productId}&pageSize=4` });
    const types = movements.json<{ data: { type: string; reason: string }[] }>().data.map((row) => [row.type, row.reason]);
    expect(types).toEqual([
      ['OUT', 'Venda registrada fora do caixa (não entra no Recebido)'],
      ['ADJUSTMENT', 'Ajuste'],
      ['DAMAGE', 'Avaria'],
      ['LOSS', 'Perda'],
    ]);
    expect((await authed(server, shopA.owner, { method: 'GET', url: `/api/products/${productId}` })).json<Product>().stockQuantity).toBe(19);
    expect(await received()).toBe(before);
  });

  it('saida nunca deixa o estoque negativo', async () => {
    const response = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/inventory/entries',
      payload: { type: 'OUT', exitReason: 'LOSS', items: [{ productId, quantity: 100 }] },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('indicadores de estoque', () => {
  it('mais vendidos, giro e zerados vem so de dados reais do tenant', async () => {
    const empty = (await authed(server, shopB.owner, { method: 'GET', url: '/api/inventory/insights' })).json<{ topSelling: unknown[] }>();
    expect(empty.topSelling).toEqual([]);

    const product = (await createProduct(shopA.owner, { name: 'Petisco Giro', salePrice: 10, initialStock: 4 })).json<Product>();
    const sale = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ productId: product.id, quantity: 4 }], payment: { method: 'PIX', paid: true } },
    });
    expect(sale.statusCode).toBe(201);

    const insights = (await authed(server, shopA.owner, { method: 'GET', url: '/api/inventory/insights' })).json<{
      topSelling: { productId: string; quantitySold: number; revenue: number; turnover: number }[];
      outOfStock: { id: string }[];
      summary: { outOfStockProducts: number };
    }>();
    expect(insights.topSelling[0]).toMatchObject({ productId: product.id, quantitySold: 4, revenue: 40, turnover: 1 });
    expect(insights.outOfStock.map((item) => item.id)).toContain(product.id);
    expect(insights.summary.outOfStockProducts).toBeGreaterThanOrEqual(1);

    // B continua vazio.
    const inB = (await authed(server, shopB.owner, { method: 'GET', url: '/api/inventory/insights' })).json<{ topSelling: unknown[]; outOfStock: unknown[] }>();
    expect(inB.topSelling).toEqual([]);
  });
});

describe('webhook de status do WhatsApp', () => {
  const secret = 'segredo-de-teste';
  let providerId: string;

  function post(payload: unknown, signature?: string) {
    const body = JSON.stringify(payload);
    return server.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        ...(signature !== undefined
          ? { 'x-hub-signature-256': signature }
          : { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }),
      },
      payload: body,
    });
  }

  const statusPayload = (id: string, status: string, errors?: unknown[]) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status, timestamp: '1', ...(errors ? { errors } : {}) }] } }] }],
  });

  async function messageStatus(): Promise<{ status: string; failureReason: string | null }> {
    const list = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages?pageSize=50' });
    const found = list.json<{ data: { providerMessageId?: string; status: string; failureReason: string | null; content: string }[] }>().data.find(
      (message) => message.content === 'Mensagem webhook',
    );
    return { status: found!.status, failureReason: found!.failureReason };
  }

  it('sem configuracao: verificacao e notificacoes respondem 503', async () => {
    setWhatsappWebhookConfigForTests({ verifyToken: null, appSecret: null });
    const verify = await server.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1' });
    expect(verify.statusCode).toBe(503);
    expect((await post({ entry: [] })).statusCode).toBe(503);
  });

  it('verificacao da Meta devolve o challenge so com o token certo', async () => {
    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    const ok = await server.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('42');
    const bad = await server.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42' });
    expect(bad.statusCode).toBe(403);
  });

  it('assinatura invalida e rejeitada', async () => {
    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    expect((await post(statusPayload('wamid.x', 'read'), 'sha256=00')).statusCode).toBe(401);
    expect((await post(statusPayload('wamid.x', 'read'), '')).statusCode).toBe(401);
  });

  it('entregue e lida so depois da notificacao da Meta; status nunca retrocede', async () => {
    const provider: WhatsappProvider = {
      kind: 'cloud_api',
      configured: true,
      send: async () => ({ providerMessageId: 'wamid.webhook.1' }),
    };
    setWhatsappProviderForTests(provider);
    const customer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Webhook', phone: '11988887777' },
    });
    const sent = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customer.json<{ id: string }>().id, content: 'Mensagem webhook' },
    });
    expect(sent.json<{ delivered: boolean }>().delivered).toBe(true);
    providerId = 'wamid.webhook.1';
    expect((await messageStatus()).status).toBe('SENT');

    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    expect((await post(statusPayload(providerId, 'delivered'))).json()).toMatchObject({ received: 1, updated: 1 });
    expect((await messageStatus()).status).toBe('DELIVERED');
    await post(statusPayload(providerId, 'read'));
    expect((await messageStatus()).status).toBe('READ');
    // Notificacoes atrasadas nao rebaixam.
    expect((await post(statusPayload(providerId, 'sent'))).json()).toMatchObject({ ignored: 1 });
    await post(statusPayload(providerId, 'failed', [{ code: 131026, title: 'Undeliverable' }]));
    expect((await messageStatus()).status).toBe('READ');
  });

  it('falha informada pela Meta vira FAILED com o motivo; id desconhecido e ignorado', async () => {
    setWhatsappProviderForTests({ kind: 'cloud_api', configured: true, send: async () => ({ providerMessageId: 'wamid.webhook.2' }) });
    const customer = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'Cliente Falha', phone: '11977776666' },
    });
    await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customer.json<{ id: string }>().id, content: 'Mensagem falha' },
    });
    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    await post(statusPayload('wamid.webhook.2', 'failed', [{ code: 131026, title: 'Message undeliverable' }]));
    const list = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages?pageSize=50' });
    const failed = list.json<{ data: { content: string; status: string; failureReason: string | null }[] }>().data.find(
      (message) => message.content === 'Mensagem falha',
    );
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed?.failureReason).toContain('131026');

    expect((await post(statusPayload('wamid.nao.existe', 'read'))).json()).toMatchObject({ unknown: 1 });
  });
});
