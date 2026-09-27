import type { BrandSegment, ProductUnit, SaleStatus, StockMovementSource, StockMovementType } from '@petflow/contracts';
import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { customers, pets } from './customers.js';
import { services } from './services.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * Vendas e estoque do pet shop (FLUXO 1). Espelha a migration 0007 -- as FKs
 * compostas com tenant_id vivem no SQL; aqui ficam as referencias simples
 * para o Drizzle entender os joins (ver ADR-003).
 */

/**
 * Marcas (0011). tenant_id NULL = catalogo de referencia Petflow (so leitura
 * para os pet shops); preenchido = marca cadastrada pelo pet shop.
 */
export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  segment: text('segment').$type<BrandSegment>().notNull().default('GENERAL'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BrandRow = typeof brands.$inferSelect;

/** Fornecedores do pet shop (0012). FK composta com tenant_id no SQL. */
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  document: text('document'),
  phone: text('phone'),
  email: text('email'),
  contactName: text('contact_name'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SupplierRow = typeof suppliers.$inferSelect;

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sku: text('sku'),
  barcode: text('barcode'),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'restrict' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  description: text('description'),
  category: text('category'),
  unit: text('unit').$type<ProductUnit>().notNull().default('UN'),
  salePrice: numeric('sale_price', { precision: 10, scale: 2 }).notNull(),
  costPrice: numeric('cost_price', { precision: 10, scale: 2 }),
  stockQuantity: numeric('stock_quantity', { precision: 12, scale: 3 }).notNull().default('0'),
  minStock: numeric('min_stock', { precision: 12, scale: 3 }).notNull().default('0'),
  trackStock: boolean('track_stock').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type ProductRow = typeof products.$inferSelect;

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
  petId: uuid('pet_id').references(() => pets.id, { onDelete: 'restrict' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'restrict' }),
  status: text('status').$type<SaleStatus>().notNull().default('OPEN'),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  discount: numeric('discount', { precision: 10, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SaleRow = typeof sales.$inferSelect;

export const saleItems = pgTable('sale_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  saleId: uuid('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SaleItemRow = typeof saleItems.$inferSelect;

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  type: text('type').$type<StockMovementType>().notNull(),
  source: text('source').$type<StockMovementSource>().notNull().default('MANUAL'),
  /** Codigo de barras congelado no momento da movimentacao. */
  barcode: text('barcode'),
  /** Variacao assinada do saldo. */
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  balanceAfter: numeric('balance_after', { precision: 12, scale: 3 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 10, scale: 2 }),
  reason: text('reason'),
  saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StockMovementRow = typeof stockMovements.$inferSelect;
