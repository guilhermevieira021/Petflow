import {
  createServiceInputSchema,
  idParamSchema,
  listServicesQuerySchema,
  Permission,
  updateServiceInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createService,
  getService,
  listServices,
  updateService,
} from '../../modules/services/services.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.SERVICES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listServicesQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) => listServices(tx, auth.context, query));
    return reply.send(result);
  });

  app.get('/:id', { preHandler: requirePermission(Permission.SERVICES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const service = await withTenant(auth.context.tenantId, (tx) => getService(tx, auth.context, id));
    return reply.send(service);
  });

  app.post('/', { preHandler: requirePermission(Permission.SERVICES_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createServiceInputSchema, request.body);
    const service = await withTenant(auth.context.tenantId, (tx) => createService(tx, auth.context, input));
    return reply.status(201).send(service);
  });

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.SERVICES_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(updateServiceInputSchema, request.body);
      const service = await withTenant(auth.context.tenantId, (tx) =>
        updateService(tx, auth.context, id, input),
      );
      return reply.send(service);
    },
  );
}
