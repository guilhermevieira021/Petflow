import {
  AuditAction,
  AuditEntity,
  buildPagination,
  ErrorCode,
  marginOf,
  normalizeScannedCode,
  type CreateProductInput,
  type CreateStockMovementInput,
  type InventoryInsightsDto,
  type InventorySummaryDto,
  type InventoryTopProductDto,
  type ListProductsQuery,
  type ListStockMovementsQuery,
  type Paginated,
  type ProductCategoryDto,
  type ProductDto,
  type ProductLookupDto,
  type RenameCategoryInput,
  type StockEntryInput,
  type StockEntryResultDto,
  type StockMovementDto,
  type StockMovementSource,
  type StockExitReason,
  type StockMovementType,
  type UpdateProductInput,
} from '@petflow/contracts';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired, toMoneyLiteral, toNullableNumber, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { brands, products, saleItems, sales, stockMovements, suppliers, users } from '../../db/schema/index.js';
import { getProductCatalogProvider } from '../../integrations/catalog/product-catalog.provider.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';
import { assertUsableSupplier } from './suppliers.service.js';

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

export function toProductDto(
  row: typeof products.$inferSelect,
  brandName: string | null = null,
  supplierName: string | null = null,
): ProductDto {
  const stock = toNumber(row.stockQuantity);
  const min = toNumber(row.minStock);
  const salePrice = toNumber(row.salePrice);
  const costPrice = toNullableNumber(row.costPrice);
  const margin = marginOf(salePrice, costPrice);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    brandId: row.brandId,
    brandName: row.brandId ? brandName : null,
    supplierId: row.supplierId,
    supplierName: row.supplierId ? supplierName : null,
    description: row.description,
    category: row.category,
    unit: row.unit,
    salePrice,
    costPrice,
    margin: margin === null ? null : Math.round(margin * 10_000) / 10_000,
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
    filters.push(
      or(
        ilike(products.name, term),
        ilike(products.sku, term),
        eq(products.barcode, normalizeScannedCode(query.search)),
        ilike(brands.name, term),
      )!,
    );
  }
  if (query.category) filters.push(eq(products.category, query.category));
  if (query.brandId) filters.push(eq(products.brandId, query.brandId));
  if (query.supplierId) filters.push(eq(products.supplierId, query.supplierId));
  if (query.active !== undefined) filters.push(eq(products.active, query.active));
  if (query.lowStock) filters.push(lowStockCondition, eq(products.active, true));
  const where = and(...filters);

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where);

  const orderColumn =
    query.sort === 'stockQuantity' ? products.stockQuantity : query.sort === 'createdAt' ? products.createdAt : sql`lower(${products.name})`;
  const orderFn = query.order === 'desc' ? desc : asc;

  const rows = await tx
    .select({ product: products, brandName: brands.name, supplierName: suppliers.name })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(where)
    .orderBy(orderFn(orderColumn), asc(products.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => toProductDto(row.product, row.brandName, row.supplierName)),
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

async function brandNameOf(tx: Transaction, brandId: string | null): Promise<string | null> {
  if (!brandId) return null;
  // RLS de brands: so enxerga referencia + marcas do proprio tenant.
  const [row] = await tx.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  return row?.name ?? null;
}

async function supplierNameOf(tx: Transaction, context: TenantContext, supplierId: string | null): Promise<string | null> {
  if (!supplierId) return null;
  const [row] = await tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, context.tenantId)))
    .limit(1);
  return row?.name ?? null;
}

export async function getProduct(tx: Transaction, context: TenantContext, productId: string): Promise<ProductDto> {
  const row = await findProduct(tx, context, productId);
  return toProductDto(row, await brandNameOf(tx, row.brandId), await supplierNameOf(tx, context, row.supplierId));
}

/**
 * Marca associavel: de referencia (tenant_id NULL) ou do proprio pet shop, e
 * ativa. Marca de outro tenant responde "nao encontrada" (nao vaza que existe).
 * A trigger products_brand_same_tenant garante o mesmo no banco.
 */
async function assertUsableBrand(tx: Transaction, context: TenantContext, brandId: string | null | undefined): Promise<void> {
  if (!brandId) return;
  const [row] = await tx
    .select({ id: brands.id, active: brands.active })
    .from(brands)
    .where(and(eq(brands.id, brandId), or(isNull(brands.tenantId), eq(brands.tenantId, context.tenantId))))
    .limit(1);
  if (!row) throw new NotFoundError('Marca');
  if (!row.active) throw new BusinessRuleError('Esta marca esta desativada. Reative-a ou escolha outra.');
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
    if (row) throw new ConflictError('Já existe um produto com este SKU.', ErrorCode.CONFLICT);
  }
  if (codes.barcode) {
    const [row] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(...notDeleted(context), eq(products.barcode, codes.barcode), ...exclude))
      .limit(1);
    if (row) throw new ConflictError('Já existe um produto com este código de barras.', ErrorCode.CONFLICT);
  }
}

export async function createProduct(
  tx: Transaction,
  context: TenantContext,
  input: CreateProductInput,
): Promise<ProductDto> {
  await assertActiveAccess(tx, context);
  await assertUniqueCodes(tx, context, input);
  await assertUsableBrand(tx, context, input.brandId);
  await assertUsableSupplier(tx, context, input.supplierId);

  if (!input.trackStock && input.initialStock > 0) {
    throw new BusinessRuleError('Saldo inicial só se aplica a produtos que controlam estoque.');
  }

  const [row] = await tx
    .insert(products)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      brandId: input.brandId ?? null,
      supplierId: input.supplierId ?? null,
      description: input.description,
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
    metadata: { name: input.name, sku: input.sku, barcode: input.barcode, entrySource: input.entrySource },
  });

  // Saldo inicial entra como movimentacao: o historico explica todo o saldo.
  // Produto bipado e desconhecido (entrySource BARCODE): cadastro + entrada
  // de mercadoria na MESMA transacao -- ou tudo acontece, ou nada.
  if (input.initialStock > 0) {
    const fromScanner = input.entrySource === 'BARCODE';
    await applyStockMovement(tx, context, {
      productId: row.id,
      type: 'IN',
      deltaMilli: toMilli(input.initialStock),
      unitCost: input.costPrice ?? null,
      reason: fromScanner ? 'Entrada de mercadoria (produto cadastrado pelo leitor)' : 'Saldo inicial',
      source: fromScanner ? 'BARCODE' : 'PRODUCT_CREATION',
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
  if (input.brandId !== undefined && input.brandId !== current.brandId) await assertUsableBrand(tx, context, input.brandId);
  if (input.supplierId !== undefined && input.supplierId !== current.supplierId) {
    await assertUsableSupplier(tx, context, input.supplierId);
  }

  if (input.trackStock === true && !current.trackStock && toMilli(current.stockQuantity) < 0) {
    throw new BusinessRuleError('Ajuste o saldo antes de voltar a controlar o estoque deste produto.');
  }

  const patch: Partial<typeof products.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.barcode !== undefined) patch.barcode = input.barcode;
  if (input.brandId !== undefined) patch.brandId = input.brandId;
  if (input.supplierId !== undefined) patch.supplierId = input.supplierId;
  if (input.description !== undefined) patch.description = input.description;
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
    /** Padrao: SALE para movimentos de venda, MANUAL para o resto. */
    source?: StockMovementSource;
    /** Codigo lido pelo leitor; na falta, o codigo cadastrado do produto. */
    scannedCode?: string | null;
  },
): Promise<void> {
  const product = await findProduct(tx, context, params.productId, true);

  if (!product.trackStock) {
    if (params.type === 'SALE' || params.type === 'SALE_CANCELLATION') return;
    throw new BusinessRuleError(`"${product.name}" não controla estoque. Ative o controle para movimentar o saldo.`);
  }
  if (params.deltaMilli === 0) {
    throw new BusinessRuleError('A movimentação não altera o saldo.');
  }

  const balanceMilli = toMilli(product.stockQuantity) + params.deltaMilli;
  if (balanceMilli < 0) {
    throw new BusinessRuleError(
      `Estoque insuficiente de "${product.name}": saldo atual ${fromMilli(toMilli(product.stockQuantity))}, necessário ${fromMilli(-params.deltaMilli)}.`,
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
    source: params.source ?? (params.type === 'SALE' || params.type === 'SALE_CANCELLATION' ? 'SALE' : 'MANUAL'),
    barcode: params.scannedCode || product.barcode,
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
    input.type === 'IN' || input.type === 'RETURN'
      ? quantityMilli
      : input.type === 'OUT' || input.type === 'LOSS' || input.type === 'DAMAGE'
        ? -quantityMilli
        : // ADJUSTMENT: a quantidade informada e o NOVO saldo contado.
          quantityMilli - toMilli(product.stockQuantity);

  if (input.type === 'ADJUSTMENT' && deltaMilli === 0) {
    throw new BusinessRuleError(`O saldo de "${product.name}" já é ${fromMilli(quantityMilli)}.`);
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
  if (query.source) filters.push(eq(stockMovements.source, query.source));
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
      barcode: row.movement.barcode,
      type: row.movement.type,
      source: row.movement.source,
      quantity: toNumber(row.movement.quantity),
      balanceBefore: fromMilli(toMilli(row.movement.balanceAfter) - toMilli(row.movement.quantity)),
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

// -----------------------------------------------------------------------------
// Leitor de codigo de barras
// -----------------------------------------------------------------------------

/**
 * Busca pelo codigo lido/digitado DENTRO do tenant: primeiro codigo de barras
 * exato, depois SKU (etiquetas internas). O mesmo EAN em outro pet shop e
 * outro registro e nunca e visto aqui. Nada e deduzido do codigo em si.
 */
export async function lookupProductByCode(tx: Transaction, context: TenantContext, rawCode: string): Promise<ProductLookupDto> {
  const code = normalizeScannedCode(rawCode);

  const byBarcode = await tx
    .select({ product: products, brandName: brands.name })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(...notDeleted(context), eq(products.barcode, code)))
    .limit(1);
  if (byBarcode[0]) {
    return { status: 'FOUND', code, matchedBy: 'BARCODE', product: await getProduct(tx, context, byBarcode[0].product.id) };
  }

  const bySku = await tx
    .select({ product: products, brandName: brands.name })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(...notDeleted(context), sql`lower(${products.sku}) = lower(${code})`))
    .limit(1);
  if (bySku[0]) {
    return { status: 'FOUND', code, matchedBy: 'SKU', product: await getProduct(tx, context, bySku[0].product.id) };
  }

  // Base global (futura). Hoje sempre null: o pet shop cadastra manualmente.
  const catalogSuggestion = await getProductCatalogProvider().lookup(code);
  return { status: 'NOT_FOUND', code, catalogSuggestion };
}

/** Saida: o motivo define o tipo registrado (Perda, Avaria, Ajuste) ou fica como Saida. */
function movementTypeForEntry(type: StockEntryInput['type'], exitReason?: StockExitReason): StockMovementType {
  if (type !== 'OUT') return type;
  if (exitReason === 'LOSS') return 'LOSS';
  if (exitReason === 'DAMAGE') return 'DAMAGE';
  if (exitReason === 'ADJUSTMENT') return 'ADJUSTMENT';
  return 'OUT';
}

function entryReason(type: StockEntryInput['type'], exitReason: StockExitReason | undefined, details: string | null): string | null {
  const base =
    type === 'IN'
      ? 'Entrada de mercadoria'
      : type === 'RETURN'
        ? 'Devolução de cliente'
        : exitReason === 'SALE'
          ? 'Venda registrada fora do caixa (não entra no Recebido)'
          : exitReason === 'LOSS'
            ? 'Perda'
            : exitReason === 'DAMAGE'
              ? 'Avaria'
              : exitReason === 'ADJUSTMENT'
                ? 'Ajuste'
                : null;
  if (base && details) return `${base} — ${details}`;
  return base ?? details;
}

/**
 * Lancamento em lote (entrada rapida por leitor, saida, devolucao). Tudo ou
 * nada: um item invalido (ex.: saida maior que o saldo) desfaz o lote inteiro.
 * Itens repetidos do mesmo produto sao somados; a ordem por id evita deadlock
 * entre dois lotes simultaneos com os mesmos produtos.
 */
export async function recordStockEntry(
  tx: Transaction,
  context: TenantContext,
  input: StockEntryInput,
): Promise<StockEntryResultDto> {
  await assertActiveAccess(tx, context);

  const merged = new Map<string, { quantityMilli: number; unitCost: number | null; scannedCode: string | null }>();
  for (const item of input.items) {
    const current = merged.get(item.productId);
    merged.set(item.productId, {
      quantityMilli: (current?.quantityMilli ?? 0) + toMilli(item.quantity),
      unitCost: item.unitCost ?? current?.unitCost ?? null,
      scannedCode: item.scannedCode || current?.scannedCode || null,
    });
  }

  const movementType = movementTypeForEntry(input.type, input.exitReason);
  const sign = input.type === 'OUT' ? -1 : 1;
  const reason = entryReason(input.type, input.exitReason, input.reason);
  const productIds = [...merged.keys()].sort();

  for (const productId of productIds) {
    const item = merged.get(productId)!;
    await applyStockMovement(tx, context, {
      productId,
      type: movementType,
      deltaMilli: sign * item.quantityMilli,
      unitCost: input.type === 'OUT' ? null : item.unitCost,
      reason,
      source: input.source,
      scannedCode: item.scannedCode,
    });
    // Entrada de compra com custo informado: vira o custo atual do produto
    // (so quando pedido -- nunca muda o cadastro por conta propria).
    if (input.type === 'IN' && input.updateCostPrice && item.unitCost != null) {
      await tx
        .update(products)
        .set({ costPrice: toMoneyLiteral(item.unitCost) })
        .where(and(eq(products.id, productId), eq(products.tenantId, context.tenantId)));
    }
  }

  await recordAudit(tx, context, {
    action: AuditAction.STOCK_ENTRY_RECORDED,
    entity: AuditEntity.PRODUCT,
    entityId: null,
    metadata: {
      type: movementType,
      exitReason: input.exitReason ?? null,
      updateCostPrice: input.updateCostPrice,
      source: input.source,
      items: productIds.map((productId) => ({ productId, quantity: fromMilli(merged.get(productId)!.quantityMilli) })),
    },
  });

  const updated = await Promise.all(productIds.map((productId) => getProduct(tx, context, productId)));
  return { movements: productIds.length, products: updated };
}

// -----------------------------------------------------------------------------
// Categorias (texto livre no produto; aqui so agregacao e renomeio em massa)
// -----------------------------------------------------------------------------

export async function listProductCategories(tx: Transaction, context: TenantContext): Promise<ProductCategoryDto[]> {
  const rows = await tx
    .select({
      name: products.category,
      products: sql<string>`count(*)`,
      lowStock: sql<string>`count(*) FILTER (WHERE ${products.active} AND ${lowStockCondition})`,
    })
    .from(products)
    .where(and(...notDeleted(context), sql`${products.category} IS NOT NULL`))
    .groupBy(products.category)
    .orderBy(sql`lower(${products.category})`);
  return rows.map((row) => ({ name: row.name ?? '', products: toCount(row.products), lowStock: toCount(row.lowStock) }));
}

export async function renameProductCategory(
  tx: Transaction,
  context: TenantContext,
  input: RenameCategoryInput,
): Promise<{ updated: number }> {
  await assertActiveAccess(tx, context);
  const updated = await tx
    .update(products)
    .set({ category: input.to })
    .where(and(...notDeleted(context), eq(products.category, input.from)))
    .returning({ id: products.id });
  if (updated.length === 0) throw new NotFoundError('Categoria');
  await recordAudit(tx, context, {
    action: AuditAction.PRODUCT_CATEGORY_RENAMED,
    entity: AuditEntity.PRODUCT,
    entityId: null,
    metadata: { from: input.from, to: input.to, products: updated.length },
  });
  return { updated: updated.length };
}

// -----------------------------------------------------------------------------
// Indicadores (dashboard): somente dados reais do tenant
// -----------------------------------------------------------------------------

const INSIGHTS_PERIOD_DAYS = 30;

export async function getInventoryInsights(tx: Transaction, context: TenantContext): Promise<InventoryInsightsDto> {
  const summary = await getInventorySummary(tx, context);
  const since = new Date(Date.now() - INSIGHTS_PERIOD_DAYS * 24 * 3_600_000);

  // Vendas NAO canceladas do periodo, por produto.
  const sold = await tx
    .select({
      productId: saleItems.productId,
      quantity: sql<string>`sum(${saleItems.quantity})`,
      revenue: sql<string>`sum(${saleItems.total})`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(saleItems.tenantId, context.tenantId),
        sql`${saleItems.productId} IS NOT NULL`,
        ne(sales.status, 'CANCELLED'),
        sql`${sales.soldAt} >= ${since}`,
      ),
    )
    .groupBy(saleItems.productId);

  const soldIds = sold.map((row) => row.productId).filter((id): id is string => !!id);
  const productRows = soldIds.length
    ? await tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, context.tenantId), inArray(products.id, soldIds)))
    : [];
  const byId = new Map(productRows.map((row) => [row.id, row]));

  const ranked: InventoryTopProductDto[] = sold
    .map((row) => {
      const product = row.productId ? byId.get(row.productId) : undefined;
      if (!product) return null;
      const quantitySold = toNumber(row.quantity);
      const stock = toNumber(product.stockQuantity);
      return {
        productId: product.id,
        name: product.name,
        unit: product.unit,
        quantitySold,
        revenue: Math.round(toNumber(row.revenue) * 100) / 100,
        stockQuantity: stock,
        turnover: product.trackStock && quantitySold + stock > 0 ? Math.round((quantitySold / (quantitySold + stock)) * 1000) / 1000 : null,
      };
    })
    .filter((row): row is InventoryTopProductDto => row !== null);

  const topSelling = [...ranked].sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue).slice(0, 5);
  const topTurnover = ranked
    .filter((row) => row.turnover !== null)
    .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0) || b.quantitySold - a.quantitySold)
    .slice(0, 5);

  const alertRows = await tx
    .select({ product: products, brandName: brands.name })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(...notDeleted(context), eq(products.active, true), lowStockCondition))
    .orderBy(asc(products.stockQuantity), asc(sql`lower(${products.name})`))
    .limit(20);
  const alerts = alertRows.map((row) => toProductDto(row.product, row.brandName));

  return {
    summary,
    periodDays: INSIGHTS_PERIOD_DAYS,
    topSelling,
    topTurnover,
    lowStock: alerts.filter((product) => product.stockQuantity > 0).slice(0, 5),
    outOfStock: alerts.filter((product) => product.stockQuantity <= 0).slice(0, 5),
  };
}
