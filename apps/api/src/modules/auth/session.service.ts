import type { Role } from '@petflow/contracts';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { generateToken, hashToken, safeEqual } from '../../core/crypto.js';
import type { Transaction } from '../../db/client.js';
import { sessions, users } from '../../db/schema/index.js';

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
/** Evita um UPDATE a cada request; 5 minutos de granularidade bastam. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface IssuedSession {
  /** Token em claro -- vai para o cookie httpOnly e nunca e persistido. */
  token: string;
  /** Segredo do double-submit CSRF -- vai para um cookie legivel por JS. */
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
}

export interface ResolvedSession {
  sessionId: string;
  tenantId: string;
  csrfSecret: string;
  user: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    role: Role;
    active: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  };
}

export function sessionTtlMs(): number {
  return env.SESSION_TTL_DAYS * MILLIS_PER_DAY;
}

export async function createSession(
  tx: Transaction,
  params: {
    userId: string;
    tenantId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<IssuedSession> {
  const token = generateToken(32);
  const csrfToken = generateToken(32);
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  const [row] = await tx
    .insert(sessions)
    .values({
      tenantId: params.tenantId,
      userId: params.userId,
      tokenHash: hashToken(token),
      csrfSecret: csrfToken,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent?.slice(0, 500) ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error('Falha ao criar sessao.');
  return { token, csrfToken, expiresAt, sessionId: row.id };
}

/**
 * Resolve o token do cookie para uma sessao valida.
 *
 * Retorna null para token inexistente, revogado, expirado, usuario inativo ou
 * usuario removido. O chamador nao precisa distinguir esses casos -- todos
 * levam a mesma resposta 401.
 */
export async function resolveSession(
  tx: Transaction,
  token: string,
): Promise<ResolvedSession | null> {
  const [row] = await tx
    .select({
      sessionId: sessions.id,
      tenantId: sessions.tenantId,
      csrfSecret: sessions.csrfSecret,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      userTenantId: users.tenantId,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      userActive: users.active,
      userLastLoginAt: users.lastLoginAt,
      userCreatedAt: users.createdAt,
      userDeletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.userActive || row.userDeletedAt !== null) return null;

  // Expiracao deslizante: o usuario ativo nao e deslogado no meio do dia.
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await tx
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + sessionTtlMs()) })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    csrfSecret: row.csrfSecret,
    user: {
      id: row.userId,
      tenantId: row.userTenantId,
      name: row.userName,
      email: row.userEmail,
      role: row.userRole,
      active: row.userActive,
      lastLoginAt: row.userLastLoginAt,
      createdAt: row.userCreatedAt,
    },
  };
}

export function verifyCsrf(expectedSecret: string, provided: string | undefined): boolean {
  if (!provided) return false;
  return safeEqual(expectedSecret, provided);
}

export async function revokeSessionByToken(tx: Transaction, token: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Usado ao trocar senha e ao desativar usuario: derruba todos os acessos. */
export async function revokeAllUserSessions(tx: Transaction, userId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Higiene: remove sessoes expiradas ou revogadas ha mais de 30 dias. */
export async function purgeStaleSessions(tx: Transaction): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * MILLIS_PER_DAY);
  await tx
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)));
}
