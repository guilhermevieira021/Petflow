import { checkoutInputSchema, Permission } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { getBillingStatus, startCheckout } from '../../modules/billing/billing.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/**
 * Rotas de billing do lado do TENANT (autenticadas). O webhook do provider de
 * pagamento fica em `cakto-webhook.routes.ts` -- e uma rota sem sessao,
 * chamada pela Cakto, e por isso vive separada desta.
 */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/status',
    { preHandler: requirePermission(Permission.BILLING_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const status = await withTenant(auth.context.tenantId, (tx) => getBillingStatus(tx, auth.context));
      return reply.send(status);
    },
  );

  app.post(
    '/checkout',
    { preHandler: requirePermission(Permission.BILLING_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const input = validate(checkoutInputSchema, request.body);
      const result = await withTenant(auth.context.tenantId, (tx) =>
        startCheckout(tx, auth.context, input.planCode),
      );
      return reply.send(result);
    },
  );
}
