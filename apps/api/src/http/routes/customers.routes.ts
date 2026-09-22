import {
  createCustomerInputSchema,
  idParamSchema,
  listCustomersQuerySchema,
  Permission,
  updateCustomerInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '../../modules/customers/customers.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function customersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: requirePermission(Permission.CUSTOMERS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const query = validate(listCustomersQuerySchema, request.query);
      const result = await withTenant(auth.context.tenantId, (tx) =>
        listCustomers(tx, auth.context, query),
      );
      return reply.send(result);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.CUSTOMERS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const customer = await withTenant(auth.context.tenantId, (tx) => getCustomer(tx, auth.context, id));
      return reply.send(customer);
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.CUSTOMERS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const input = validate(createCustomerInputSchema, request.body);
      const customer = await withTenant(auth.context.tenantId, (tx) => createCustomer(tx, auth.context, input));
      return reply.status(201).send(customer);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.CUSTOMERS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(updateCustomerInputSchema, request.body);
      const customer = await withTenant(auth.context.tenantId, (tx) =>
        updateCustomer(tx, auth.context, auth.user.role, id, input),
      );
      return reply.send(customer);
    },
  );
}
