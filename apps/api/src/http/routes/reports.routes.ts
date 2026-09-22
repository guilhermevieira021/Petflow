import { Permission, reportsQuerySchema } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { getReportsOverview } from '../../modules/reports/reports.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/overview',
    { preHandler: requirePermission(Permission.REPORTS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const query = validate(reportsQuerySchema, request.query);
      const overview = await withTenant(auth.context.tenantId, (tx) =>
        getReportsOverview(tx, auth.context, query),
      );
      return reply.send(overview);
    },
  );
}
