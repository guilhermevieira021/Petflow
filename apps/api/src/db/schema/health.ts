import type { BookingRequestStatus, PetHealthType, PetSpecies } from '@petflow/contracts';
import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { customers, pets } from './customers.js';
import { services } from './services.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/** Historico clinico do pet (migration 0009). */
export const petHealthRecords = pgTable('pet_health_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  petId: uuid('pet_id')
    .notNull()
    .references(() => pets.id, { onDelete: 'restrict' }),
  type: text('type').$type<PetHealthType>().notNull(),
  title: text('title').notNull(),
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  nextDueOn: date('next_due_on', { mode: 'string' }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type PetHealthRecordRow = typeof petHealthRecords.$inferSelect;

/** Solicitacoes do link publico de agendamento (migration 0010). */
export const bookingRequests = pgTable('booking_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'restrict' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  petName: text('pet_name').notNull(),
  petSpecies: text('pet_species').$type<PetSpecies>().notNull(),
  notes: text('notes'),
  status: text('status').$type<BookingRequestStatus>().notNull().default('PENDING'),
  appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  petId: uuid('pet_id').references(() => pets.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BookingRequestRow = typeof bookingRequests.$inferSelect;
