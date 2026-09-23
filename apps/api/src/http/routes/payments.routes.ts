import {
  changePaymentStatusInputSchema,
  createPaymentInputSchema,
  idParamSchema,
  listPaymentsQuerySchema,
  Permission,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  changePaymentStatus,
  createPayment,
  getPayment,
  listPayments,
} from '../../modules/payments/payments.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.PAYMENTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listPaymentsQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) => listPayments(tx, auth.context, query));
    return reply.send(result);
  });

  app.get('/:id', { preHandler: requirePermission(Permission.PAYMENTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const payment = await withTenant(auth.context.tenantId, (tx) => getPayment(tx, auth.context, id));
    return reply.send(payment);
  });

  app.post('/', { preHandler: requirePermission(Permission.PAYMENTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createPaymentInputSchema, request.body);
    const payment = await withTenant(auth.context.tenantId, (tx) => createPayment(tx, auth.context, input));
    return reply.status(201).send(payment);
  });

  app.patch(
    '/:id/status',
    { preHandler: requirePermission(Permission.PAYMENTS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(changePaymentStatusInputSchema, request.body);
      const payment = await withTenant(auth.context.tenantId, (tx) =>
        changePaymentStatus(tx, auth.context, id, input),
      );
      return reply.send(payment);
    },
  );
}
