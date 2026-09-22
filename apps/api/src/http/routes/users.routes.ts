import {
  createUserInputSchema,
  idParamSchema,
  listUsersQuerySchema,
  Permission,
  updateUserInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
} from '../../modules/users/users.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.USERS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listUsersQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) =>
      listUsers(tx, auth.context, query),
    );
    return reply.send(result);
  });

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.USERS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const user = await withTenant(auth.context.tenantId, (tx) => getUser(tx, auth.context, id));
      return reply.send(user);
    },
  );

  app.post('/', { preHandler: requirePermission(Permission.USERS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createUserInputSchema, request.body);
    const user = await withTenant(auth.context.tenantId, (tx) =>
      createUser(tx, auth.context, auth.user.role, input),
    );
    return reply.status(201).send(user);
  });

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.USERS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(updateUserInputSchema, request.body);
      const user = await withTenant(auth.context.tenantId, (tx) =>
        updateUser(tx, auth.context, auth.user.role, id, input),
      );
      return reply.send(user);
    },
  );

  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.USERS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      await withTenant(auth.context.tenantId, (tx) =>
        deleteUser(tx, auth.context, auth.user.role, id),
      );
      return reply.status(204).send();
    },
  );
}
