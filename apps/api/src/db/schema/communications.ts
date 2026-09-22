import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { customers, pets } from './customers.js';
import { tenants } from './tenants.js';

export const MessageType = {
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION: 'APPOINTMENT_CONFIRMATION',
  POST_SERVICE_FOLLOWUP: 'POST_SERVICE_FOLLOWUP',
  RETURN_INVITE: 'RETURN_INVITE',
  WINBACK: 'WINBACK',
  MANUAL: 'MANUAL',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MessageChannel = {
  WHATSAPP: 'WHATSAPP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
} as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

export const MessageStatus = {
  /** Mensagem montada mas ainda nao entregue a nenhum provider. */
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  /** Operador abriu o link wa.me manualmente -- nao ha confirmacao de entrega. */
  OPENED_EXTERNALLY: 'OPENED_EXTERNALLY',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  petId: uuid('pet_id').references(() => pets.id, { onDelete: 'set null' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  type: text('type').$type<MessageType>().notNull(),
  channel: text('channel').$type<MessageChannel>().notNull().default('WHATSAPP'),
  content: text('content').notNull(),
  status: text('status').$type<MessageStatus>().notNull().default('DRAFT'),
  /** Identificador devolvido pelo provider, quando houver. */
  providerMessageId: text('provider_message_id'),
  failureReason: text('failure_reason'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MessageRow = typeof messages.$inferSelect;

export const CampaignType = {
  WINBACK: 'WINBACK',
  SEASONAL: 'SEASONAL',
  BIRTHDAY: 'BIRTHDAY',
  CUSTOM: 'CUSTOM',
} as const;
export type CampaignType = (typeof CampaignType)[keyof typeof CampaignType];

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').$type<CampaignType>().notNull(),
  status: text('status').$type<CampaignStatus>().notNull().default('DRAFT'),
  /** Template com placeholders: {{cliente}}, {{pet}}, {{data}}. */
  messageTemplate: text('message_template').notNull(),
  /** Criterios de segmentacao (ex.: { inactiveDays: 45 }). */
  filters: jsonb('filters').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignRow = typeof campaigns.$inferSelect;

export const ReminderType = {
  APPOINTMENT: 'APPOINTMENT',
  FOLLOWUP: 'FOLLOWUP',
  RETURN: 'RETURN',
} as const;
export type ReminderType = (typeof ReminderType)[keyof typeof ReminderType];

export const ReminderStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  petId: uuid('pet_id').references(() => pets.id, { onDelete: 'set null' }),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  type: text('type').$type<ReminderType>().notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  status: text('status').$type<ReminderStatus>().notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReminderRow = typeof reminders.$inferSelect;
