import type { AuthenticatedUser } from '@petflow/contracts';
import type { TenantContext } from '../db/context.js';

/** Estado derivado da sessao. Preenchido apenas pelo plugin de autenticacao. */
export interface AuthState {
  user: AuthenticatedUser;
  sessionId: string;
  csrfSecret: string;
  /**
   * Contexto usado por todos os servicos. O tenantId aqui vem da SESSAO --
   * nunca do corpo, da query ou dos params da requisicao.
   */
  context: TenantContext;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}
