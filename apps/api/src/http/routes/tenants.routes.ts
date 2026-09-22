import { Permission, updateTenantInputSchema } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { getOnboarding, getTenant, updateTenant } from '../../modules/tenants/tenants.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/**
 * Nao existe rota para listar tenants nem para acessar "/tenants/:id".
 * O unico tenant alcancavel e o da sessao -- por isso "current". Aceitar um id
 * na URL seria criar, de graca, uma superficie de ataque para enumeracao.
 */
export async function tenantsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/current',
    { preHandler: requirePermission(Permission.SETTINGS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const tenant = await withTenant(auth.context.tenantId, (tx) => getTenant(tx, auth.context));
      return reply.send(tenant);
    },
  );

  app.patch(
    '/current',
    { preHandler: requirePermission(Permission.SETTINGS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const input = validate(updateTenantInputSchema, request.body);
      const tenant = await withTenant(auth.context.tenantId, (tx) =>
        updateTenant(tx, auth.context, input),
      );
      return reply.send(tenant);
    },
  );

  app.get(
    '/current/onboarding',
    { preHandler: requirePermission(Permission.DASHBOARD_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const onboarding = await withTenant(auth.context.tenantId, (tx) =>
        getOnboarding(tx, auth.context),
      );
      return reply.send(onboarding);
    },
  );
}
