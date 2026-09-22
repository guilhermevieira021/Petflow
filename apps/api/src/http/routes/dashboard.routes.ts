import { dashboardQuerySchema, listAuditLogsQuerySchema, Permission } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { getOverview } from '../../modules/dashboard/dashboard.service.js';
import { listAuditLogs } from '../../modules/audit/audit.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/overview',
    { preHandler: requirePermission(Permission.DASHBOARD_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const query = validate(dashboardQuerySchema, request.query);
      const overview = await withTenant(auth.context.tenantId, (tx) =>
        getOverview(tx, auth.context, query.date),
      );
      return reply.send(overview);
    },
  );
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.AUDIT_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listAuditLogsQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) =>
      listAuditLogs(tx, auth.context, query),
    );
    return reply.send(result);
  });
}
