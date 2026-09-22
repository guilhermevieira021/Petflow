import { Permission, retentionQuerySchema } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { listRetentionCandidates } from '../../modules/retention/retention.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: requirePermission(Permission.RETENTION_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const query = validate(retentionQuerySchema, request.query);
      const result = await withTenant(auth.context.tenantId, (tx) =>
        listRetentionCandidates(tx, auth.context, query),
      );
      return reply.send(result);
    },
  );
}
