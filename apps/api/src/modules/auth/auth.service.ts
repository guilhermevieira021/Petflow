import {
  AuditAction,
  AuditEntity,
  DEFAULT_TENANT_SETTINGS,
  ErrorCode,
  type AuthenticatedUser,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@petflow/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import {
  ConflictError,
  ForbiddenError,
  InactiveAccountError,
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
} from '../../core/errors.js';
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
  wasteTimeLikeAVerification,
} from '../../core/crypto.js';
import { uniqueSlug } from '../../core/slug.js';
import { toIso, toIsoRequired } from '../../core/serialization.js';
import { withBootstrap, withSystem, withTenant, type TenantContext } from '../../db/context.js';
import { passwordResetTokens, tenants, users } from '../../db/schema/index.js';
import { recordAnonymousAudit, recordAudit } from '../audit/audit.service.js';
import { startTrialSubscription } from '../billing/billing.service.js';
import { createMailProvider } from '../../integrations/mail/mail.provider.js';
import { createSession, revokeAllUserSessions, type IssuedSession } from './session.service.js';

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuthResult {
  user: AuthenticatedUser;
  session: IssuedSession;
}

function toAuthenticatedUser(row: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: AuthenticatedUser['role'];
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AuthenticatedUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    lastLoginAt: toIso(row.lastLoginAt),
    createdAt: toIsoRequired(row.createdAt),
  };
}

/**
 * Cadastro publico: cria o pet shop e o seu primeiro OWNER.
 *
 * Este e um dos tres unicos usos legitimos de `withSystem` -- nao existe
 * tenant ao qual se vincular antes desta transacao. Tudo acontece de forma
 * atomica: ou nascem tenant + usuario + sessao, ou nao nasce nada.
 */
export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  return withSystem(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);

    if (existing) {
      throw new ConflictError(
        'Este email ja esta em uso. Faca login ou utilize outro email.',
        ErrorCode.EMAIL_ALREADY_USED,
      );
    }

    const slug = await uniqueSlug(input.slug ?? input.tenantName, async (candidate) => {
      const [row] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.slug, candidate), isNull(tenants.deletedAt)))
        .limit(1);
      return row !== undefined;
    });

    const [tenant] = await tx
      .insert(tenants)
      .values({ name: input.tenantName, slug, settings: DEFAULT_TENANT_SETTINGS })
      .returning({ id: tenants.id });

    if (!tenant) throw new Error('Falha ao criar o pet shop.');

    const [user] = await tx
      .insert(users)
      .values({
        tenantId: tenant.id,
        name: input.userName,
        email: input.email,
        passwordHash,
        role: 'OWNER',
      })
      .returning({
        id: users.id,
        tenantId: users.tenantId,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      });

    if (!user) throw new Error('Falha ao criar o usuario.');

    // O trial comeca no mesmo instante em que o pet shop nasce -- nao ha
    // janela em que um tenant existe sem assinatura.
    const subscription = await startTrialSubscription(tx, tenant.id);

    const session = await createSession(tx, {
      userId: user.id,
      tenantId: tenant.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const auditContext: TenantContext = {
      tenantId: tenant.id,
      userId: user.id,
      requestId: meta.requestId ?? undefined,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    };
    await recordAudit(tx, auditContext, {
      action: AuditAction.TENANT_CREATED,
      entity: AuditEntity.TENANT,
      entityId: tenant.id,
      metadata: { name: input.tenantName, slug },
    });
    await recordAudit(tx, auditContext, {
      action: AuditAction.USER_CREATED,
      entity: AuditEntity.USER,
      entityId: user.id,
      metadata: { role: 'OWNER', viaRegistration: true },
    });
    await recordAudit(tx, auditContext, {
      action: AuditAction.SUBSCRIPTION_STARTED,
      entity: AuditEntity.SUBSCRIPTION,
      entityId: subscription.id,
      metadata: { planCode: 'TRIAL' },
    });

    return { user: toAuthenticatedUser(user), session };
  });
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  // Etapa 1 (pre-tenant): descobrir a qual tenant o email pertence.
  const candidate = await withBootstrap(async (tx) => {
    const [row] = await tx
      .select({
        id: users.id,
        tenantId: users.tenantId,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        passwordHash: users.passwordHash,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  });

  if (!candidate) {
    // Gasta o mesmo tempo de uma verificacao real: sem esse passo, a diferenca
    // de latencia revela quais emails existem na base.
    await wasteTimeLikeAVerification();
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(input.password, candidate.passwordHash);

  if (!passwordMatches) {
    await withTenant(candidate.tenantId, (tx) =>
      recordAnonymousAudit(
        tx,
        {
          tenantId: candidate.tenantId,
          userId: candidate.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
        {
          action: AuditAction.AUTH_LOGIN_FAILED,
          entity: AuditEntity.SESSION,
          metadata: { reason: 'senha_incorreta' },
        },
      ),
    );
    throw new InvalidCredentialsError();
  }

  if (!candidate.active) {
    throw new InactiveAccountError();
  }

  // Etapa 2: ja sabemos o tenant, entao tudo daqui em diante roda sob RLS.
  return withTenant(candidate.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, deletedAt: tenants.deletedAt })
      .from(tenants)
      .where(eq(tenants.id, candidate.tenantId))
      .limit(1);

    if (!tenant || tenant.deletedAt !== null) {
      throw new ForbiddenError('Este pet shop nao esta mais ativo.');
    }

    const now = new Date();
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, candidate.id));

    const session = await createSession(tx, {
      userId: candidate.id,
      tenantId: candidate.tenantId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await recordAudit(
      tx,
      {
        tenantId: candidate.tenantId,
        userId: candidate.id,
        requestId: meta.requestId ?? undefined,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
      { action: AuditAction.AUTH_LOGIN, entity: AuditEntity.SESSION, entityId: session.sessionId },
    );

    return {
      user: toAuthenticatedUser({
        id: candidate.id,
        tenantId: candidate.tenantId,
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
        active: candidate.active,
        lastLoginAt: now,
        createdAt: candidate.createdAt,
      }),
      session,
    };
  });
}

/**
 * Recuperacao de senha.
 *
 * Sempre resolve sem erro, exista o email ou nao: a resposta da API nao pode
 * servir de oraculo para descobrir quem tem conta. Quando o email existe,
 * gravamos um token de uso unico e entregamos ao MailProvider configurado --
 * que, com MAIL_PROVIDER=console, apenas escreve o link no log do servidor.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  const target = await withBootstrap(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, tenantId: users.tenantId, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt), eq(users.active, true)))
      .limit(1);

    if (!user) return null;

    // Invalida pedidos anteriores ainda abertos.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

    await tx.insert(passwordResetTokens).values({
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    return user;
  });

  if (!target) return;

  const link = `${env.APP_URL}/redefinir-senha?token=${token}`;
  await createMailProvider().send({
    to: target.email,
    subject: 'Recuperacao de senha - PetFlow',
    text:
      `Ola, ${target.name}!\n\n` +
      `Recebemos um pedido para redefinir a sua senha no PetFlow.\n` +
      `Acesse o link abaixo para criar uma nova senha:\n\n${link}\n\n` +
      `O link expira em ${env.PASSWORD_RESET_TTL_MINUTES} minutos.\n` +
      `Se nao foi voce quem pediu, ignore esta mensagem.`,
  });

  await withTenant(target.tenantId, (tx) =>
    recordAnonymousAudit(
      tx,
      {
        tenantId: target.tenantId,
        userId: target.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      },
      { action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED, entity: AuditEntity.USER, entityId: target.id },
    ),
  );
}

export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
  const passwordHash = await hashPassword(input.password);

  const result = await withBootstrap(async (tx) => {
    const [row] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        tenantId: passwordResetTokens.tenantId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(input.token)))
      .limit(1);

    if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));

    // Trocar a senha derruba todas as sessoes: se a conta estava comprometida,
    // o invasor perde o acesso no mesmo instante.
    await revokeAllUserSessions(tx, row.userId);

    return { userId: row.userId, tenantId: row.tenantId };
  });

  if (!result) {
    throw new UnauthenticatedError(
      'Este link de recuperacao e invalido ou expirou. Solicite um novo.',
      ErrorCode.BAD_REQUEST,
    );
  }

  await withTenant(result.tenantId, (tx) =>
    recordAnonymousAudit(
      tx,
      {
        tenantId: result.tenantId,
        userId: result.userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      },
      {
        action: AuditAction.AUTH_PASSWORD_RESET_COMPLETED,
        entity: AuditEntity.USER,
        entityId: result.userId,
      },
    ),
  );
}

export async function changePassword(
  context: TenantContext,
  input: ChangePasswordInput,
): Promise<void> {
  const newHash = await hashPassword(input.password);

  await withTenant(context.tenantId, async (tx) => {
    const [user] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, context.userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) throw new NotFoundError('Usuario');

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthenticatedError('Senha atual incorreta.', ErrorCode.INVALID_CREDENTIALS);
    }

    await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
    await recordAudit(tx, context, {
      action: AuditAction.AUTH_PASSWORD_CHANGED,
      entity: AuditEntity.USER,
      entityId: user.id,
    });
  });
}

/** Remove tokens de recuperacao vencidos. Chamado na rotina de manutencao. */
export async function purgeExpiredResetTokens(): Promise<void> {
  await withBootstrap(async (tx) => {
    await tx.delete(passwordResetTokens).where(sql`expires_at < now() - interval '7 days'`);
  });
}
