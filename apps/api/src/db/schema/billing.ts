import type { FeatureKey, PlanCode, PlanLimits, SubscriptionStatus } from '@petflow/contracts';
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * Catalogo de planos. NAO e por tenant -- e compartilhado por toda a
 * plataforma, como uma tabela de precos. Seedado pela propria migration
 * (0003_billing.sql), entao existe em todo ambiente, inclusive producao,
 * sem depender do script de seed de desenvolvimento.
 */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').$type<PlanCode>().notNull(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  currency: text('currency').notNull().default('BRL'),
  billingPeriod: text('billing_period').$type<'MONTHLY' | null>(),
  trialHours: integer('trial_hours'),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: jsonb('features').$type<FeatureKey[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlanRow = typeof plans.$inferSelect;

/**
 * Uma assinatura por tenant. Criada atomicamente no cadastro (junto do tenant
 * e do primeiro usuario, dentro da mesma transacao `withSystem`), sempre
 * comecando em TRIALING.
 */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'restrict' }),
  status: text('status').$type<SubscriptionStatus>().notNull().default('TRIALING'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  /** Nome do BillingProvider que gerencia esta assinatura (ex.: "stripe"). Null enquanto nenhum provider real esta configurado. */
  provider: text('provider'),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
