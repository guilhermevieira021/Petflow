import { z } from 'zod';
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from './common.js';

/** Acoes auditadas. Cresce conforme novos modulos entram. */
export const AuditAction = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  AUTH_PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',

  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_DELETED: 'user.deleted',

  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',

  PET_CREATED: 'pet.created',
  PET_UPDATED: 'pet.updated',
  PET_DELETED: 'pet.deleted',

  SERVICE_CREATED: 'service.created',
  SERVICE_UPDATED: 'service.updated',
  SERVICE_DELETED: 'service.deleted',

  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_UPDATED: 'appointment.updated',
  APPOINTMENT_STATUS_CHANGED: 'appointment.status_changed',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',

  SALE_CREATED: 'sale.created',
  SALE_CANCELLED: 'sale.cancelled',

  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  STOCK_MOVED: 'stock.moved',
  STOCK_ENTRY_RECORDED: 'stock.entry_recorded',
  BRAND_CREATED: 'brand.created',
  BRAND_UPDATED: 'brand.updated',
  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  PRODUCT_CATEGORY_RENAMED: 'product.category_renamed',

  MESSAGE_TEMPLATE_UPDATED: 'message_template.updated',
  MESSAGE_QUEUED: 'message.queued',

  PET_HEALTH_RECORDED: 'pet_health.recorded',
  PET_HEALTH_UPDATED: 'pet_health.updated',
  PET_HEALTH_DELETED: 'pet_health.deleted',

  BOOKING_REQUESTED: 'booking.requested',
  BOOKING_ACCEPTED: 'booking.accepted',
  BOOKING_REJECTED: 'booking.rejected',

  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_STATUS_CHANGED: 'payment.status_changed',
  MESSAGE_SENT: 'message.sent',

  SUBSCRIPTION_STARTED: 'subscription.started',
  SUBSCRIPTION_CHECKOUT_REQUESTED: 'subscription.checkout_requested',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  TENANT: 'tenant',
  USER: 'user',
  CUSTOMER: 'customer',
  PET: 'pet',
  SERVICE: 'service',
  APPOINTMENT: 'appointment',
  PAYMENT: 'payment',
  SALE: 'sale',
  PRODUCT: 'product',
  BRAND: 'brand',
  SUPPLIER: 'supplier',
  MESSAGE_TEMPLATE: 'message_template',
  PET_HEALTH: 'pet_health',
  BOOKING_REQUEST: 'booking_request',
  MESSAGE: 'message',
  CAMPAIGN: 'campaign',
  SESSION: 'session',
  SUBSCRIPTION: 'subscription',
} as const;
export type AuditEntity = (typeof AuditEntity)[keyof typeof AuditEntity];

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(40).optional(),
  entityId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export interface AuditLogDto {
  id: string;
  tenantId: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}
