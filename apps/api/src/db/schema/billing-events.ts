import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const BillingEventStatus = {
  /** Recebido e guardado, ainda nao processado (ou nao pode ser -- tenant nao resolvido). */
  RECEIVED: 'RECEIVED',
  /** Aplicado com sucesso a uma subscription. */
  PROCESSED: 'PROCESSED',
  /** Evento reconhecido mas que nao exige nenhuma acao (ex.: tipo nao mapeado ainda). */
  IGNORED: 'IGNORED',
  /** Tentativa de processar falhou (erro inesperado, nao falta de mapeamento). */
  FAILED: 'FAILED',
} as const;
export type BillingEventStatus = (typeof BillingEventStatus)[keyof typeof BillingEventStatus];

/**
 * Log append-only de todo evento de webhook recebido de um provider de
 * pagamento, com a MESMA finalidade de `audit_logs` para acoes internas:
 * historico imutavel, mais idempotencia.
 *
 * `(provider, event_id)` e unico -- se a Cakto reentregar o mesmo evento (o
 * que provedores de pagamento fazem de proposito, para garantir entrega),
 * a segunda tentativa de INSERT falha e o evento simplesmente nao e
 * processado de novo. Nao ha necessidade de logica de deduplicacao em
 * memoria nem de checar "ja vi isso?" antes de inserir -- o proprio banco
 * garante.
 *
 * `payload` guarda o corpo bruto recebido. Alem de auditoria, isso permite
 * reprocessar eventos antigos se o mapeamento de tipos mudar (ex.: quando os
 * nomes reais dos eventos da Cakto forem confirmados).
 */
export const billingEvents = pgTable('billing_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  /** Nulo enquanto o evento nao puder ser associado a um tenant. */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  payload: jsonb('payload').notNull(),
  status: text('status').$type<BillingEventStatus>().notNull().default('RECEIVED'),
  errorMessage: text('error_message'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export type BillingEventRow = typeof billingEvents.$inferSelect;
export type NewBillingEventRow = typeof billingEvents.$inferInsert;
