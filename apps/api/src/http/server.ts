import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env, isProduction, isTest } from '../config/env.js';
import { loggerOptions } from '../core/logger.js';
import { createMailProvider } from '../integrations/mail/mail.provider.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAuthPlugin } from './plugins/auth.js';
import { appointmentsRoutes } from './routes/appointments.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { billingRoutes } from './routes/billing.routes.js';
import { caktoWebhookRoutes } from './routes/cakto-webhook.routes.js';
import { auditRoutes, dashboardRoutes } from './routes/dashboard.routes.js';
import { customersRoutes } from './routes/customers.routes.js';
import { messagesRoutes } from './routes/messages.routes.js';
import { petsRoutes } from './routes/pets.routes.js';
import { plansRoutes } from './routes/plans.routes.js';
import { reportsRoutes } from './routes/reports.routes.js';
import { retentionRoutes } from './routes/retention.routes.js';
import { servicesRoutes } from './routes/services.routes.js';
import { tenantsRoutes } from './routes/tenants.routes.js';
import { usersRoutes } from './routes/users.routes.js';
import './types.js';

export async function buildServer(): Promise<FastifyInstance> {
  // Falha no boot, e nao no primeiro uso: uma configuracao de provider
  // invalida tem que derrubar o deploy, nao o cliente.
  createMailProvider();

  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    // Confia no proxy reverso para obter o IP real (rate limit e audit log).
    trustProxy: isProduction,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, {
    // A API serve apenas JSON; nao ha documento HTML para uma CSP proteger.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    // Origem unica e explicita. Nunca reflita o header Origin recebido:
    // combinado com credentials, isso libera a API para qualquer site.
    origin: env.APP_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
  });

  await app.register(cookie, { secret: env.AUTH_SECRET });

  await app.register(rateLimit, {
    // Desligado em teste: a suite dispara centenas de requisicoes em segundos.
    global: !isTest,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Usuario autenticado tem cota propria; anonimos compartilham a do IP.
    keyGenerator: (request) => request.auth?.user.id ?? request.ip,
  });

  registerErrorHandler(app);
  registerAuthPlugin(app);

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(tenantsRoutes, { prefix: '/api/tenants' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(auditRoutes, { prefix: '/api/audit-logs' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(caktoWebhookRoutes, { prefix: '/api/webhooks/cakto' });
  await app.register(plansRoutes, { prefix: '/api/plans' });
  await app.register(customersRoutes, { prefix: '/api/customers' });
  await app.register(petsRoutes, { prefix: '/api/pets' });
  await app.register(servicesRoutes, { prefix: '/api/services' });
  await app.register(appointmentsRoutes, { prefix: '/api/appointments' });
  await app.register(retentionRoutes, { prefix: '/api/retention' });
  await app.register(messagesRoutes, { prefix: '/api/messages' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });

  return app;
}
