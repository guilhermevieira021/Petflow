export * from './tenants.js';
export * from './users.js';
export * from './customers.js';
export * from './services.js';
export * from './appointments.js';
export * from './communications.js';
export * from './audit.js';
export * from './billing.js';
export * from './billing-events.js';
export * from './commerce.js';
export * from './health.js';

import { auditLogs } from './audit.js';
import { appointments, payments } from './appointments.js';
import { billingEvents } from './billing-events.js';
import { plans, subscriptions } from './billing.js';
import { campaigns, messages, messageTemplates, reminders } from './communications.js';
import { brands, products, saleItems, sales, stockMovements, suppliers } from './commerce.js';
import { bookingRequests, petHealthRecords } from './health.js';
import { customers, pets } from './customers.js';
import { services } from './services.js';
import { tenants } from './tenants.js';
import { passwordResetTokens, sessions, users } from './users.js';

/** Schema completo, passado ao Drizzle e usado pelo teste anti-drift. */
export const schema = {
  tenants,
  users,
  sessions,
  passwordResetTokens,
  customers,
  pets,
  services,
  appointments,
  payments,
  messages,
  campaigns,
  reminders,
  auditLogs,
  plans,
  subscriptions,
  billingEvents,
  brands,
  suppliers,
  products,
  sales,
  saleItems,
  stockMovements,
  messageTemplates,
  petHealthRecords,
  bookingRequests,
};

export type Schema = typeof schema;
