import {
  cancelSaleInputSchema,
  createProductInputSchema,
  createSaleInputSchema,
  createStockMovementInputSchema,
  idParamSchema,
  listProductsQuerySchema,
  listSalesQuerySchema,
  listStockMovementsQuerySchema,
  Permission,
  receiveSaleInputSchema,
  salesSummaryQuerySchema,
  updateProductInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createManualMovement,
  createProduct,
  getInventorySummary,
  getProduct,
  listProducts,
  listStockMovements,
  updateProduct,
} from '../../modules/inventory/inventory.service.js';
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
