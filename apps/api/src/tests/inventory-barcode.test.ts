import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setProductCatalogProviderForTests } from '../integrations/catalog/product-catalog.provider.js';
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
 * Fase 3 -- estoque profissional: marcas, leitor de codigo de barras
 * (lookup + entrada rapida em lote), produto desconhecido cadastrado a partir
 * do bip, historico com origem/codigo, integracao com vendas e isolamento.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;

const EAN = '7896181200012';

interface Product {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  brandId: string | null;
  brandName: string | null;
  description: string | null;
  stockQuantity: number;
  lowStock: boolean;
}
interface Brand {
  id: string;
  name: string;
  isReference: boolean;
  active: boolean;
  productCount: number;
}
interface Movement {
  productId: string;
  type: string;
  source: string;
  barcode: string | null;
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string | null;
  userName: string | null;
}

async function createProduct(session: TestSession, payload: Record<string, unknown>) {
  return authed(server, session, { method: 'POST', url: '/api/products', payload: { salePrice: 10, ...payload } });
}

function lookup(session: TestSession, code: string) {
  return authed(server, session, { method: 'GET', url: `/api/products/lookup?code=${encodeURIComponent(code)}` });
}

function entry(session: TestSession, payload: Record<string, unknown>) {
  return authed(server, session, { method: 'POST', url: '/api/inventory/entries', payload });
}

async function movementsOf(session: TestSession, productId: string): Promise<Movement[]> {
  const response = await authed(server, session, { method: 'GET', url: `/api/inventory/movements?productId=${productId}` });
  return response.json<{ data: Movement[] }>().data;
}

async function productOf(session: TestSession, id: string): Promise<Product> {
  return (await authed(server, session, { method: 'GET', url: `/api/products/${id}` })).json<Product>();
}

async function brandsOf(session: TestSession, query = ''): Promise<Brand[]> {
  return (await authed(server, session, { method: 'GET', url: `/api/brands${query}` })).json<Brand[]>();
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Leitor A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Leitor B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
});

afterEach(() => setProductCatalogProviderForTests(null));

afterAll(async () => {
  await teardownTestApp();
});

describe('marcas', () => {
  it('catalogo de referencia ja vem com marcas conhecidas (so nomes)', async () => {
    const reference = await brandsOf(shopA.owner, '?origin=reference');
    const names = reference.map((brand) => brand.name);
    for (const expected of ['Special Dog', 'Premier Pet', 'Golden', 'Royal Canin', 'Pedigree', 'Whiskas', 'N&D']) {
      expect(names).toContain(expected);
    }
    expect(reference.every((brand) => brand.isReference && brand.productCount === 0)).toBe(true);
    // Nenhum produto e criado junto com o catalogo.
    const products = await authed(server, shopA.owner, { method: 'GET', url: '/api/products' });
    expect(products.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it('pet shop cadastra marca propria; nome repetido (inclusive do catalogo) e recusado', async () => {
    const created = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/brands',
      payload: { name: 'Joãozinho Rações', segment: 'FOOD' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<Brand>()).toMatchObject({ name: 'Joãozinho Rações', isReference: false, active: true });

    const again = await authed(server, shopA.owner, { method: 'POST', url: '/api/brands', payload: { name: ' joãozinho rações ' } });
    expect(again.statusCode).toBe(409);
    const reference = await authed(server, shopA.owner, { method: 'POST', url: '/api/brands', payload: { name: 'special dog' } });
    expect(reference.statusCode).toBe(409);
  });

  it('marca propria e invisivel para outro pet shop, que pode ter uma com o mesmo nome', async () => {
    const [own] = await brandsOf(shopA.owner, '?origin=own');
    expect((await brandsOf(shopB.owner)).some((brand) => brand.id === own?.id)).toBe(false);
    const patch = await authed(server, shopB.owner, { method: 'PATCH', url: `/api/brands/${own?.id}`, payload: { active: false } });
    expect(patch.statusCode).toBe(404);
    const same = await authed(server, shopB.owner, { method: 'POST', url: '/api/brands', payload: { name: 'Joãozinho Rações' } });
    expect(same.statusCode).toBe(201);
  });

  it('marca de referencia nao pode ser editada; STAFF nao cadastra marca', async () => {
    const [reference] = await brandsOf(shopA.owner, '?origin=reference&search=Golden');
    const edit = await authed(server, shopA.owner, { method: 'PATCH', url: `/api/brands/${reference?.id}`, payload: { name: 'X' } });
    expect(edit.statusCode).toBe(422);
    const staff = await authed(server, staffA, { method: 'POST', url: '/api/brands', payload: { name: 'Marca Staff' } });
    expect(staff.statusCode).toBe(403);
  });

  it('produto associa marca de referencia ou propria; marca de outro tenant nao', async () => {
    const [special] = await brandsOf(shopA.owner, '?search=Special%20Dog');
    const created = await createProduct(shopA.owner, {
      name: 'Special Dog Adultos 15kg',
      barcode: EAN,
      sku: 'SD-15',
      brandId: special?.id,
      category: 'Ração',
      description: 'Racao para caes adultos',
      minStock: 5,
      initialStock: 8,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<Product>()).toMatchObject({ brandName: 'Special Dog', description: 'Racao para caes adultos', stockQuantity: 8 });

    const [bBrand] = await brandsOf(shopB.owner, '?origin=own');
    const foreign = await createProduct(shopA.owner, { name: 'Produto X', brandId: bBrand?.id });
    expect(foreign.statusCode).toBe(404);

    const counted = await brandsOf(shopA.owner, '?search=Special%20Dog');
    expect(counted[0]?.productCount).toBe(1);
    // A contagem e por pet shop.
    expect((await brandsOf(shopB.owner, '?search=Special%20Dog'))[0]?.productCount).toBe(0);
  });

  it('marca desativada nao e oferecida nem aceita em produto novo', async () => {
    const [own] = await brandsOf(shopA.owner, '?origin=own');
    await authed(server, shopA.owner, { method: 'PATCH', url: `/api/brands/${own?.id}`, payload: { active: false } });
    expect((await brandsOf(shopA.owner, '?origin=own')).length).toBe(0);
    expect((await brandsOf(shopA.owner, '?origin=own&includeInactive=true'))[0]?.active).toBe(false);
    const product = await createProduct(shopA.owner, { name: 'Racao regional', brandId: own?.id });
    expect(product.statusCode).toBe(422);
    await authed(server, shopA.owner, { method: 'PATCH', url: `/api/brands/${own?.id}`, payload: { active: true } });
  });
});

describe('cadastro de produto', () => {
  it('SKU e codigo de barras duplicados no mesmo pet shop sao recusados', async () => {
    expect((await createProduct(shopA.owner, { name: 'Outro', barcode: EAN })).statusCode).toBe(409);
    expect((await createProduct(shopA.owner, { name: 'Outro', sku: 'sd-15' })).statusCode).toBe(409);
  });

  it('o mesmo EAN em outro pet shop e um registro independente', async () => {
    const created = await createProduct(shopB.owner, { name: 'Special Dog Adultos 15kg', barcode: EAN, initialStock: 2 });
    expect(created.statusCode).toBe(201);
    const inA = (await lookup(shopA.owner, EAN)).json<{ status: string; product: Product }>();
    const inB = (await lookup(shopB.owner, EAN)).json<{ status: string; product: Product }>();
    expect(inA.product.id).not.toBe(inB.product.id);
    expect(inA.product.stockQuantity).toBe(8);
    expect(inB.product.stockQuantity).toBe(2);
  });
});

describe('leitor de codigo de barras', () => {
  it('produto encontrado pelo codigo (com lixo do leitor) e pelo SKU', async () => {
    const found = await lookup(shopA.owner, ` ${EAN}\r\n`);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ status: 'FOUND', code: EAN, matchedBy: 'BARCODE', product: { name: 'Special Dog Adultos 15kg' } });
    const bySku = await lookup(staffA, 'SD-15');
    expect(bySku.json()).toMatchObject({ status: 'FOUND', matchedBy: 'SKU' });
  });

  it('codigo desconhecido: NOT_FOUND com o codigo, sem inventar dados', async () => {
    const response = await lookup(shopA.owner, '7890000000017');
    expect(response.json()).toEqual({ status: 'NOT_FOUND', code: '7890000000017', catalogSuggestion: null });
  });

  it('base global (futura) so sugere; nada e cadastrado sozinho', async () => {
    setProductCatalogProviderForTests({
      name: 'teste',
      configured: true,
      lookup: async () => ({ source: 'teste', name: 'Sugestao', brandName: null, category: null, variant: null }),
    });
    const response = await lookup(shopA.owner, '7890000000024');
    expect(response.json()).toMatchObject({ status: 'NOT_FOUND', catalogSuggestion: { name: 'Sugestao' } });
    expect((await lookup(shopA.owner, '7890000000024')).json()).toMatchObject({ status: 'NOT_FOUND' });
  });

  it('multiplos bips do mesmo produto viram uma entrada somada (STAFF recebe mercadoria)', async () => {
    const { product } = (await lookup(staffA, EAN)).json<{ product: Product }>();
    const response = await entry(staffA, {
      type: 'IN',
      source: 'BARCODE',
      items: [
        { productId: product.id, quantity: 1, scannedCode: EAN },
        { productId: product.id, quantity: 1, scannedCode: EAN },
        { productId: product.id, quantity: 1, scannedCode: EAN },
      ],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ movements: number; products: Product[] }>()).toMatchObject({ movements: 1, products: [{ stockQuantity: 11 }] });

    const [last] = await movementsOf(shopA.owner, product.id);
    expect(last).toMatchObject({
      type: 'IN',
      source: 'BARCODE',
      barcode: EAN,
      quantity: 3,
      balanceBefore: 8,
      balanceAfter: 11,
      reason: 'Entrada de mercadoria',
    });
    expect(last?.userName).toBeTruthy();
  });

  it('produto desconhecido: cadastro + entrada na mesma transacao', async () => {
    const code = '7891000100103';
    expect((await lookup(shopA.owner, code)).json<{ status: string }>().status).toBe('NOT_FOUND');
    const created = await createProduct(shopA.owner, {
      name: 'Petisco Regional 65g',
      barcode: code,
      category: 'Petiscos',
      costPrice: 4.5,
      salePrice: 9.9,
      minStock: 2,
      initialStock: 6,
      entrySource: 'BARCODE',
    });
    expect(created.statusCode).toBe(201);
    const product = created.json<Product>();
    expect(product.stockQuantity).toBe(6);
    expect((await lookup(shopA.owner, code)).json<{ status: string }>().status).toBe('FOUND');
    const [movement] = await movementsOf(shopA.owner, product.id);
    expect(movement).toMatchObject({ type: 'IN', source: 'BARCODE', barcode: code, quantity: 6, balanceBefore: 0 });
  });

  it('cadastro que falha nao deixa produto nem movimentacao pela metade', async () => {
    const code = '7891000100110';
    const failed = await createProduct(shopA.owner, {
      name: 'Produto sem controle',
      barcode: code,
      trackStock: false,
      initialStock: 3,
      entrySource: 'BARCODE',
    });
    expect(failed.statusCode).toBe(422);
    expect((await lookup(shopA.owner, code)).json<{ status: string }>().status).toBe('NOT_FOUND');
  });

  it('STAFF nao cadastra produto desconhecido nem da saida', async () => {
    expect((await createProduct(staffA, { name: 'Tentativa', barcode: '7891000100127' })).statusCode).toBe(403);
    const { product } = (await lookup(staffA, EAN)).json<{ product: Product }>();
    const out = await entry(staffA, { type: 'OUT', exitReason: 'LOSS', items: [{ productId: product.id, quantity: 1 }] });
    expect(out.statusCode).toBe(403);
  });

  it('lote e tudo ou nada: saida acima do saldo nao muda nenhum produto', async () => {
    const special = (await lookup(shopA.owner, EAN)).json<{ product: Product }>().product;
    const petisco = (await lookup(shopA.owner, '7891000100103')).json<{ product: Product }>().product;
    const response = await entry(shopA.owner, {
      type: 'OUT',
      exitReason: 'DAMAGE',
      items: [
        { productId: special.id, quantity: 1 },
        { productId: petisco.id, quantity: 999 },
      ],
    });
    expect(response.statusCode).toBe(422);
    expect((await productOf(shopA.owner, special.id)).stockQuantity).toBe(11);
    expect((await productOf(shopA.owner, petisco.id)).stockQuantity).toBe(6);
  });

  it('saida exige motivo e registra PERDA com saldo anterior e posterior', async () => {
    const petisco = (await lookup(shopA.owner, '7891000100103')).json<{ product: Product }>().product;
    const withoutReason = await entry(shopA.owner, { type: 'OUT', items: [{ productId: petisco.id, quantity: 1 }] });
    expect(withoutReason.statusCode).toBe(422);
    const out = await entry(shopA.owner, { type: 'OUT', exitReason: 'LOSS', reason: 'Produto vencido', items: [{ productId: petisco.id, quantity: 5 }] });
    expect(out.statusCode).toBe(201);
    const [movement] = await movementsOf(shopA.owner, petisco.id);
    expect(movement).toMatchObject({ type: 'LOSS', quantity: -5, balanceBefore: 6, balanceAfter: 1, reason: 'Perda — Produto vencido' });
    expect((await productOf(shopA.owner, petisco.id)).lowStock).toBe(true);
  });

  it('devolucao de cliente volta ao estoque como DEVOLUCAO', async () => {
    const petisco = (await lookup(staffA, '7891000100103')).json<{ product: Product }>().product;
    const response = await entry(staffA, { type: 'RETURN', items: [{ productId: petisco.id, quantity: 1 }] });
    expect(response.statusCode).toBe(201);
    const [movement] = await movementsOf(shopA.owner, petisco.id);
    expect(movement).toMatchObject({ type: 'RETURN', quantity: 1, balanceAfter: 2, reason: 'Devolução de cliente' });
  });

  it('outro pet shop nao lanca estoque em produto do A', async () => {
    const special = (await lookup(shopA.owner, EAN)).json<{ product: Product }>().product;
    const response = await entry(shopB.owner, { type: 'IN', items: [{ productId: special.id, quantity: 5 }] });
    expect(response.statusCode).toBe(404);
    expect((await productOf(shopA.owner, special.id)).stockQuantity).toBe(11);
    const movements = await authed(server, shopB.owner, { method: 'GET', url: `/api/inventory/movements?productId=${special.id}` });
    expect(movements.json<{ data: unknown[] }>().data).toHaveLength(0);
  });
});

describe('estoque baixo, vendas e categorias', () => {
  it('estoque baixo aparece no resumo e no filtro', async () => {
    const summary = (await authed(server, shopA.owner, { method: 'GET', url: '/api/inventory/summary' })).json<{ lowStockProducts: number }>();
    expect(summary.lowStockProducts).toBe(1);
    const low = await authed(server, shopA.owner, { method: 'GET', url: '/api/products?lowStock=true' });
    expect(low.json<{ data: Product[] }>().data.map((product) => product.name)).toEqual(['Petisco Regional 65g']);
  });

  it('venda baixa o estoque e o cancelamento devolve (origem: vendas)', async () => {
    const special = (await lookup(shopA.owner, EAN)).json<{ product: Product }>().product;
    const sale = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ productId: special.id, quantity: 2 }], payment: { method: 'PIX', paid: true } },
    });
    expect(sale.statusCode).toBe(201);
    expect((await productOf(shopA.owner, special.id)).stockQuantity).toBe(9);
    const saleId = sale.json<{ id: string }>().id;
    const cancel = await authed(server, shopA.owner, {
      method: 'POST',
      url: `/api/sales/${saleId}/cancel`,
      payload: { reason: 'Cliente desistiu' },
    });
    expect(cancel.statusCode).toBe(200);
    expect((await productOf(shopA.owner, special.id)).stockQuantity).toBe(11);
    const [cancellation, saleMove] = await movementsOf(shopA.owner, special.id);
    expect(saleMove).toMatchObject({ type: 'SALE', source: 'SALE', barcode: EAN, quantity: -2 });
    expect(cancellation).toMatchObject({ type: 'SALE_CANCELLATION', source: 'SALE', quantity: 2 });
  });

  it('venda nunca deixa estoque negativo', async () => {
    const petisco = (await lookup(shopA.owner, '7891000100103')).json<{ product: Product }>().product;
    const sale = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/sales',
      payload: { items: [{ productId: petisco.id, quantity: 50 }], payment: { method: 'CASH', paid: true } },
    });
    expect(sale.statusCode).toBe(422);
    expect((await productOf(shopA.owner, petisco.id)).stockQuantity).toBe(2);
  });

  it('categorias agregam os produtos e podem ser renomeadas em massa', async () => {
    const list = (await authed(server, shopA.owner, { method: 'GET', url: '/api/inventory/categories' })).json<
      { name: string; products: number; lowStock: number }[]
    >();
    expect(list).toEqual([
      { name: 'Petiscos', products: 1, lowStock: 1 },
      { name: 'Ração', products: 1, lowStock: 0 },
    ]);
    const rename = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: '/api/inventory/categories',
      payload: { from: 'Petiscos', to: 'Petiscos e snacks' },
    });
    expect(rename.json()).toEqual({ updated: 1 });
    const staff = await authed(server, staffA, {
      method: 'PATCH',
      url: '/api/inventory/categories',
      payload: { from: 'Ração', to: 'Rações' },
    });
    expect(staff.statusCode).toBe(403);
    // B nao enxerga categorias do A.
    const inB = (await authed(server, shopB.owner, { method: 'GET', url: '/api/inventory/categories' })).json<{ name: string }[]>();
    expect(inB.map((category) => category.name)).not.toContain('Petiscos e snacks');
  });
});
