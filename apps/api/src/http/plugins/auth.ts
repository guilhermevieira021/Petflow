import { ErrorCode, type Permission, hasPermission } from '@petflow/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, isProduction } from '../../config/env.js';
import { ForbiddenError, UnauthenticatedError } from '../../core/errors.js';
import { toIso, toIsoRequired } from '../../core/serialization.js';
import { withBootstrap } from '../../db/context.js';
import { resolveSession, verifyCsrf } from '../../modules/auth/session.service.js';
import type { AuthState } from '../types.js';

export const CSRF_COOKIE_NAME = 'petflow_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Token de sessao: 32 bytes em base64url. Formato conferido antes do banco. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,90}$/;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none';
  path: string;
  maxAge: number;
  domain?: string;
}

function cookieOptions(maxAgeSeconds: number, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    // Em producao o cookie so trafega por HTTPS -- tambem exigido pelo
    // proprio navegador para aceitar SameSite=None abaixo.
    secure: isProduction,
    // Dev: frontend e API na MESMA origem (proxy do Vite), Lax basta e evita
    // afrouxar a protecao a toa. Producao: frontend (Vercel) e API (host
    // separado) sao origens DIFERENTES por arquitetura -- um cookie Lax
    // nunca acompanharia um fetch cross-site, e a sessao pareceria "sumir"
    // logo apos o login. A defesa contra CSRF nao depende de SameSite: o
    // double-submit (cookie CSRF legivel + header X-CSRF-Token, checado em
    // requireAuth) e quem garante isso, e um site de terceiros nao consegue
    // nem ler nosso cookie CSRF nem passar pelo CORS com um header custom.
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  params: { token: string; csrfToken: string; expiresAt: Date },
): void {
  const maxAge = Math.max(1, Math.floor((params.expiresAt.getTime() - Date.now()) / 1000));
  // httpOnly: JavaScript da pagina nao alcanca o token de sessao, entao um XSS
  // nao consegue exfiltra-lo.
  reply.setCookie(env.SESSION_COOKIE_NAME, params.token, cookieOptions(maxAge, true));
  // O token CSRF precisa ser legivel pelo frontend para ser devolvido no
  // header -- e exatamente esse o mecanismo do double submit.
  reply.setCookie(CSRF_COOKIE_NAME, params.csrfToken, cookieOptions(maxAge, false));
}

export function clearSessionCookies(reply: FastifyReply): void {
  const base = { path: '/', ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) };
  reply.clearCookie(env.SESSION_COOKIE_NAME, base);
  reply.clearCookie(CSRF_COOKIE_NAME, base);
}

function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[env.SESSION_COOKIE_NAME];
  if (!raw || !TOKEN_PATTERN.test(raw)) return null;
  return raw;
}

/**
 * Carrega a sessao, se houver, sem exigir autenticacao.
 * Roda em toda requisicao para que os logs carreguem tenant e usuario.
 */
async function loadSession(request: FastifyRequest): Promise<void> {
  request.auth = null;

  const token = readSessionToken(request);
  if (!token) return;

  const resolved = await withBootstrap((tx) => resolveSession(tx, token));
  if (!resolved) return;

  const state: AuthState = {
    user: {
      id: resolved.user.id,
      tenantId: resolved.user.tenantId,
      name: resolved.user.name,
      email: resolved.user.email,
      role: resolved.user.role,
      active: resolved.user.active,
      lastLoginAt: toIso(resolved.user.lastLoginAt),
      createdAt: toIsoRequired(resolved.user.createdAt),
    },
    sessionId: resolved.sessionId,
    csrfSecret: resolved.csrfSecret,
    context: {
      tenantId: resolved.tenantId,
      userId: resolved.user.id,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
  };

  request.auth = state;
}

export function registerAuthPlugin(app: FastifyInstance): void {
  app.decorateRequest('auth', null);
  app.addHook('preHandler', loadSession);
}

/**
 * Exige sessao valida. Use como preHandler de toda rota protegida.
 *
 * Tambem valida CSRF nas requisicoes que alteram estado: o cookie legivel por
 * JS precisa bater com o header X-CSRF-Token. Um site de terceiros consegue
 * disparar um POST para a nossa API, mas nao consegue ler o nosso cookie nem
 * definir um header customizado sem passar pelo CORS.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    throw new UnauthenticatedError();
  }

  if (MUTATING_METHODS.has(request.method)) {
    const provided = request.headers[CSRF_HEADER_NAME];
    const token = Array.isArray(provided) ? provided[0] : provided;
    if (!verifyCsrf(request.auth.csrfSecret, token)) {
      throw new ForbiddenError(
        'Sessao invalida para esta acao. Recarregue a pagina e tente novamente.',
        ErrorCode.INVALID_CSRF_TOKEN,
      );
    }
  }
}

/**
 * Exige uma permissao especifica.
 *
 * Esta e a autorizacao que vale. O frontend usa a MESMA matriz para esconder
 * botoes, mas um usuario que chame a API diretamente esbarra aqui.
 */
export function requirePermission(permission: Permission) {
  return async function permissionGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await requireAuth(request, reply);

    const auth = request.auth;
    if (!auth) throw new UnauthenticatedError();

    if (!hasPermission(auth.user.role, permission)) {
      request.log.warn(
        { userId: auth.user.id, role: auth.user.role, permission },
        'Acesso negado por falta de permissao',
      );
      throw new ForbiddenError(
        'Voce nao possui permissao para realizar esta acao.',
        ErrorCode.INSUFFICIENT_PERMISSION,
      );
    }
  };
}

/** Lanca se nao houver sessao. Usado dentro de handlers ja protegidos. */
export function currentAuth(request: FastifyRequest): AuthState {
  if (!request.auth) throw new UnauthenticatedError();
  return request.auth;
}
