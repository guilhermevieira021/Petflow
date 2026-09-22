import type { Address, TenantSettings } from '@petflow/contracts';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * TENANT = um pet shop. E a raiz do isolamento: toda tabela de negocio
 * referencia esta.
 *
 * Nota sobre enums: usamos `text` + CHECK constraint no SQL em vez de tipos
 * ENUM do Postgres. Enum nativo exige ALTER TYPE para cada novo valor, o que
 * trava migrations em producao; CHECK e trivial de evoluir e a tipagem forte
 * fica no TypeScript via `$type<>()`.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').notNull().default('#2F6BFF'),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  address: jsonb('address').$type<Address>(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  settings: jsonb('settings').$type<TenantSettings>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;
