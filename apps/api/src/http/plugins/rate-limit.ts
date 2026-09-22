import type { RouteShorthandOptions } from 'fastify';
import { isTest } from '../../config/env.js';

/**
 * Limites por rota.
 *
 * Desligados sob NODE_ENV=test: a suite dispara dezenas de logins em poucos
 * segundos e esbarraria no proprio limite. O comportamento de producao
 * continua intacto -- e o limite global tambem e desligado no mesmo cenario,
 * em server.ts.
 */
export function strictRateLimit(max: number, timeWindow: string): RouteShorthandOptions {
  if (isTest) return {};
  return { config: { rateLimit: { max, timeWindow } } };
}

/** Rotas de credencial: forca bruta e enumeracao de contas. */
export const AUTH_RATE_LIMIT = strictRateLimit(10, '5 minutes');
