import {
  AuditAction,
  AuditEntity,
  ErrorCode,
  type BrandDto,
  type CreateBrandInput,
  type ListBrandsQuery,
  type UpdateBrandInput,
} from '@petflow/contracts';
import { and, asc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { brands } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';

/**
 * Marcas: catalogo de referencia Petflow (tenant_id NULL, so leitura) +
 * marcas proprias de cada pet shop. O RLS de `brands` ja restringe a leitura
 * a essas duas origens e a escrita ao proprio tenant; os filtros explicitos
 * abaixo repetem a regra (defesa em profundidade, e mensagens melhores).
 */

const visibleTo = (context: TenantContext): SQL => or(isNull(brands.tenantId), eq(brands.tenantId, context.tenantId))!;

function productCountSql(context: TenantContext) {
  // Contagem so dos produtos DESTE pet shop.
  return sql<string>`(
    SELECT count(*) FROM products p
    WHERE p.brand_id = brands.id AND p.tenant_id = ${context.tenantId} AND p.deleted_at IS NULL
  )`;
}

function toBrandDto(row: typeof brands.$inferSelect, productCount: string | number): BrandDto {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment,
    isReference: row.tenantId === null,
    active: row.active,
    productCount: toCount(productCount),
  };
}

export async function listBrands(tx: Transaction, context: TenantContext, query: ListBrandsQuery): Promise<BrandDto[]> {
  const filters: SQL[] = [visibleTo(context)];
  if (query.origin === 'reference') filters.push(isNull(brands.tenantId));
  if (query.origin === 'own') filters.push(isNotNull(brands.tenantId));
  if (query.segment) filters.push(eq(brands.segment, query.segment));
  if (!query.includeInactive) filters.push(eq(brands.active, true));
  if (query.search) {
    filters.push(ilike(brands.name, `%${query.search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`));
  }

  const rows = await tx
    .select({ brand: brands, productCount: productCountSql(context) })
    .from(brands)
    .where(and(...filters))
    .orderBy(asc(sql`lower(${brands.name})`))
    .limit(500);
  return rows.map((row) => toBrandDto(row.brand, row.productCount));
}

async function findVisibleBrand(tx: Transaction, context: TenantContext, brandId: string) {
  const [row] = await tx
    .select({ brand: brands, productCount: productCountSql(context) })
    .from(brands)
    .where(and(eq(brands.id, brandId), visibleTo(context)))
    .limit(1);
  if (!row) throw new NotFoundError('Marca');
  return row;
}

/** Nome unico entre o catalogo de referencia e as marcas do proprio pet shop (sem diferenciar maiusculas). */
async function assertNameAvailable(tx: Transaction, context: TenantContext, name: string, excludingId?: string): Promise<void> {
  const [existing] = await tx
    .select({ id: brands.id, name: brands.name, tenantId: brands.tenantId })
    .from(brands)
    .where(
      and(
        visibleTo(context),
        sql`lower(btrim(${brands.name})) = lower(btrim(${name}))`,
        ...(excludingId ? [ne(brands.id, excludingId)] : []),
      ),
    )
    .limit(1);
  if (existing) {
    throw new ConflictError(
      existing.tenantId === null
        ? `A marca "${existing.name}" já existe no catálogo de referência. Use-a nos produtos.`
        : `Você já cadastrou a marca "${existing.name}".`,
      ErrorCode.CONFLICT,
    );
  }
}

export async function createBrand(tx: Transaction, context: TenantContext, input: CreateBrandInput): Promise<BrandDto> {
  await assertActiveAccess(tx, context);
  await assertNameAvailable(tx, context, input.name);

  const [row] = await tx
    .insert(brands)
    .values({ tenantId: context.tenantId, name: input.name, segment: input.segment, createdBy: context.userId })
    .returning();
  if (!row) throw new Error('Falha ao cadastrar marca.');

  await recordAudit(tx, context, {
    action: AuditAction.BRAND_CREATED,
    entity: AuditEntity.BRAND,
    entityId: row.id,
    metadata: { name: input.name },
  });
  return toBrandDto(row, 0);
}

export async function updateBrand(
  tx: Transaction,
  context: TenantContext,
  brandId: string,
  input: UpdateBrandInput,
): Promise<BrandDto> {
  await assertActiveAccess(tx, context);
  const { brand } = await findVisibleBrand(tx, context, brandId);
  if (brand.tenantId === null) {
    throw new BusinessRuleError('Marcas do catálogo de referência não podem ser alteradas. Cadastre uma marca própria.');
  }
  if (input.name !== undefined) await assertNameAvailable(tx, context, input.name, brandId);

  const patch: Partial<typeof brands.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.segment !== undefined) patch.segment = input.segment;
  if (input.active !== undefined) patch.active = input.active;

  await tx.update(brands).set(patch).where(and(eq(brands.id, brandId), eq(brands.tenantId, context.tenantId)));

  await recordAudit(tx, context, {
    action: AuditAction.BRAND_UPDATED,
    entity: AuditEntity.BRAND,
    entityId: brandId,
    metadata: { fields: Object.keys(patch) },
  });

  const updated = await findVisibleBrand(tx, context, brandId);
  return toBrandDto(updated.brand, updated.productCount);
}
