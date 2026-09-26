import {
  createPetHealthRecordInputSchema,
  idParamSchema,
  listDueHealthQuerySchema,
  Permission,
  petHealthParamsSchema,
  updatePetHealthRecordInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createPetHealthRecord,
  deletePetHealthRecord,
  listDueHealth,
  listPetHealth,
  updatePetHealthRecord,
} from '../../modules/health/health.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/** Historico clinico: /api/pets/:id/health e /api/health/due. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pets/:id/health', { preHandler: requirePermission(Permission.PETS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listPetHealth(tx, auth.context, id)));
  });

  app.post('/pets/:id/health', { preHandler: requirePermission(Permission.PETS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(createPetHealthRecordInputSchema, request.body);
    const record = await withTenant(auth.context.tenantId, (tx) => createPetHealthRecord(tx, auth.context, id, input));
    return reply.status(201).send(record);
  });

  app.patch(
    '/pets/:id/health/:recordId',
    { preHandler: requirePermission(Permission.PETS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id, recordId } = validate(petHealthParamsSchema, request.params);
      const input = validate(updatePetHealthRecordInputSchema, request.body);
      return reply.send(
        await withTenant(auth.context.tenantId, (tx) => updatePetHealthRecord(tx, auth.context, id, recordId, input)),
      );
    },
  );

  app.delete(
    '/pets/:id/health/:recordId',
    { preHandler: requirePermission(Permission.PETS_DELETE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id, recordId } = validate(petHealthParamsSchema, request.params);
      await withTenant(auth.context.tenantId, (tx) => deletePetHealthRecord(tx, auth.context, id, recordId));
      return reply.status(204).send();
    },
  );

  app.get('/health/due', { preHandler: requirePermission(Permission.PETS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listDueHealthQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listDueHealth(tx, auth.context, query)));
  });
}
