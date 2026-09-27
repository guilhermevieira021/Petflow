import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '../db/context.js';
import { payments, sales, stockMovements } from '../db/schema/index.js';
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
 * Fase 5 -- PDV (caixa). Fluxo do operador: bipa (lookup), finaliza (POST
 * /sales), e a venda + itens + pagamento + baixa de estoque + movimentacao
 * acontecem juntos, ou nada acontece.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let racao: { id: string };
let petisco: { id: string };
let racaoB: { id: string };

const EAN_RACAO = '7891000000011';
const EAN_PETISCO = '7891000000028';

async function stockOf(session: TestSession, id: string): Promise<number> {
  return (await authed(server, session, { method: 'GET', url: `/api/products/${id}` })).json<{ stockQuantity: number }>().stockQuantity;
}

async function salesCount(tenantId: string): Promise<number> {
  const [row] = await withSystem((tx) => tx.select({ value: count() }).from(sales).where(eq(sales.tenantId, tenantId)));
  return Number(row?.value ?? 0);
}

async function receivedToday(session: TestSession): Promise<number> {
  const overview = await authed(server, session, { method: 'GET', url: '/api/dashboard/overview' });
  return overview.json<{ today: { receivedRevenue: number } }>().today.receivedRevenue;
}

function checkout(session: TestSession, items: Record<string, unknown>[], method = 'PIX', paid = true) {
  return authed(server, session, { method: 'POST', url: '/api/sales', payload: { items, payment: { method, paid } } });
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Caixa A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Caixa B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });

  const create = (session: TestSession, payload: Record<string, unknown>) =>
    authed(server, session, { method: 'POST', url: '/api/products', payload });
  racao = (await create(shopA.owner, { name: 'Ração Premier 15kg', barcode: EAN_RACAO, salePrice: 189.9, costPrice: 140, initialStock: 20 })).json();
  petisco = (await create(shopA.owner, { name: 'Petisco 65g', barcode: EAN_PETISCO, salePrice: 9.9, initialStock: 2 })).json();
  racaoB = (await create(shopB.owner, { name: 'Ração Premier 15kg', barcode: EAN_RACAO, salePrice: 199, initialStock: 5 })).json();
});

afterAll(async () => {
  await teardownTestApp();
});

describe('caixa', () => {
  it('o bip encontra o produto do proprio pet shop (mesmo EAN em outro pet shop e outro produto)', async () => {
    const lookup = await authed(server, staffA, { method: 'GET', url: `/api/products/lookup?code=${EAN_RACAO}` });
    expect(lookup.json()).toMatchObject({ status: 'FOUND', product: { id: racao.id } });
    const inB = await authed(server, shopB.owner, { method: 'GET', url: `/api/products/lookup?code=${EAN_RACAO}` });
    expect(inB.json()).toMatchObject({ status: 'FOUND', product: { id: racaoB.id } });
  });

  it('finalizar: registra venda, baixa estoque (20 -> 19), movimentacao PDV e entra no Recebido', async () => {
    const before = await receivedToday(shopA.owner);
    const response = await checkout(staffA, [{ productId: racao.id, quantity: 1 }], 'CASH');
    expect(response.statusCode).toBe(201);
    const sale = response.json<{ id: string; number: number; status: string; total: number }>();
    expect(sale).toMatchObject({ status: 'PAID', total: 189.9 });

    expect(await stockOf(shopA.owner, racao.id)).toBe(19);

    const movements = await authed(server, shopA.owner, { method: 'GET', url: `/api/inventory/movements?productId=${racao.id}` });
    const [movement] = movements.json<{ data: Record<string, unknown>[] }>().data;
    expect(movement).toMatchObject({
      type: 'SALE',
      source: 'SALE',
      quantity: -1,
      balanceBefore: 20,
      balanceAfter: 19,
      saleId: sale.id,
      saleNumber: sale.number,
      reason: `Venda #${sale.number}`,
      barcode: EAN_RACAO,
    });
    expect(movement?.userName).toBeTruthy();
    expect(await receivedToday(shopA.owner)).toBeCloseTo(before + 189.9, 2);

    // Vendas do painel e da lista incluem a venda.
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const summary = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/sales/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect(summary.json()).toMatchObject({ salesCount: 1, totalSold: 189.9, totalReceived: 189.9 });
  });

  it('venda a receber NAO entra no Recebido ate ser recebida', async () => {
    const before = await receivedToday(shopA.owner);
    const response = await checkout(staffA, [{ productId: racao.id, quantity: 1 }], 'PIX', false);
    expect(response.json()).toMatchObject({ status: 'OPEN' });
    expect(await receivedToday(shopA.owner)).toBeCloseTo(before, 2);
    expect(await stockOf(shopA.owner, racao.id)).toBe(18);
  });

  it('estoque insuficiente: nada e gravado (nem a venda, nem o item valido, nem o pagamento)', async () => {
    const salesBefore = await salesCount(shopA.tenantId);
    const racaoBefore = await stockOf(shopA.owner, racao.id);
    const response = await checkout(staffA, [
      { productId: racao.id, quantity: 1 },
      { productId: petisco.id, quantity: 3 },
    ]);
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('Estoque insuficiente');

    expect(await salesCount(shopA.tenantId)).toBe(salesBefore);
    expect(await stockOf(shopA.owner, racao.id)).toBe(racaoBefore);
    expect(await stockOf(shopA.owner, petisco.id)).toBe(2);
    const [orphans] = await withSystem((tx) =>
      tx
        .select({ value: count() })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, shopA.tenantId), eq(stockMovements.productId, petisco.id), eq(stockMovements.type, 'SALE'))),
    );
    expect(Number(orphans?.value)).toBe(0);
  });

  it('mesmo produto em duas linhas soma para conferir o estoque', async () => {
    const response = await checkout(staffA, [
      { productId: petisco.id, quantity: 1 },
      { productId: petisco.id, quantity: 2 },
    ]);
    expect(response.statusCode).toBe(422);
    expect(await stockOf(shopA.owner, petisco.id)).toBe(2);
  });

  it('cancelar devolve ao estoque, registra a entrada e estorna sem duplicar recebimento', async () => {
    const received = await receivedToday(shopA.owner);
    const sale = (await checkout(staffA, [{ productId: petisco.id, quantity: 2 }], 'CASH')).json<{ id: string; number: number }>();
    expect(await stockOf(shopA.owner, petisco.id)).toBe(0);
    expect(await receivedToday(shopA.owner)).toBeCloseTo(received + 19.8, 2);

    const cancel = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/sales/${sale.id}/cancel`,
      payload: { reason: 'Cliente desistiu' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(await stockOf(shopA.owner, petisco.id)).toBe(2);

    const movements = await authed(server, shopA.owner, { method: 'GET', url: `/api/inventory/movements?productId=${petisco.id}` });
    const [reversal] = movements.json<{ data: { type: string; quantity: number; saleNumber: number }[] }>().data;
    expect(reversal).toMatchObject({ type: 'SALE_CANCELLATION', quantity: 2, saleNumber: sale.number });

    // Pagamento vira ESTORNADO (nao some) e sai do Recebido.
    const [payment] = await withSystem((tx) => tx.select().from(payments).where(eq(payments.saleId, sale.id)));
    expect(payment?.status).toBe('REFUNDED');
    expect(await receivedToday(shopA.owner)).toBeCloseTo(received, 2);

    // Cancelar de novo nao devolve de novo.
    const again = await authed(server, shopA.owner, { method: 'POST', url: `/api/sales/${sale.id}/cancel`, payload: { reason: 'De novo' } });
    expect(again.statusCode).toBe(409);
    expect(await stockOf(shopA.owner, petisco.id)).toBe(2);
  });

  it('pet shop B nao vende produto do A nem altera o estoque dele', async () => {
    const response = await checkout(shopB.owner, [{ productId: racao.id, quantity: 1 }]);
    expect(response.statusCode).toBe(404);
    const stockA = await stockOf(shopA.owner, racao.id);
    await checkout(shopB.owner, [{ productId: racaoB.id, quantity: 1 }]);
    expect(await stockOf(shopA.owner, racao.id)).toBe(stockA);
    expect(await stockOf(shopB.owner, racaoB.id)).toBe(4);
  });
});
