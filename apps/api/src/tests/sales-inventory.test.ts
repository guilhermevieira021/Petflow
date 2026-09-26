import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant } from '../db/context.js';
import { billingEvents, stockMovements, subscriptions } from '../db/schema/index.js';
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
 * VENDAS + ESTOQUE (FLUXO 1: dinheiro do pet shop).
 *
 * Cobre regra de negocio, persistencia, autorizacao, isolamento entre tenants
 * e -- regra critica -- a separacao total do FLUXO 2 (assinatura Petflow):
 * nenhuma venda altera assinatura/plano/billing_events, e o "Recebido" do
 * dashboard reflete somente os recebimentos das vendas.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let customerA: string;
let petA: string;

interface ProductBody {
  id: string;
  stockQuantity: number;
  lowStock: boolean;
  trackStock: boolean;
}

interface SaleBody {
  id: string;
  number: number;
  status: string;
  total: number;
  subtotal: number;
  discount: number;
  items: { description: string; quantity: number; total: number }[];
  payments: { status: string; amount: number; method: string }[];
}

async function createProduct(session: TestSession, payload: Record<string, unknown>) {
  return authed(server, session, { method: 'POST', url: '/api/products', payload });
}

async function getProduct(session: TestSession, id: string): Promise<ProductBody> {
  const response = await authed(server, session, { method: 'GET', url: `/api/products/${id}` });
  return response.json<ProductBody>();
}

async function receivedToday(session: TestSession): Promise<number> {
  const response = await authed(server, session, { method: 'GET', url: '/api/dashboard/overview' });
  return response.json<{ today: { receivedRevenue: number } }>().today.receivedRevenue;
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Vendas A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Vendas B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });

  const customer = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: 'Cliente Vendas', phone: '11977776666' },
  });
  customerA = customer.json<{ id: string }>().id;
  const pet = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId: customerA, name: 'Rex Vendas', species: 'DOG' },
  });
  petA = pet.json<{ id: string }>().id;
});

afterAll(async () => {
  await teardownTestApp();
});

describe('produtos e estoque', () => {
  it('cria produto e registra o saldo inicial como movimentacao de ENTRADA', async () => {
    const response = await createProduct(shopA.owner, {
      name: 'Racao Premium 1kg',
      sku: 'RAC-001',
      barcode: '7891234567890',
      category: 'Racao',
      salePrice: 59.9,
      costPrice: 35,
      minStock: 3,
      initialStock: 10,
    });
    expect(response.statusCode).toBe(201);
    const product = response.json<ProductBody>();
    expect(product.stockQuantity).toBe(10);

    const movements = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/inventory/movements?productId=${product.id}`,
    });
    const body = movements.json<{ data: { type: string; quantity: number; balanceAfter: number }[] }>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ type: 'IN', quantity: 10, balanceAfter: 10 });
  });

  it('recusa SKU e codigo de barras repetidos no mesmo pet shop (409), mas aceita em outro pet shop', async () => {
    const duplicate = await createProduct(shopA.owner, { name: 'Outra racao', sku: 'rac-001', salePrice: 10 });
    expect(duplicate.statusCode).toBe(409);

    const otherShop = await createProduct(shopB.owner, { name: 'Racao do B', sku: 'RAC-001', barcode: '7891234567890', salePrice: 10 });
    expect(otherShop.statusCode).toBe(201);
  });

  it('valida entrada: preco negativo e quantidade com mais de 3 casas sao 422', async () => {
    const negative = await createProduct(shopA.owner, { name: 'Produto invalido', salePrice: -1 });
    expect(negative.statusCode).toBe(422);
    const precision = await createProduct(shopA.owner, { name: 'Produto invalido', salePrice: 1, initialStock: 1.0001 });
    expect(precision.statusCode).toBe(422);
  });

  it('entrada, saida e ajuste mantem o saldo e o historico coerentes, sem saldo negativo', async () => {
    const created = await createProduct(shopA.owner, { name: 'Shampoo Neutro', salePrice: 25, minStock: 2, initialStock: 5 });
    const { id } = created.json<ProductBody>();

    const inbound = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/products/${id}/movements`,
      payload: { type: 'IN', quantity: 3, unitCost: 12 },
    });
    expect(inbound.statusCode).toBe(201);
    expect(inbound.json<ProductBody>().stockQuantity).toBe(8);

    const outbound = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/products/${id}/movements`,
      payload: { type: 'OUT', quantity: 2, reason: 'Avaria' },
    });
    expect(outbound.json<ProductBody>().stockQuantity).toBe(6);

    const tooMuch = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/products/${id}/movements`,
      payload: { type: 'OUT', quantity: 7 },
    });
    expect(tooMuch.statusCode).toBe(422);
    expect((await getProduct(shopA.owner, id)).stockQuantity).toBe(6);

    const adjustment = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/products/${id}/movements`,
      payload: { type: 'ADJUSTMENT', quantity: 1.5, reason: 'Inventario' },
    });
    const adjusted = adjustment.json<ProductBody>();
    expect(adjusted.stockQuantity).toBe(1.5);
    expect(adjusted.lowStock).toBe(true);

    const lowStock = await authed(server, shopA.owner, { method: 'GET', url: '/api/products?lowStock=true' });
    expect(lowStock.json<{ data: { id: string }[] }>().data.map((row) => row.id)).toContain(id);

    const summary = await authed(server, shopA.owner, { method: 'GET', url: '/api/inventory/summary' });
    expect(summary.json<{ lowStockProducts: number }>().lowStockProducts).toBeGreaterThanOrEqual(1);
  });

  it('historico de estoque e append-only no banco (sem UPDATE/DELETE para a role da aplicacao)', async () => {
    await expect(
      withTenant(shopA.tenantId, (tx) => tx.update(stockMovements).set({ reason: 'adulterado' })),
    ).rejects.toThrow();
    await expect(withTenant(shopA.tenantId, (tx) => tx.delete(stockMovements))).rejects.toThrow();
  });
});

describe('vendas', () => {
  let productId: string;

  beforeAll(async () => {
    const created = await createProduct(shopA.owner, { name: 'Coleira M', sku: 'COL-M', salePrice: 30, initialStock: 4 });
    productId = created.json<ProductBody>().id;
  });

  it('venda paga: baixa o estoque, gera recebimento PAGO e entra no "Recebido" do dashboard', async () => {
    const before = await receivedToday(shopA.owner);

    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: {
        customerId: customerA,
        petId: petA,
        items: [
          { productId, quantity: 2 },
          { description: 'Laco decorativo', quantity: 1, unitPrice: 5 },
        ],
        discount: 5,
        payment: { method: 'PIX', paid: true },
      },
    });
    expect(response.statusCode).toBe(201);
    const sale = response.json<SaleBody>();
    expect(sale).toMatchObject({ status: 'PAID', subtotal: 65, discount: 5, total: 60 });
    expect(sale.number).toBeGreaterThanOrEqual(1);
    expect(sale.payments).toEqual([expect.objectContaining({ status: 'PAID', amount: 60, method: 'PIX' })]);

    expect((await getProduct(shopA.owner, productId)).stockQuantity).toBe(2);
    expect(await receivedToday(shopA.owner)).toBe(before + 60);
  });

  it('venda a receber nao entra no "Recebido" ate ser recebida', async () => {
    const before = await receivedToday(shopA.owner);
    const created = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { customerId: customerA, items: [{ productId, quantity: 1 }], payment: { method: 'CASH', paid: false } },
    });
    const sale = created.json<SaleBody>();
    expect(sale.status).toBe('OPEN');
    expect(await receivedToday(shopA.owner)).toBe(before);

    const received = await authed(server, staffA, {
      method: 'POST',
      url: `/api/sales/${sale.id}/receive`,
      payload: { method: 'DEBIT_CARD' },
    });
    expect(received.statusCode).toBe(200);
    expect(received.json<SaleBody>()).toMatchObject({ status: 'PAID', payments: [expect.objectContaining({ method: 'DEBIT_CARD', status: 'PAID' })] });
    expect(await receivedToday(shopA.owner)).toBe(before + 30);

    const again = await authed(server, staffA, { method: 'POST', url: `/api/sales/${sale.id}/receive`, payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it('estoque insuficiente recusa a venda inteira (nada e gravado, nem o numero e consumido)', async () => {
    const listBefore = await authed(server, shopA.owner, { method: 'GET', url: '/api/sales?pageSize=1' });
    const lastNumber = listBefore.json<{ data: SaleBody[] }>().data[0]?.number ?? 0;
    const stockBefore = (await getProduct(shopA.owner, productId)).stockQuantity;

    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ productId, quantity: 99 }], payment: { method: 'CASH', paid: true } },
    });
    expect(response.statusCode).toBe(422);
    expect((await getProduct(shopA.owner, productId)).stockQuantity).toBe(stockBefore);

    const next = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ description: 'Taxa de entrega', quantity: 1, unitPrice: 8 }], payment: { method: 'CASH', paid: true } },
    });
    expect(next.json<SaleBody>().number).toBe(lastNumber + 1);
  });

  it('venda de balcao sem cliente cadastrado e aceita', async () => {
    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ description: 'Petisco avulso', quantity: 3, unitPrice: 2.5 }], payment: { method: 'CASH', paid: true } },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<SaleBody>()).toMatchObject({ total: 7.5, status: 'PAID' });
  });

  it('valida: desconto maior que o total, pet sem cliente e venda sem itens', async () => {
    const discount = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ description: 'Item', quantity: 1, unitPrice: 10 }], discount: 11, payment: { method: 'CASH' } },
    });
    expect(discount.statusCode).toBe(422);

    const petWithoutCustomer = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { petId: petA, items: [{ description: 'Item', quantity: 1, unitPrice: 10 }], payment: { method: 'CASH' } },
    });
    expect(petWithoutCustomer.statusCode).toBe(422);

    const empty = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [], payment: { method: 'CASH' } },
    });
    expect(empty.statusCode).toBe(422);
  });

  it('cancelamento devolve o estoque, estorna o recebimento e tira o valor do "Recebido"', async () => {
    const created = await authed(server, staffA, {
      method: 'POST',
      url: '/api/sales',
      payload: { customerId: customerA, items: [{ productId, quantity: 1 }], payment: { method: 'CREDIT_CARD', paid: true } },
    });
    const sale = created.json<SaleBody>();
    const stockAfterSale = (await getProduct(shopA.owner, productId)).stockQuantity;
    const receivedAfterSale = await receivedToday(shopA.owner);

    // STAFF nao cancela venda.
    const forbidden = await authed(server, staffA, {
      method: 'POST',
      url: `/api/sales/${sale.id}/cancel`,
      payload: { reason: 'Cliente desistiu' },
    });
    expect(forbidden.statusCode).toBe(403);

    const cancelled = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/sales/${sale.id}/cancel`,
      payload: { reason: 'Cliente desistiu' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<SaleBody>()).toMatchObject({
      status: 'CANCELLED',
      payments: [expect.objectContaining({ status: 'REFUNDED' })],
    });
    expect((await getProduct(shopA.owner, productId)).stockQuantity).toBe(stockAfterSale + 1);
    expect(await receivedToday(shopA.owner)).toBe(receivedAfterSale - 30);

    const twice = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/sales/${sale.id}/cancel`,
      payload: { reason: 'De novo' },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('resumo de vendas soma somente o que foi vendido e recebido na janela', async () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const response = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/sales/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect(response.statusCode).toBe(200);
    const summary = response.json<{ totalSold: number; totalReceived: number; salesCount: number }>();
    expect(summary.salesCount).toBeGreaterThanOrEqual(4);
    expect(summary.totalReceived).toBeLessThanOrEqual(summary.totalSold);
  });
});

describe('autorizacao', () => {
  it('STAFF le produtos e vende, mas nao cria produto nem movimenta estoque', async () => {
    expect((await authed(server, staffA, { method: 'GET', url: '/api/products' })).statusCode).toBe(200);

    const create = await createProduct(staffA, { name: 'Produto do Staff', salePrice: 1 });
    expect(create.statusCode).toBe(403);
    expect(errorCode(create.body)).toBe('INSUFFICIENT_PERMISSION');

    const list = await authed(server, staffA, { method: 'GET', url: '/api/products?pageSize=1' });
    const productId = list.json<{ data: { id: string }[] }>().data[0]!.id;
    const move = await authed(server, staffA, {
      method: 'POST',
      url: `/api/products/${productId}/movements`,
      payload: { type: 'IN', quantity: 1 },
    });
    expect(move.statusCode).toBe(403);
  });

  it('sem sessao, as rotas de vendas e produtos respondem 401', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/sales' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/products' })).statusCode).toBe(401);
  });
});

describe('isolamento entre pet shops', () => {
  it('o pet shop B nao ve, nao le e nao vende produtos nem vendas do A', async () => {
    const productsA = await authed(server, shopA.owner, { method: 'GET', url: '/api/products?pageSize=1' });
    const productIdA = productsA.json<{ data: { id: string }[] }>().data[0]!.id;
    const salesA = await authed(server, shopA.owner, { method: 'GET', url: '/api/sales?pageSize=1' });
    const saleIdA = salesA.json<{ data: { id: string }[] }>().data[0]!.id;

    expect((await authed(server, shopB.owner, { method: 'GET', url: `/api/products/${productIdA}` })).statusCode).toBe(404);
    expect((await authed(server, shopB.owner, { method: 'GET', url: `/api/sales/${saleIdA}` })).statusCode).toBe(404);

    const listB = await authed(server, shopB.owner, { method: 'GET', url: '/api/sales' });
    expect(listB.json<{ data: unknown[] }>().data).toHaveLength(0);

    const sellForeign = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ productId: productIdA, quantity: 1 }], payment: { method: 'CASH' } },
    });
    expect(sellForeign.statusCode).toBe(404);

    const cancelForeign = await authed(server, shopB.owner, {
      method: 'POST',
      url: `/api/sales/${saleIdA}/cancel`,
      payload: { reason: 'Tentativa' },
    });
    expect(cancelForeign.statusCode).toBe(404);

    const foreignCustomer = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { customerId: customerA, items: [{ description: 'x', quantity: 1, unitPrice: 1 }], payment: { method: 'CASH' } },
    });
    expect(foreignCustomer.statusCode).toBe(404);
  });

  it('RLS: consulta sem filtro de tenant, dentro do contexto do B, nao enxerga linhas do A', async () => {
    const rows = await withTenant(shopB.tenantId, (tx) =>
      tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM sales`),
    );
    const expected = await withSystem((tx) =>
      tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM sales WHERE tenant_id = ${shopB.tenantId}`),
    );
    expect(rows.rows[0]?.total).toBe(expected.rows[0]?.total);
  });
});

describe('separacao do billing do Petflow (FLUXO 2)', () => {
  it('vendas e recebimentos nao alteram assinatura, plano nem eventos de billing', async () => {
    const snapshot = async () =>
      withSystem(async (tx) => {
        const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, shopA.tenantId));
        const [events] = await tx.select({ total: sql<number>`count(*)::int` }).from(billingEvents);
        return {
          planId: subscription?.planId,
          status: subscription?.status,
          currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
          trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
          events: events?.total ?? 0,
        };
      });

    const before = await snapshot();
    await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ description: 'Banho avulso', quantity: 1, unitPrice: 60 }], payment: { method: 'PIX', paid: true } },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('com o trial vencido, vendas sao bloqueadas (403) -- mesma barreira dos demais modulos', async () => {
    const expired = await createTenantWithOwner(server, { tenantName: 'Pet Shop Vendas Trial Vencido' });
    await withSystem((tx) =>
      tx
        .update(subscriptions)
        .set({ trialEndsAt: new Date(Date.now() - 60_000) })
        .where(eq(subscriptions.tenantId, expired.tenantId)),
    );
    const attempt = await authed(server, expired.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ description: 'Item', quantity: 1, unitPrice: 10 }], payment: { method: 'CASH' } },
    });
    expect(attempt.statusCode).toBe(403);
    expect(errorCode(attempt.body)).toBe('SUBSCRIPTION_REQUIRED');
  });
});
