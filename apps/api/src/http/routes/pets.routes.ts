import {
  createPetInputSchema,
  idParamSchema,
  listPetsQuerySchema,
  Permission,
  updatePetInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { createPet, getPet, listPets, updatePet } from '../../modules/pets/pets.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function petsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.PETS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listPetsQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) => listPets(tx, auth.context, query));
    return reply.send(result);
  });

  app.get('/:id', { preHandler: requirePermission(Permission.PETS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const pet = await withTenant(auth.context.tenantId, (tx) => getPet(tx, auth.context, id));
    return reply.send(pet);
  });

  app.post('/', { preHandler: requirePermission(Permission.PETS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createPetInputSchema, request.body);
    const pet = await withTenant(auth.context.tenantId, (tx) => createPet(tx, auth.context, input));
    return reply.status(201).send(pet);
  });

  app.patch('/:id', { preHandler: requirePermission(Permission.PETS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(updatePetInputSchema, request.body);
    const pet = await withTenant(auth.context.tenantId, (tx) =>
      updatePet(tx, auth.context, auth.user.role, id, input),
    );
    return reply.send(pet);
  });
}
