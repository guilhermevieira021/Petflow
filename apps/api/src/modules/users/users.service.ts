import {
  AuditAction,
  AuditEntity,
  buildPagination,
  canManageRole,
  ErrorCode,
  LimitKey,
  type CreateUserInput,
  type ListUsersQuery,
  type Paginated,
  type Role,
  type UpdateUserInput,
  type UserDto,
} from '@petflow/contracts';
import { and, asc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors.js';
import { hashPassword } from '../../core/crypto.js';
import { toCount, toIso, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { users } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { revokeAllUserSessions } from '../auth/session.service.js';
import { assertActiveAccess, assertWithinLimit } from '../billing/billing.service.js';

const PUBLIC_COLUMNS = {
  id: users.id,
  tenantId: users.tenantId,
  name: users.name,
  email: users.email,
  role: users.role,
  active: users.active,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

type PublicUserRow = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Projecao publica. A coluna password_hash nao aparece em PUBLIC_COLUMNS, e
 * portanto nao ha caminho acidental para ela chegar a uma resposta HTTP.
 */
function toDto(row: PublicUserRow): UserDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    lastLoginAt: toIso(row.lastLoginAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listUsers(
  tx: Transaction,
  context: TenantContext,
  query: ListUsersQuery,
): Promise<Paginated<UserDto>> {
  const filters: SQL[] = [eq(users.tenantId, context.tenantId), isNull(users.deletedAt)];
  if (query.role) filters.push(eq(users.role, query.role));
  if (query.active !== undefined) filters.push(eq(users.active, query.active));
  if (query.search) {
    const term = `%${query.search}%`;
    const searchFilter = or(ilike(users.name, term), ilike(users.email, term));
    if (searchFilter) filters.push(searchFilter);
  }

  const where = and(...filters);

  const [totalRow] = await tx.select({ value: sql<string>`count(*)` }).from(users).where(where);

  const rows = await tx
    .select(PUBLIC_COLUMNS)
    .from(users)
    .where(where)
    .orderBy(asc(users.name))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map(toDto),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}

export async function getUser(
  tx: Transaction,
  context: TenantContext,
  userId: string,
): Promise<UserDto> {
  const [row] = await tx
    .select(PUBLIC_COLUMNS)
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, context.tenantId), isNull(users.deletedAt)))
    .limit(1);

  // Usuario de outro tenant cai aqui como 404, e nao 403: um 403 confirmaria
  // que o id existe e permitiria enumerar registros alheios.
  if (!row) throw new NotFoundError('Usuario');
  return toDto(row);
}

export async function createUser(
  tx: Transaction,
  context: TenantContext,
  actorRole: Role,
  input: CreateUserInput,
): Promise<UserDto> {
  if (!canManageRole(actorRole, input.role)) {
    throw new ForbiddenError('Voce nao pode criar um usuario com papel superior ao seu.');
  }

  await assertActiveAccess(tx, context);
  await assertWithinLimit(tx, context, LimitKey.USERS);

  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
    .limit(1);

  if (existing) {
    throw new ConflictError(
      'Este email ja esta em uso por outro usuario.',
      ErrorCode.EMAIL_ALREADY_USED,
    );
  }

  const [row] = await tx
    .insert(users)
    .values({
      tenantId: context.tenantId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    })
    .returning(PUBLIC_COLUMNS);

  if (!row) throw new Error('Falha ao criar usuario.');

  await recordAudit(tx, context, {
    action: AuditAction.USER_CREATED,
    entity: AuditEntity.USER,
    entityId: row.id,
    metadata: { role: input.role, name: input.name },
  });

  return toDto(row);
}

export async function updateUser(
  tx: Transaction,
  context: TenantContext,
  actorRole: Role,
  userId: string,
  input: UpdateUserInput,
): Promise<UserDto> {
  const target = await getUser(tx, context, userId);

  if (!canManageRole(actorRole, target.role)) {
    throw new ForbiddenError('Voce nao pode alterar um usuario com papel superior ao seu.');
  }
  if (input.role && !canManageRole(actorRole, input.role)) {
    throw new ForbiddenError('Voce nao pode atribuir um papel superior ao seu.');
  }

  const isSelf = target.id === context.userId;
  // Sem estas duas travas, um OWNER consegue rebaixar-se ou desativar-se e
  // deixar o pet shop sem ninguem capaz de administrar a conta.
  if (isSelf && input.role && input.role !== target.role) {
    throw new ForbiddenError('Voce nao pode alterar o seu proprio papel.');
  }
  if (isSelf && input.active === false) {
    throw new ForbiddenError('Voce nao pode desativar o seu proprio acesso.');
  }

  const losingOwner =
    target.role === 'OWNER' && (input.active === false || (input.role && input.role !== 'OWNER'));
  if (losingOwner) {
    await assertAnotherActiveOwnerExists(tx, context, target.id);
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.role !== undefined) patch.role = input.role;
  if (input.active !== undefined) patch.active = input.active;
  if (input.password !== undefined) patch.passwordHash = await hashPassword(input.password);

  await tx
    .update(users)
    .set(patch)
    .where(and(eq(users.id, userId), eq(users.tenantId, context.tenantId)));

  // Perder acesso ou ter a senha trocada por um administrador invalida as
  // sessoes abertas imediatamente.
  if (input.active === false || input.password !== undefined) {
    await revokeAllUserSessions(tx, userId);
  }

  await recordAudit(tx, context, {
    action: input.active === false ? AuditAction.USER_DEACTIVATED : AuditAction.USER_UPDATED,
    entity: AuditEntity.USER,
    entityId: userId,
    // Registramos QUAIS campos mudaram, nunca os valores de credencial.
    metadata: { fields: Object.keys(input).filter((field) => field !== 'password') },
  });

  return getUser(tx, context, userId);
}

/**
 * Exclusao logica. O historico operacional (agendamentos atendidos por este
 * profissional, logs de auditoria) precisa continuar existindo.
 */
export async function deleteUser(
  tx: Transaction,
  context: TenantContext,
  actorRole: Role,
  userId: string,
): Promise<void> {
  const target = await getUser(tx, context, userId);

  if (target.id === context.userId) {
    throw new ForbiddenError('Voce nao pode excluir o seu proprio usuario.');
  }
  if (!canManageRole(actorRole, target.role)) {
    throw new ForbiddenError('Voce nao pode excluir um usuario com papel superior ao seu.');
  }
  if (target.role === 'OWNER') {
    await assertAnotherActiveOwnerExists(tx, context, target.id);
  }

  const now = new Date();
  await tx
    .update(users)
    .set({
      active: false,
      deletedAt: now,
      // Libera o email para reuso sem quebrar o indice unico parcial.
      email: `${target.email}.removido.${now.getTime()}`,
    })
    .where(and(eq(users.id, userId), eq(users.tenantId, context.tenantId)));

  await revokeAllUserSessions(tx, userId);

  await recordAudit(tx, context, {
    action: AuditAction.USER_DELETED,
    entity: AuditEntity.USER,
    entityId: userId,
    metadata: { role: target.role },
  });
}

async function assertAnotherActiveOwnerExists(
  tx: Transaction,
  context: TenantContext,
  excludingUserId: string,
): Promise<void> {
  const [row] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(users)
    .where(
      and(
        eq(users.tenantId, context.tenantId),
        eq(users.role, 'OWNER'),
        eq(users.active, true),
        isNull(users.deletedAt),
        ne(users.id, excludingUserId),
      ),
    );

  if (toCount(row?.value) === 0) {
    throw new ConflictError(
      'O pet shop precisa ter ao menos um proprietario ativo. Promova outro usuario antes de continuar.',
    );
  }
}
