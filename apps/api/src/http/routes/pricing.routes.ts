import { Permission, priceSuggestionQuerySchema } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { suggestPrice } from '../../modules/pricing/pricing.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/** /api/pricing -- preco de venda sugerido (recomendacao, nunca preco de mercado). */
export async function pricingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/suggestion', { preHandler: requirePermission(Permission.PRODUCTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(priceSuggestionQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => suggestPrice(tx, auth.context, query)));
  });
}
