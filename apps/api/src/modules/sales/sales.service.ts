import {
  AuditAction,
  AuditEntity,
  buildPagination,
  ErrorCode,
  type CancelSaleInput,
  type CreateSaleInput,
  type ListSalesQuery,
  type Paginated,
  type PaymentMethod,
  type ReceiveSaleInput,
  type SaleDetailDto,
  type SaleDto,
  type SalesSummaryDto,
  type SalesSummaryQuery,
} from '@petflow/contracts';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../core/errors.js';
import { toCount, toIso, toIsoRequired, toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import { acquireTransactionLock, type TenantContext } from '../../db/context.js';
import {
  appointments,
  customers,
  payments,
  pets,
  products,
  saleItems,
  sales,
  services,
  users,
} from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertActiveAccess } from '../billing/billing.service.js';
import { assertCustomerExists } from '../customers/customers.service.js';
import { applyStockMovement } from '../inventory/inventory.service.js';
import { toPaymentDto } from '../payments/payments.service.js';
import { assertPetBelongsToCustomer } from '../pets/pets.service.js';

/**
 * VENDAS DO PET SHOP (FLUXO 1).
 *
 * Registra o que o pet shop vendeu aos proprios clientes e o recebimento
 * correspondente em `payments`. E esse recebimento PAGO que alimenta o
 * "Recebido" do dashboard -- o dashboard nao le `sales` diretamente, entao
 * existe uma unica fonte para "dinheiro que entrou".
 *
 * Este modulo NAO importa nada de billing alem da barreira de acesso
 * (assertActiveAccess, que so LE a assinatura). Nenhuma venda altera plano,
 * assinatura, trial ou qualquer coisa do FLUXO 2 (Cakto).
 *
 * Aritmetica em centavos inteiros; quantidades em milesimos inteiros.
 */

const toCents = (value: string | number): number => Math.round(toNumber(value) * 100);
const centsLiteral = (cents: number): string => (cents / 100).toFixed(2);
const toMilli = (value: number): number => Math.round(value * 1000);

interface ResolvedItem {
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  totalCents: number;
  tracksStock: boolean;
}

async function resolveItems(tx: Transaction, context: TenantContext, input: CreateSaleInput): Promise<ResolvedItem[]> {
  const productIds = [...new Set(input.items.flatMap((item) => (item.productId ? [item.productId] : [])))];
  const serviceIds = [...new Set(input.items.flatMap((item) => (item.serviceId ? [item.serviceId] : [])))];

  const productRows = productIds.length
    ? await tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, context.tenantId), inArray(products.id, productIds), isNull(products.deletedAt)))
    : [];
  const serviceRows = serviceIds.length
    ? await tx
        .select()
        .from(services)
        .where(and(eq(services.tenantId, context.tenantId), inArray(services.id, serviceIds), isNull(services.deletedAt)))
    : [];

  const productMap = new Map(productRows.map((row) => [row.id, row]));
  const serviceMap = new Map(serviceRows.map((row) => [row.id, row]));

  return input.items.map((item) => {
    let description = item.description ?? null;
    let unitPriceCents: number;
    let tracksStock = false;

    if (item.productId) {
      const product = productMap.get(item.productId);
      if (!product) throw new NotFoundError('Produto');
      if (!product.active) throw new BusinessRuleError(`O produto "${product.name}" esta inativo.`);
      description = description || product.name;
      unitPriceCents = item.unitPrice !== undefined ? Math.round(item.unitPrice * 100) : toCents(product.salePrice);
      tracksStock = product.trackStock;
    } else if (item.serviceId) {
      const service = serviceMap.get(item.serviceId);
      if (!service) throw new NotFoundError('Servico');
      if (!service.active) throw new BusinessRuleError(`O servico "${service.name}" esta inativo.`);
      description = description || service.name;
      unitPriceCents = item.unitPrice !== undefined ? Math.round(item.unitPrice * 100) : toCents(service.price);
    } else {
      // Item avulso: o schema garante descricao e valor.
      unitPriceCents = Math.round((item.unitPrice ?? 0) * 100);
    }

    const quantityMilli = toMilli(item.quantity);
    return {
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      description: description ?? '',
      quantityMilli,
      unitPriceCents,
      totalCents: Math.round((quantityMilli * unitPriceCents) / 1000),
      tracksStock,
    };
  });
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

/** Forma de pagamento do recebimento mais recente da venda. */
const paymentMethodSubquery = sql<PaymentMethod | null>`(
  SELECT p.method FROM payments p
  WHERE p.sale_id = ${sales.id} AND p.tenant_id = ${sales.tenantId}
  ORDER BY p.created_at DESC LIMIT 1
)`;

const itemsCountSubquery = sql<string>`(
  SELECT count(*) FROM sale_items si WHERE si.sale_id = ${sales.id} AND si.tenant_id = ${sales.tenantId}
)`;

function saleSelect(tx: Transaction) {
  return tx
    .select({
      sale: sales,
      customerName: customers.name,
      petName: pets.name,
      createdByName: users.name,
      paymentMethod: paymentMethodSubquery,
      itemsCount: itemsCountSubquery,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(pets, eq(pets.id, sales.petId))
    .leftJoin(users, eq(users.id, sales.createdBy));
}

interface SaleSelectRow {
  sale: typeof sales.$inferSelect;
  customerName: string | null;
  petName: string | null;
  createdByName: string | null;
  paymentMethod: PaymentMethod | null;
  itemsCount: string | number;
}

function toSaleDto(row: SaleSelectRow): SaleDto {
  return {
    id: row.sale.id,
    tenantId: row.sale.tenantId,
    number: row.sale.number,
    customerId: row.sale.customerId,
    customerName: row.customerName,
    petId: row.sale.petId,
    petName: row.petName,
    appointmentId: row.sale.appointmentId,
    status: row.sale.status,
    subtotal: toNumber(row.sale.subtotal),
    discount: toNumber(row.sale.discount),
    total: toNumber(row.sale.total),
    paymentMethod: row.paymentMethod ?? null,
    soldAt: toIsoRequired(row.sale.soldAt),
    notes: row.sale.notes,
    createdByName: row.createdByName,
    cancelledAt: toIso(row.sale.cancelledAt),
    cancellationReason: row.sale.cancellationReason,
    createdAt: toIsoRequired(row.sale.createdAt),
    itemsCount: toCount(row.itemsCount),
  };
}

export async function listSales(tx: Transaction, context: TenantContext, query: ListSalesQuery): Promise<Paginated<SaleDto>> {
  const filters: SQL[] = [eq(sales.tenantId, context.tenantId)];
  if (query.status) filters.push(eq(sales.status, query.status));
  if (query.customerId) filters.push(eq(sales.customerId, query.customerId));
  if (query.from) filters.push(gte(sales.soldAt, new Date(query.from)));
  if (query.to) filters.push(lte(sales.soldAt, new Date(query.to)));
  if (query.search) {
    const digits = query.search.replace(/^#/, '');
    const term = `%${query.search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const conditions: SQL[] = [ilike(customers.name, term)];
    if (/^\d{1,9}$/.test(digits)) conditions.push(eq(sales.number, Number(digits)));
    filters.push(or(...conditions)!);
  }
  const where = and(...filters);

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(where);

  const orderFn = query.order === 'asc' ? asc : desc;
  const rows = await saleSelect(tx)
    .where(where)
    .orderBy(orderFn(sales.soldAt), orderFn(sales.number))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toSaleDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getSale(tx: Transaction, context: TenantContext, saleId: string): Promise<SaleDetailDto> {
  const [row] = await saleSelect(tx)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Venda');

  const items = await tx
    .select()
    .from(saleItems)
    .where(and(eq(saleItems.saleId, saleId), eq(saleItems.tenantId, context.tenantId)))
    .orderBy(asc(saleItems.createdAt), asc(saleItems.id));

  const paymentRows = await tx
    .select({ payment: payments, customerName: customers.name })
    .from(payments)
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(and(eq(payments.saleId, saleId), eq(payments.tenantId, context.tenantId)))
    .orderBy(asc(payments.createdAt));

  return {
    ...toSaleDto(row),
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      serviceId: item.serviceId,
      description: item.description,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      total: toNumber(item.total),
    })),
    payments: paymentRows.map((payment) => toPaymentDto(payment.payment, payment.customerName)),
  };
}

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

async function nextSaleNumber(tx: Transaction, context: TenantContext): Promise<number> {
  // Serializa a numeracao por pet shop: duas vendas simultaneas nao pegam o
  // mesmo numero (o indice unico seria a ultima barreira).
  await acquireTransactionLock(tx, `sales:number:${context.tenantId}`);
  const [row] = await tx
    .select({ value: sql<string | null>`max(${sales.number})` })
    .from(sales)
    .where(eq(sales.tenantId, context.tenantId));
  return toCount(row?.value ?? 0) + 1;
}

export async function createSale(tx: Transaction, context: TenantContext, input: CreateSaleInput): Promise<SaleDetailDto> {
  await assertActiveAccess(tx, context);

  const customerId = input.customerId ?? null;
  if (customerId) await assertCustomerExists(tx, context, customerId);
  if (input.petId && customerId) await assertPetBelongsToCustomer(tx, context, input.petId, customerId);
  if (input.appointmentId) {
    const [appointment] = await tx
      .select({ id: appointments.id, customerId: appointments.customerId })
      .from(appointments)
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, context.tenantId)))
      .limit(1);
    if (!appointment) throw new NotFoundError('Agendamento');
    if (customerId && appointment.customerId !== customerId) {
      throw new BusinessRuleError('O agendamento pertence a outro cliente.');
    }
  }

  const items = await resolveItems(tx, context, input);
  const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const discountCents = Math.round(input.discount * 100);
  if (discountCents > subtotalCents) {
    throw new BusinessRuleError('O desconto nao pode ser maior que o valor da venda.');
  }
  const totalCents = subtotalCents - discountCents;
  const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
  if (soldAt.getTime() > Date.now() + 5 * 60_000) {
    throw new BusinessRuleError('A data da venda nao pode estar no futuro.');
  }

  const number = await nextSaleNumber(tx, context);
  const [sale] = await tx
    .insert(sales)
    .values({
      tenantId: context.tenantId,
      number,
      customerId,
      petId: input.petId ?? null,
      appointmentId: input.appointmentId ?? null,
      status: 'OPEN',
      subtotal: centsLiteral(subtotalCents),
      discount: centsLiteral(discountCents),
      total: centsLiteral(totalCents),
      soldAt,
      notes: input.notes,
      createdBy: context.userId,
    })
    .returning();
  if (!sale) throw new Error('Falha ao registrar venda.');

  await tx.insert(saleItems).values(
    items.map((item) => ({
      tenantId: context.tenantId,
      saleId: sale.id,
      productId: item.productId,
      serviceId: item.serviceId,
      description: item.description,
      quantity: (item.quantityMilli / 1000).toFixed(3),
      unitPrice: centsLiteral(item.unitPriceCents),
      total: centsLiteral(item.totalCents),
    })),
  );

  // Baixa de estoque: agrupada por produto, para uma venda com o mesmo
  // produto em duas linhas gerar uma unica verificacao de saldo.
  const stockByProduct = new Map<string, number>();
  for (const item of items) {
    if (item.productId && item.tracksStock) {
      stockByProduct.set(item.productId, (stockByProduct.get(item.productId) ?? 0) + item.quantityMilli);
    }
  }
  for (const [productId, quantityMilli] of stockByProduct) {
    await applyStockMovement(tx, context, {
      productId,
      type: 'SALE',
      deltaMilli: -quantityMilli,
      reason: `Venda #${number}`,
      saleId: sale.id,
    });
  }

  // Recebimento. Venda com total zero (desconto integral) nao gera
  // pagamento: nao ha dinheiro entrando, e payments exige amount > 0.
  let status: 'OPEN' | 'PAID' = 'OPEN';
  if (totalCents === 0) {
    status = 'PAID';
  } else {
    await tx.insert(payments).values({
      tenantId: context.tenantId,
      customerId,
      saleId: sale.id,
      appointmentId: input.appointmentId ?? null,
      amount: centsLiteral(totalCents),
      method: input.payment.method,
      status: input.payment.paid ? 'PAID' : 'PENDING',
      paidAt: input.payment.paid ? soldAt : null,
    });
    if (input.payment.paid) status = 'PAID';
  }
  if (status === 'PAID') {
    await tx.update(sales).set({ status }).where(eq(sales.id, sale.id));
  }

  await recordAudit(tx, context, {
    action: AuditAction.SALE_CREATED,
    entity: AuditEntity.SALE,
    entityId: sale.id,
    metadata: { number, total: totalCents / 100, paid: status === 'PAID', method: input.payment.method },
  });

  return getSale(tx, context, sale.id);
}

async function lockSale(tx: Transaction, context: TenantContext, saleId: string) {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, context.tenantId)))
    .limit(1)
    .for('update');
  if (!sale) throw new NotFoundError('Venda');
  return sale;
}

/** Recebe uma venda "a receber": o pagamento pendente passa a PAGO agora. */
export async function receiveSale(
  tx: Transaction,
  context: TenantContext,
  saleId: string,
  input: ReceiveSaleInput,
): Promise<SaleDetailDto> {
  await assertActiveAccess(tx, context);
  const sale = await lockSale(tx, context, saleId);
  if (sale.status !== 'OPEN') {
    throw new ConflictError(
      sale.status === 'PAID' ? 'Esta venda ja foi recebida.' : 'Venda cancelada nao pode ser recebida.',
      ErrorCode.INVALID_STATUS_TRANSITION,
    );
  }

  const [pending] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.saleId, saleId), eq(payments.tenantId, context.tenantId), eq(payments.status, 'PENDING')))
    .limit(1);
  if (!pending) throw new BusinessRuleError('Nao ha recebimento pendente para esta venda.');

  const paidAt = new Date();
  await tx
    .update(payments)
    .set({ status: 'PAID', paidAt, ...(input.method ? { method: input.method } : {}) })
    .where(eq(payments.id, pending.id));
  await tx.update(sales).set({ status: 'PAID' }).where(eq(sales.id, saleId));

  await recordAudit(tx, context, {
    action: AuditAction.PAYMENT_STATUS_CHANGED,
    entity: AuditEntity.PAYMENT,
    entityId: pending.id,
    metadata: { from: 'PENDING', to: 'PAID', saleId },
  });

  return getSale(tx, context, saleId);
}

/**
 * Cancela a venda: devolve os produtos ao estoque e desfaz o recebimento --
 * pendente vira CANCELADO, pago vira ESTORNADO (sai do "Recebido", porque o
 * dinheiro foi devolvido). Nada e apagado: o historico continua auditavel.
 */
export async function cancelSale(
  tx: Transaction,
  context: TenantContext,
  saleId: string,
  input: CancelSaleInput,
): Promise<SaleDetailDto> {
  await assertActiveAccess(tx, context);
  const sale = await lockSale(tx, context, saleId);
  if (sale.status === 'CANCELLED') {
    throw new ConflictError('Esta venda ja esta cancelada.', ErrorCode.INVALID_STATUS_TRANSITION);
  }

  const items = await tx
    .select()
    .from(saleItems)
    .where(and(eq(saleItems.saleId, saleId), eq(saleItems.tenantId, context.tenantId)));

  const returnByProduct = new Map<string, number>();
  for (const item of items) {
    if (item.productId) {
      returnByProduct.set(item.productId, (returnByProduct.get(item.productId) ?? 0) + toMilli(toNumber(item.quantity)));
    }
  }
  for (const [productId, quantityMilli] of returnByProduct) {
    await applyStockMovement(tx, context, {
      productId,
      type: 'SALE_CANCELLATION',
      deltaMilli: quantityMilli,
      reason: `Cancelamento da venda #${sale.number}`,
      saleId,
    });
  }

  await tx
    .update(payments)
    .set({ status: 'CANCELLED' })
    .where(and(eq(payments.saleId, saleId), eq(payments.tenantId, context.tenantId), eq(payments.status, 'PENDING')));
  await tx
    .update(payments)
    .set({ status: 'REFUNDED' })
    .where(and(eq(payments.saleId, saleId), eq(payments.tenantId, context.tenantId), eq(payments.status, 'PAID')));

  await tx
    .update(sales)
    .set({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: input.reason })
    .where(eq(sales.id, saleId));

  await recordAudit(tx, context, {
    action: AuditAction.SALE_CANCELLED,
    entity: AuditEntity.SALE,
    entityId: saleId,
    metadata: { number: sale.number, reason: input.reason },
  });

  return getSale(tx, context, saleId);
}

export async function getSalesSummary(
  tx: Transaction,
  context: TenantContext,
  query: SalesSummaryQuery,
): Promise<SalesSummaryDto> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const window = and(eq(sales.tenantId, context.tenantId), gte(sales.soldAt, from), lte(sales.soldAt, to));

  const [totals] = await tx
    .select({
      totalSold: sql<string>`coalesce(sum(${sales.total}) FILTER (WHERE ${sales.status} <> 'CANCELLED'), 0)`,
      totalOpen: sql<string>`coalesce(sum(${sales.total}) FILTER (WHERE ${sales.status} = 'OPEN'), 0)`,
      salesCount: sql<string>`count(*) FILTER (WHERE ${sales.status} <> 'CANCELLED')`,
    })
    .from(sales)
    .where(window);

  const methodRows = await tx
    .select({ method: payments.method, amount: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .where(and(window, eq(payments.status, 'PAID')))
    .groupBy(payments.method);

  const totalSold = toNumber(totals?.totalSold);
  const salesCount = toCount(totals?.salesCount);
  const byMethod = methodRows
    .map((row) => ({ method: row.method, amount: toNumber(row.amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totalSold,
    totalReceived: Math.round(byMethod.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    totalOpen: toNumber(totals?.totalOpen),
    salesCount,
    averageTicket: salesCount > 0 ? Math.round((totalSold / salesCount) * 100) / 100 : null,
    byMethod,
  };
}

