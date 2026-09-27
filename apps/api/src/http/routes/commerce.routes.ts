import {
  cancelSaleInputSchema,
  createBrandInputSchema,
  createSupplierInputSchema,
  createProductInputSchema,
  createSaleInputSchema,
  createStockMovementInputSchema,
  hasPermission,
  idParamSchema,
  listBrandsQuerySchema,
  listSuppliersQuerySchema,
  listProductsQuerySchema,
  listSalesQuerySchema,
  listStockMovementsQuerySchema,
  Permission,
  productLookupQuerySchema,
  receiveSaleInputSchema,
  renameCategoryInputSchema,
  salesSummaryQuerySchema,
  stockEntryInputSchema,
  updateBrandInputSchema,
  updateSupplierInputSchema,
  updateProductInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../../core/errors.js';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createManualMovement,
  createProduct,
  getInventoryInsights,
  getInventorySummary,
  getProduct,
  listProductCategories,
  listProducts,
  listStockMovements,
  lookupProductByCode,
  recordStockEntry,
  renameProductCategory,
  updateProduct,
} from '../../modules/inventory/inventory.service.js';
import { createBrand, listBrands, updateBrand } from '../../modules/inventory/brands.service.js';
import { createSupplier, listSuppliers, updateSupplier } from '../../modules/inventory/suppliers.service.js';
import {
  cancelSale,
  createSale,
  getSale,
  getSalesSummary,
  listSales,
  receiveSale,
} from '../../modules/sales/sales.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/** /api/products e /api/inventory -- catalogo e estoque do pet shop. */
export async function productsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listProductsQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listProducts(tx, auth.context, query)));
  });

  // Leitor de codigo de barras (teclado HID) ou digitacao: busca so no tenant.
  app.get('/lookup', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { code } = validate(productLookupQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => lookupProductByCode(tx, auth.context, code)));
  });

  app.get('/:id', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getProduct(tx, auth.context, id)));
  });

  app.post('/', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createProductInputSchema, request.body);
    const product = await withTenant(auth.context.tenantId, (tx) => createProduct(tx, auth.context, input));
    return reply.status(201).send(product);
  });

  app.patch('/:id', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(updateProductInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => updateProduct(tx, auth.context, id, input)));
  });

  app.post('/:id/movements', { preHandler: requirePermission(Permission.STOCK_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(createStockMovementInputSchema, request.body);
    const product = await withTenant(auth.context.tenantId, (tx) => createManualMovement(tx, auth.context, id, input));
    return reply.status(201).send(product);
  });
}

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Lancamento em lote. Receber mercadoria (IN) e devolucao de cliente
   * (RETURN) sao tarefas de balcao (STOCK_RECEIVE, inclui STAFF); saida (OUT)
   * tira mercadoria do estoque e exige STOCK_WRITE.
   */
  app.post('/entries', { preHandler: requirePermission(Permission.STOCK_RECEIVE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(stockEntryInputSchema, request.body);
    if (input.type === 'OUT' && !hasPermission(auth.user.role, Permission.STOCK_WRITE)) {
      throw new ForbiddenError();
    }
    const result = await withTenant(auth.context.tenantId, (tx) => recordStockEntry(tx, auth.context, input));
    return reply.status(201).send(result);
  });

  app.get('/insights', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getInventoryInsights(tx, auth.context)));
  });

  app.get('/categories', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listProductCategories(tx, auth.context)));
  });

  app.patch('/categories', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(renameCategoryInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => renameProductCategory(tx, auth.context, input)));
  });

  app.get('/summary', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getInventorySummary(tx, auth.context)));
  });

  app.get('/movements', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listStockMovementsQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listStockMovements(tx, auth.context, query)));
  });
}

/** /api/sales -- vendas do pet shop aos proprios clientes (FLUXO 1). */
export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.SALES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listSalesQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listSales(tx, auth.context, query)));
  });

  app.get('/summary', { preHandler: requirePermission(Permission.SALES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(salesSummaryQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getSalesSummary(tx, auth.context, query)));
  });

  app.get('/:id', { preHandler: requirePermission(Permission.SALES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getSale(tx, auth.context, id)));
  });

  app.post('/', { preHandler: requirePermission(Permission.SALES_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createSaleInputSchema, request.body);
    const sale = await withTenant(auth.context.tenantId, (tx) => createSale(tx, auth.context, input));
    return reply.status(201).send(sale);
  });

  app.post('/:id/receive', { preHandler: requirePermission(Permission.SALES_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(receiveSaleInputSchema, request.body ?? {});
    return reply.send(await withTenant(auth.context.tenantId, (tx) => receiveSale(tx, auth.context, id, input)));
  });

  app.post('/:id/cancel', { preHandler: requirePermission(Permission.SALES_CANCEL) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(cancelSaleInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => cancelSale(tx, auth.context, id, input)));
  });
}

/** /api/brands -- catalogo de referencia + marcas proprias do pet shop. */
export async function brandsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listBrandsQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listBrands(tx, auth.context, query)));
  });

  app.post('/', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createBrandInputSchema, request.body);
    const brand = await withTenant(auth.context.tenantId, (tx) => createBrand(tx, auth.context, input));
    return reply.status(201).send(brand);
  });

  app.patch('/:id', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(updateBrandInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => updateBrand(tx, auth.context, id, input)));
  });
}

/** /api/suppliers -- fornecedores do pet shop. */
export async function suppliersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listSuppliersQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listSuppliers(tx, auth.context, query)));
  });

  app.post('/', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createSupplierInputSchema, request.body);
    const supplier = await withTenant(auth.context.tenantId, (tx) => createSupplier(tx, auth.context, input));
    return reply.status(201).send(supplier);
  });

  app.patch('/:id', { preHandler: requirePermission(Permission.PRODUCTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(updateSupplierInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => updateSupplier(tx, auth.context, id, input)));
  });
}
