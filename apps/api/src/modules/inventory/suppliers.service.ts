import {
  AuditAction,
  AuditEntity,
  ErrorCode,
  type CreateSupplierInput,
  type ListSuppliersQuery,
  type SupplierDto,
  type UpdateSupplierInput,
} from '@petflow/contracts';
import { and, asc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { suppliers } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';

/** Fornecedores: sempre do proprio pet shop (RLS + FK composta no produto). */

const productCountSql = sql<string>`(
  SELECT count(*) FROM products p
  WHERE p.supplier_id = suppliers.id AND p.tenant_id = suppliers.tenant_id AND p.deleted_at IS NULL
)`;

function toSupplierDto(row: typeof suppliers.$inferSelect, productCount: string | number): SupplierDto {
  return {
    id: row.id,
    name: row.name,
    document: row.document,
    phone: row.phone,
    email: row.email,
    contactName: row.contactName,
    notes: row.notes,
    active: row.active,
    productCount: toCount(productCount),
    createdAt: toIsoRequired(row.createdAt),
  };
}

export async function listSuppliers(tx: Transaction, context: TenantContext, query: ListSuppliersQuery): Promise<SupplierDto[]> {
  const filters: SQL[] = [eq(suppliers.tenantId, context.tenantId)];
  if (!query.includeInactive) filters.push(eq(suppliers.active, true));
  if (query.search) {
    const term = `%${query.search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    filters.push(or(ilike(suppliers.name, term), ilike(suppliers.contactName, term), eq(suppliers.document, query.search.replace(/\D/g, '')))!);
  }
  const rows = await tx
    .select({ supplier: suppliers, productCount: productCountSql })
    .from(suppliers)
    .where(and(...filters))
    .orderBy(asc(sql`lower(${suppliers.name})`))
    .limit(500);
  return rows.map((row) => toSupplierDto(row.supplier, row.productCount));
}

async function findSupplier(tx: Transaction, context: TenantContext, supplierId: string) {
  const [row] = await tx
    .select({ supplier: suppliers, productCount: productCountSql })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Fornecedor');
  return row;
}

async function assertNameAvailable(tx: Transaction, context: TenantContext, name: string, excludingId?: string): Promise<void> {
  const [existing] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.tenantId, context.tenantId),
        sql`lower(btrim(${suppliers.name})) = lower(btrim(${name}))`,
        ...(excludingId ? [ne(suppliers.id, excludingId)] : []),
      ),
    )
    .limit(1);
  if (existing) throw new ConflictError('Já existe um fornecedor com este nome.', ErrorCode.CONFLICT);
}

/** Fornecedor associavel a um produto: do proprio tenant e ativo. */
export async function assertUsableSupplier(tx: Transaction, context: TenantContext, supplierId: string | null | undefined): Promise<void> {
  if (!supplierId) return;
  const { supplier } = await findSupplier(tx, context, supplierId);
  if (!supplier.active) throw new BusinessRuleError('Este fornecedor esta desativado. Reative-o ou escolha outro.');
}

export async function createSupplier(tx: Transaction, context: TenantContext, input: CreateSupplierInput): Promise<SupplierDto> {
  await assertActiveAccess(tx, context);
  await assertNameAvailable(tx, context, input.name);
  const [row] = await tx
    .insert(suppliers)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      document: input.document ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      contactName: input.contactName ?? null,
      notes: input.notes ?? null,
      createdBy: context.userId,
    })
    .returning();
  if (!row) throw new Error('Falha ao cadastrar fornecedor.');
  await recordAudit(tx, context, {
    action: AuditAction.SUPPLIER_CREATED,
    entity: AuditEntity.SUPPLIER,
    entityId: row.id,
    metadata: { name: input.name },
  });
  return toSupplierDto(row, 0);
}

export async function updateSupplier(
  tx: Transaction,
  context: TenantContext,
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<SupplierDto> {
  await assertActiveAccess(tx, context);
  await findSupplier(tx, context, supplierId);
  if (input.name !== undefined) await assertNameAvailable(tx, context, input.name, supplierId);

  const patch: Partial<typeof suppliers.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.document !== undefined) patch.document = input.document;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.contactName !== undefined) patch.contactName = input.contactName;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.active !== undefined) patch.active = input.active;

  await tx.update(suppliers).set(patch).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, context.tenantId)));
  await recordAudit(tx, context, {
    action: AuditAction.SUPPLIER_UPDATED,
    entity: AuditEntity.SUPPLIER,
    entityId: supplierId,
    metadata: { fields: Object.keys(patch) },
  });
  const updated = await findSupplier(tx, context, supplierId);
  return toSupplierDto(updated.supplier, updated.productCount);
}
