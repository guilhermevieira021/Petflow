import type { AuditAction, AuditEntity } from '@petflow/contracts';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { AuditLogDto, ListAuditLogsQuery, Paginated } from '@petflow/contracts';
import { buildPagination } from '@petflow/contracts';
import { auditLogs, users } from '../../db/schema/index.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { toCount, toIsoRequired } from '../../core/serialization.js';

export interface AuditEvent {
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Registra a acao na MESMA transacao da operacao auditada.
 *
 * Consequencia deliberada: se a operacao falhar, o log tambem some -- nao
 * existe registro de auditoria de algo que nao aconteceu. E se o log falhar,
 * a operacao falha junto, o que e o comportamento correto para uma trilha que
 * precisa ser confiavel.
 */
export async function recordAudit(
  tx: Transaction,
  context: TenantContext,
  event: AuditEvent,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: context.tenantId,
    userId: context.userId,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? null,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
    requestId: context.requestId ?? null,
  });
}

/**
 * Variante para eventos anonimos/pre-sessao (ex.: login que falhou).
 * Recebe tenantId explicito porque ainda nao existe TenantContext.
 */
export async function recordAnonymousAudit(
  tx: Transaction,
  params: {
    tenantId: string;
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  },
  event: AuditEvent,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    requestId: params.requestId ?? null,
  });
}

export async function listAuditLogs(
  tx: Transaction,
  context: TenantContext,
  query: ListAuditLogsQuery,
): Promise<Paginated<AuditLogDto>> {
  const filters: SQL[] = [eq(auditLogs.tenantId, context.tenantId)];
  if (query.action) filters.push(eq(auditLogs.action, query.action));
  if (query.entity) filters.push(eq(auditLogs.entity, query.entity));
  if (query.entityId) filters.push(eq(auditLogs.entityId, query.entityId));
  if (query.userId) filters.push(eq(auditLogs.userId, query.userId));
  if (query.from) filters.push(gte(auditLogs.createdAt, new Date(query.from)));
  if (query.to) filters.push(lte(auditLogs.createdAt, new Date(query.to)));

  const where = and(...filters);

  const [totalRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(auditLogs)
    .where(where);

  const rows = await tx
    .select({
      id: auditLogs.id,
      tenantId: auditLogs.tenantId,
      userId: auditLogs.userId,
      userName: users.name,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    data: rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      userName: row.userName,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      createdAt: toIsoRequired(row.createdAt),
    })),
    pagination: buildPagination(query.page, query.pageSize, toCount(totalRow?.value)),
  };
}
