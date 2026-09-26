import {
  AuditAction,
  AuditEntity,
  buildPagination,
  ErrorCode,
  type CreateProductInput,
  type CreateStockMovementInput,
  type InventorySummaryDto,
  type ListProductsQuery,
  type ListStockMovementsQuery,
  type Paginated,
  type ProductDto,
  type StockMovementDto,
  type StockMovementType,
  type UpdateProductInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired, toMoneyLiteral, toNullableNumber, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { products, sales, stockMovements, users } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';

/**
 * Produtos e estoque.
 *
 * Invariante central: `products.stock_quantity` so muda por `applyStockMovement`,
 * que trava a linha do produto (SELECT ... FOR UPDATE), grava a movimentacao
 * com o saldo resultante e atualiza o produto NA MESMA transacao. Duas vendas
 * simultaneas do ultimo item serializam no lock -- a segunda ve saldo zero.
 *
 * Aritmetica em milesimos inteiros: 0.1 + 0.2 nao pode virar 0.30000000004 kg.
 */

const toMilli = (value: string | number): number => Math.round(toNumber(value) * 1000);
const fromMilli = (milli: number): number => milli / 1000;
const milliLiteral = (milli: number): string => (milli / 1000).toFixed(3);

export function toProductDto(row: typeof products.$inferSelect): ProductDto {
  const stock = toNumber(row.stockQuantity);
  const min = toNumber(row.minStock);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    unit: row.unit,
    salePrice: toNumber(row.salePrice),
    costPrice: toNullableNumber(row.costPrice),
    stockQuantity: stock,
    minStock: min,
    trackStock: row.trackStock,
    lowStock: row.trackStock && row.active && toMilli(row.stockQuantity) <= toMilli(row.minStock),
    active: row.active,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

const notDeleted = (context: TenantContext): SQL[] => [eq(products.tenantId, context.tenantId), isNull(products.deletedAt)];

const lowStockCondition = sql`${products.trackStock} AND ${products.stockQuantity} <= ${products.minStock}`;

export async function listProducts(
  tx: Transaction,
  context: TenantContext,
  query: ListProductsQuery,
): Promise<Paginated<ProductDto>> {
  const filters = notDeleted(context);
  if (query.search) {
    const term = `%${query.search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    filters.push(or(ilike(products.name, term), ilike(products.sku, term), eq(products.barcode, query.search))!);
  }
  if (query.category) filters.push(eq(products.category, query.category));
  if (query.active !== undefined) filters.push(eq(products.active, query.active));
  if (query.lowStock) filters.push(lowStockCondition, eq(products.active, true));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(products).where(where);

  const orderColumn =
    query.sort === 'stockQuantity' ? products.stockQuantity : query.sort === 'createdAt' ? products.createdAt : sql`lower(${products.name})`;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await tx
    .select()
    .from(products)
    .where(where)
    .orderBy(orderFn(orderColumn), asc(products.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toProductDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

async function findProduct(tx: Transaction, context: TenantContext, productId: string, forUpdate = false) {
  const base = tx
    .select()
    .from(products)
    .where(and(eq(products.id, productId), ...notDeleted(context)))
    .limit(1);
  const [row] = forUpdate ? await base.for('update') : await base;
  if (!row) throw new NotFoundError('Produto');
  return row;
}

export async function getProduct(tx: Transaction, context: TenantContext, productId: string): Promise<ProductDto> {
  return toProductDto(await findProduct(tx, context, productId));
}

/** SKU e codigo de barras sao unicos por pet shop (indices parciais na 0007). */
async function assertUniqueCodes(
  tx: Transaction,
  context: TenantContext,
  codes: { sku?: string | null; barcode?: string | null },
  excludingId?: string,
): Promise<void> {
  const exclude = excludingId ? [ne(products.id, excludingId)] : [];
  if (codes.sku) {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(...notDeleted(context), sql`lower(${products.sku}) = lower(${codes.sku})`, ...exclude))
      .limit(1);
    if (row) throw new ConflictError('Ja existe um produto com este SKU.', ErrorCode.CONFLICT);
  }
  if (codes.barcode) {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(...notDeleted(context), eq(products.barcode, codes.barcode), ...exclude))
      .limit(1);
    if (row) throw new ConflictError('Ja existe um produto com este codigo de barras.', ErrorCode.CONFLICT);
  }
}

export async function createProduct(
  tx: Transaction,
  context: TenantContext,
  input: CreateProductInput,
): Promise<ProductDto> {
  await assertActiveAccess(tx, context);
  await assertUniqueCodes(tx, context, input);

  if (!input.trackStock && input.initialStock > 0) {
    throw new BusinessRuleError('Saldo inicial so se aplica a produtos que controlam estoque.');
  }

  const [row] = await tx
    .insert(products)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      category: input.category,
      unit: input.unit,
      salePrice: toMoneyLiteral(input.salePrice),
      costPrice: input.costPrice == null ? null : toMoneyLiteral(input.costPrice),
      minStock: milliLiteral(toMilli(input.minStock)),
      trackStock: input.trackStock,
      stockQuantity: '0',
    })
    .returning();
  if (!row) throw new Error('Falha ao criar produto.');

  await recordAudit(tx, context, {
    action: AuditAction.PRODUCT_CREATED,
    entity: AuditEntity.PRODUCT,
    entityId: row.id,
    metadata: { name: input.name, sku: input.sku },
  });

  // Saldo inicial entra como movimentacao: o historico explica todo o saldo.
  if (input.initialStock > 0) {
    await applyStockMovement(tx, context, {
      productId: row.id,
      type: 'IN',
      deltaMilli: toMilli(input.initialStock),
      unitCost: input.costPrice ?? null,
      reason: 'Saldo inicial',
    });
  }

  return getProduct(tx, context, row.id);
}

export async function updateProduct(
  tx: Transaction,
  context: TenantContext,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  await assertActiveAccess(tx, context);
  const current = await findProduct(tx, context, productId, true);
  await assertUniqueCodes(tx, context, { sku: input.sku, barcode: input.barcode }, productId);

  if (input.trackStock === true && !current.trackStock && toMilli(current.stockQuantity) < 0) {
    throw new BusinessRuleError('Ajuste o saldo antes de voltar a controlar o estoque deste produto.');
  }

  const patch: Partial<typeof products.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.barcode !== undefined) patch.barcode = input.barcode;
  if (input.category !== undefined) patch.category = input.category;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.salePrice !== undefined) patch.salePrice = toMoneyLiteral(input.salePrice);
  if (input.costPrice !== undefined) patch.costPrice = input.costPrice === null ? null : toMoneyLiteral(input.costPrice);
  if (input.minStock !== undefined) patch.minStock = milliLiteral(toMilli(input.minStock));
  if (input.trackStock !== undefined) patch.trackStock = input.trackStock;
  if (input.active !== undefined) patch.active = input.active;

  await tx.update(products).set(patch).where(and(eq(products.id, productId), eq(products.tenantId, context.tenantId)));

  await recordAudit(tx, context, {
    action: AuditAction.PRODUCT_UPDATED,
    entity: AuditEntity.PRODUCT,
    entityId: productId,
    metadata: { fields: Object.keys(patch) },
  });

  return getProduct(tx, context, productId);
}

/**
 * Unica porta que altera saldo. Usada pelas movimentacoes manuais e pelo
 * modulo de vendas. Para produto que NAO controla estoque, movimentacoes de
 * venda sao ignoradas (nao ha saldo a manter) e manuais sao recusadas.
 */
export async function applyStockMovement(
  tx: Transaction,
  context: TenantContext,
  params: {
    productId: string;
    type: StockMovementType;
    deltaMilli: number;
    unitCost?: number | null;
    reason?: string | null;
    saleId?: string | null;
  },
): Promise<void> {
  const product = await findProduct(tx, context, params.productId, true);

  if (!product.trackStock) {
    if (params.type === 'SALE' || params.type === 'SALE_CANCELLATION') return;
    throw new BusinessRuleError(`"${product.name}" nao controla estoque. Ative o controle para movimentar o saldo.`);
  }
  if (params.deltaMilli === 0) {
    throw new BusinessRuleError('A movimentacao nao altera o saldo.');
  }

  const balanceMilli = toMilli(product.stockQuantity) + params.deltaMilli;
  if (balanceMilli < 0) {
    throw new BusinessRuleError(
      `Estoque insuficiente de "${product.name}": saldo atual ${fromMilli(toMilli(product.stockQuantity))}, necessario ${fromMilli(-params.deltaMilli)}.`,
    );
  }

  await tx
    .update(products)
    .set({ stockQuantity: milliLiteral(balanceMilli) })
    .where(and(eq(products.id, product.id), eq(products.tenantId, context.tenantId)));

  await tx.insert(stockMovements).values({
    tenantId: context.tenantId,
    productId: product.id,
    type: params.type,
    quantity: milliLiteral(params.deltaMilli),
    balanceAfter: milliLiteral(balanceMilli),
    unitCost: params.unitCost == null ? null : toMoneyLiteral(params.unitCost),
    reason: params.reason ?? null,
    saleId: params.saleId ?? null,
    userId: context.userId,
  });
}

export async function createManualMovement(
  tx: Transaction,
  context: TenantContext,
  productId: string,
  input: CreateStockMovementInput,
): Promise<ProductDto> {
  await assertActiveAccess(tx, context);
  const product = await findProduct(tx, context, productId, true);
  const quantityMilli = toMilli(input.quantity);

  const deltaMilli =
    input.type === 'IN'
      ? quantityMilli
      : input.type === 'OUT'
        ? -quantityMilli
        : // ADJUSTMENT: a quantidade informada e o NOVO saldo contado.
          quantityMilli - toMilli(product.stockQuantity);

  if (input.type === 'ADJUSTMENT' && deltaMilli === 0) {
    throw new BusinessRuleError(`O saldo de "${product.name}" ja e ${fromMilli(quantityMilli)}.`);
  }

  await applyStockMovement(tx, context, {
    productId,
    type: input.type,
    deltaMilli,
    unitCost: input.unitCost ?? null,
    reason: input.reason,
  });

  await recordAudit(tx, context, {
    action: AuditAction.STOCK_MOVED,
    entity: AuditEntity.PRODUCT,
    entityId: productId,
    metadata: { type: input.type, delta: fromMilli(deltaMilli) },
  });

  return getProduct(tx, context, productId);
}

export async function listStockMovements(
  tx: Transaction,
  context: TenantContext,
  query: ListStockMovementsQuery,
): Promise<Paginated<StockMovementDto>> {
  const filters: SQL[] = [eq(stockMovements.tenantId, context.tenantId)];
  if (query.productId) filters.push(eq(stockMovements.productId, query.productId));
  if (query.type) filters.push(eq(stockMovements.type, query.type));
  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(stockMovements).where(where);

  const rows = await tx
    .select({
      movement: stockMovements,
      productName: products.name,
      saleNumber: sales.number,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(sales, eq(sales.id, stockMovements.saleId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(where)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => ({
      id: row.movement.id,
      productId: row.movement.productId,
      productName: row.productName,
      type: row.movement.type,
      quantity: toNumber(row.movement.quantity),
      balanceAfter: toNumber(row.movement.balanceAfter),
      unitCost: toNullableNumber(row.movement.unitCost),
      reason: row.movement.reason,
      saleId: row.movement.saleId,
      saleNumber: row.saleNumber,
      userName: row.userName,
      createdAt: toIsoRequired(row.movement.createdAt),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getInventorySummary(tx: Transaction, context: TenantContext): Promise<InventorySummaryDto> {
  const [row] = await tx
    .select({
      activeProducts: sql<string>`count(*) FILTER (WHERE ${products.active})`,
      lowStockProducts: sql<string>`count(*) FILTER (WHERE ${products.active} AND ${lowStockCondition})`,
      outOfStockProducts: sql<string>`count(*) FILTER (WHERE ${products.active} AND ${products.trackStock} AND ${products.stockQuantity} <= 0)`,
      stockCostValue: sql<string>`coalesce(sum(${products.stockQuantity} * ${products.costPrice}) FILTER (WHERE ${products.active} AND ${products.trackStock} AND ${products.costPrice} IS NOT NULL AND ${products.stockQuantity} > 0), 0)`,
      productsWithoutCost: sql<string>`count(*) FILTER (WHERE ${products.active} AND ${products.trackStock} AND ${products.costPrice} IS NULL)`,
    })
    .from(products)
    .where(and(...notDeleted(context)));

  return {
    activeProducts: toCount(row?.activeProducts),
    lowStockProducts: toCount(row?.lowStockProducts),
    outOfStockProducts: toCount(row?.outOfStockProducts),
    stockCostValue: Math.round(toNumber(row?.stockCostValue) * 100) / 100,
    productsWithoutCost: toCount(row?.productsWithoutCost),
  };
}
