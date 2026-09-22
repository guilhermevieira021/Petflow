import type { FastifyInstance } from 'fastify';
import { withSystem } from '../../db/context.js';
import { listActivePlans } from '../../modules/billing/billing.service.js';

/**
 * Catalogo de planos. Publico de proposito -- a pagina de precos precisa
 * funcionar para visitante nao autenticado. `withSystem` e seguro aqui porque
 * `plans` nao carrega dado de nenhum tenant especifico.
 */
export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    const plans = await withSystem((tx) => listActivePlans(tx));
    return reply.send({ data: plans });
  });
}
