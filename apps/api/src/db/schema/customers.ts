import type { PetSex, PetSpecies } from '@petflow/contracts';
import { boolean, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Sempre armazenado somente com digitos (normalizado na validacao). */
  phone: text('phone').notNull(),
  whatsapp: text('whatsapp'),
  email: text('email'),
  cpf: text('cpf'),
  birthDate: date('birth_date'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;

export const pets = pgTable('pets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  species: text('species').$type<PetSpecies>().notNull(),
  breed: text('breed'),
  sex: text('sex').$type<PetSex>().notNull().default('UNKNOWN'),
  birthDate: date('birth_date'),
  weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
  color: text('color'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type PetRow = typeof pets.$inferSelect;
export type NewPetRow = typeof pets.$inferInsert;
