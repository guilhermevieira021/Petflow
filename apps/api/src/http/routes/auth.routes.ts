import {
  changePasswordInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  permissionsFor,
  registerInputSchema,
  resetPasswordInputSchema,
  type SessionPayload,
} from '@petflow/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { validate } from '../../core/validation.js';
import { withBootstrap, withTenant } from '../../db/context.js';
import {
  changePassword,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  type RequestMeta,
} from '../../modules/auth/auth.service.js';
import { revokeSessionByToken } from '../../modules/auth/session.service.js';
import { getBillingStatus } from '../../modules/billing/billing.service.js';
import { getOnboarding, getTenant, toBranding } from '../../modules/tenants/tenants.service.js';
import {
  clearSessionCookies,
  currentAuth,
  requireAuth,
  setSessionCookies,
} from '../plugins/auth.js';
import { AUTH_RATE_LIMIT } from '../plugins/rate-limit.js';

function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: request.id,
  };
}

/**
 * Limites mais apertados nas rotas que um atacante usaria para forca bruta ou
 * enumeracao de contas. O limite global da API e generoso demais para elas.
 */
const strictLimit = AUTH_RATE_LIMIT;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', strictLimit, async (request, reply) => {
    const input = validate(registerInputSchema, request.body);
    const result = await register(input, requestMeta(request));

    setSessionCookies(reply, {
      token: result.session.token,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.expiresAt,
    });

    return reply.status(201).send({ user: result.user, csrfToken: result.session.csrfToken });
  });

  app.post('/login', strictLimit, async (request, reply) => {
    const input = validate(loginInputSchema, request.body);
    const result = await login(input, requestMeta(request));

    setSessionCookies(reply, {
      token: result.session.token,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.expiresAt,
    });

    return reply.send({ user: result.user, csrfToken: result.session.csrfToken });
  });

  app.post('/logout', { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token) {
      await withBootstrap((tx) => revokeSessionByToken(tx, token));
    }
    clearSessionCookies(reply);
    return reply.status(204).send();
  });

  /**
   * Payload unico de inicializacao do app: usuario, marca do tenant,
   * permissoes e progresso do onboarding. Uma chamada, nenhum waterfall.
   */
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const auth = currentAuth(request);

    const payload = await withTenant(auth.context.tenantId, async (tx) => {
      const tenant = await getTenant(tx, auth.context);
      const onboarding = await getOnboarding(tx, auth.context);
      const billing = await getBillingStatus(tx, auth.context);
      const result: SessionPayload = {
        user: auth.user,
        tenant: toBranding(tenant),
        csrfToken: auth.csrfSecret,
        permissions: [...permissionsFor(auth.user.role)],
        onboarding,
        billing,
      };
      return result;
    });

    return reply.send(payload);
  });

  app.post('/forgot-password', strictLimit, async (request, reply) => {
    const input = validate(forgotPasswordInputSchema, request.body);
    await requestPasswordReset(input, requestMeta(request));

    // 202 sempre, exista o email ou nao: a resposta nao pode servir de oraculo
    // para descobrir quem tem conta no sistema.
    return reply.status(202).send({
      message:
        'Se este email estiver cadastrado, enviaremos as instrucoes de recuperacao em instantes.',
    });
  });

  app.post('/reset-password', strictLimit, async (request, reply) => {
    const input = validate(resetPasswordInputSchema, request.body);
    await resetPassword(input, requestMeta(request));
    return reply.send({ message: 'Senha redefinida. Faca login com a nova senha.' });
  });

  app.post('/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(changePasswordInputSchema, request.body);
    await changePassword(auth.context, input);
    return reply.send({ message: 'Senha alterada com sucesso.' });
  });
}
