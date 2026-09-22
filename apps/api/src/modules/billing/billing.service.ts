import {
  AuditAction,
  AuditEntity,
  ErrorCode,
  LIMIT_KEY_LABELS,
  type AccessBlockReason,
  type BillingStatusDto,
  type CheckoutResultDto,
  type FeatureKey,
  type LimitKey,
  type PlanDto,
  type SubscriptionDto,
  type UsageDto,
  type UsageEntry,
} from '@petflow/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ConflictError, ForbiddenError, InternalError } from '../../core/errors.js';
import { toCount, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import {
  appointments,
  billingEvents,
  customers,
  pets,
  plans,
  services,
  subscriptions,
  users,
  type BillingEventRow,
} from '../../db/schema/index.js';
import { recordAnonymousAudit, recordAudit } from '../audit/audit.service.js';
import { getBillingProvider } from '../../integrations/billing/billing.provider.js';

function toPlanDto(row: typeof plans.$inferSelect): PlanDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceCents: row.priceCents,
    currency: row.currency,
    billingPeriod: row.billingPeriod,
    trialHours: row.trialHours,
    limits: row.limits,
    features: row.features,
  };
}

function toSubscriptionDto(
  row: typeof subscriptions.$inferSelect,
  planCode: PlanDto['code'],
): SubscriptionDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planCode,
    status: row.status,
    trialEndsAt: row.trialEndsAt ? toIsoRequired(row.trialEndsAt) : null,
    currentPeriodEnd: row.currentPeriodEnd ? toIsoRequired(row.currentPeriodEnd) : null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: toIsoRequired(row.createdAt),
  };
}

/**
 * Catalogo publico de planos, para a pagina de precos (visitante, sem sessao).
 * Nao expoe nada alem do que um site de precos ja mostra normalmente.
 */
export async function listActivePlans(tx: Transaction): Promise<PlanDto[]> {
  const rows = await tx.select().from(plans).where(eq(plans.active, true));
  return rows.map(toPlanDto).sort((a, b) => a.priceCents - b.priceCents);
}

export async function getPlanByCode(
  tx: Transaction,
  code: PlanDto['code'],
): Promise<typeof plans.$inferSelect> {
  const [row] = await tx
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.active, true)))
    .limit(1);

  if (!row) {
    // So acontece se a migration 0003 nao rodou. E bug de infraestrutura, nao
    // situacao de negocio -- por isso 500 e nao um AppError de dominio.
    throw new InternalError(undefined, { missingPlan: code });
  }
  return row;
}

interface SubscriptionWithPlan {
  subscription: typeof subscriptions.$inferSelect;
  plan: typeof plans.$inferSelect;
}

async function getSubscriptionWithPlan(
  tx: Transaction,
  tenantId: string,
): Promise<SubscriptionWithPlan> {
  const [row] = await tx
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  if (!row) {
    // Todo tenant nasce com assinatura (criada atomicamente no registro).
    // Chegar aqui sem uma e bug de integridade de dados.
    throw new InternalError(undefined, { tenantId, reason: 'assinatura ausente' });
  }
  return row;
}

/**
 * Cria a assinatura inicial (TRIALING) de um tenant recem-criado.
 *
 * Chamado dentro da MESMA transacao `withSystem` do cadastro -- tenant,
 * usuario OWNER e assinatura nascem atomicamente, ou nenhum deles nasce.
 */
export async function startTrialSubscription(
  tx: Transaction,
  tenantId: string,
): Promise<typeof subscriptions.$inferSelect> {
  const trialPlan = await getPlanByCode(tx, 'TRIAL');
  const trialHours = trialPlan.trialHours ?? 48;
  const trialEndsAt = new Date(Date.now() + trialHours * 60 * 60 * 1000);

  const [row] = await tx
    .insert(subscriptions)
    .values({
      tenantId,
      planId: trialPlan.id,
      status: 'TRIALING',
      trialEndsAt,
    })
    .returning();

  if (!row) throw new Error('Falha ao iniciar o trial.');
  return row;
}

/**
 * Contagem de uso por recurso. Cada chave conta o que efetivamente consome o
 * limite do plano:
 *   - customers/pets/services/users: registros ATIVOS (desativar libera cota)
 *   - appointments: TODO agendamento ja criado, incluindo cancelados -- o
 *     limite do trial e uma cota de experimentacao, nao um teto de agenda
 *     ativa, entao cancelar um agendamento nao devolve a cota.
 */
async function computeUsage(tx: Transaction, tenantId: string): Promise<UsageDto> {
  const countActive = async (table: typeof customers | typeof pets | typeof services | typeof users) => {
    const [row] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.active, true), isNull(table.deletedAt)));
    return toCount(row?.value);
  };

  const customersUsed = await countActive(customers);
  const petsUsed = await countActive(pets);
  const servicesUsed = await countActive(services);
  const usersUsed = await countActive(users);
  const [appointmentsRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(appointments)
    .where(eq(appointments.tenantId, tenantId));

  return {
    customers: { used: customersUsed, limit: null },
    pets: { used: petsUsed, limit: null },
    appointments: { used: toCount(appointmentsRow?.value), limit: null },
    services: { used: servicesUsed, limit: null },
    users: { used: usersUsed, limit: null },
  };
}

function applyLimits(usage: UsageDto, limits: PlanDto['limits']): UsageDto {
  const withLimit = (entry: UsageEntry, limit: number | null): UsageEntry => ({
    used: entry.used,
    limit,
  });
  return {
    customers: withLimit(usage.customers, limits.customers),
    pets: withLimit(usage.pets, limits.pets),
    appointments: withLimit(usage.appointments, limits.appointments),
    services: withLimit(usage.services, limits.services),
    users: withLimit(usage.users, limits.users),
  };
}

function computeAccess(
  subscription: typeof subscriptions.$inferSelect,
): { blocked: boolean; reason: AccessBlockReason | null } {
  const now = Date.now();

  switch (subscription.status) {
    case 'ACTIVE':
      return { blocked: false, reason: null };
    case 'TRIALING': {
      const expired = subscription.trialEndsAt !== null && subscription.trialEndsAt.getTime() <= now;
      return expired ? { blocked: true, reason: 'TRIAL_EXPIRED' } : { blocked: false, reason: null };
    }
    case 'PAST_DUE':
      // Periodo de graca: o acesso continua enquanto cobramos de novo.
      return { blocked: false, reason: null };
    case 'CANCELLED': {
      const ended =
        subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd.getTime() <= now;
      return ended
        ? { blocked: true, reason: 'SUBSCRIPTION_CANCELLED' }
        : { blocked: false, reason: null };
    }
    case 'EXPIRED':
      return { blocked: true, reason: 'SUBSCRIPTION_EXPIRED' };
    default:
      return { blocked: true, reason: 'SUBSCRIPTION_EXPIRED' };
  }
}

function computeTrialInfo(
  subscription: typeof subscriptions.$inferSelect,
): BillingStatusDto['trial'] {
  if (subscription.status !== 'TRIALING' || !subscription.trialEndsAt) {
    return { active: false, endsAt: null, hoursRemaining: null };
  }
  const msRemaining = subscription.trialEndsAt.getTime() - Date.now();
  return {
    active: msRemaining > 0,
    endsAt: toIsoRequired(subscription.trialEndsAt),
    hoursRemaining: Math.max(0, Math.ceil(msRemaining / (60 * 60 * 1000))),
  };
}

export async function getBillingStatus(
  tx: Transaction,
  context: TenantContext,
): Promise<BillingStatusDto> {
  const { subscription, plan } = await getSubscriptionWithPlan(tx, context.tenantId);
  const rawUsage = await computeUsage(tx, context.tenantId);

  return {
    plan: toPlanDto(plan),
    subscription: toSubscriptionDto(subscription, plan.code),
    usage: applyLimits(rawUsage, plan.limits),
    trial: computeTrialInfo(subscription),
    access: computeAccess(subscription),
  };
}

export function hasFeature(plan: PlanDto, feature: FeatureKey): boolean {
  return plan.features.includes(feature);
}

/**
 * Barreira de escrita. Chamada no INICIO de toda operacao de criacao ou
 * atualizacao de negocio (clientes, pets, servicos, agendamentos, usuarios).
 * Leitura nunca passa por aqui -- os dados do tenant continuam visiveis
 * mesmo com o acesso bloqueado, e e assim que a pagina de upgrade consegue
 * dizer "seus dados continuam salvos".
 */
export async function assertActiveAccess(tx: Transaction, context: TenantContext): Promise<void> {
  const { subscription } = await getSubscriptionWithPlan(tx, context.tenantId);
  const { blocked, reason } = computeAccess(subscription);

  if (blocked) {
    throw new ForbiddenError(
      reason === 'TRIAL_EXPIRED'
        ? 'Seu periodo de teste terminou. Assine um plano para continuar.'
        : 'Sua assinatura nao esta ativa. Atualize o pagamento ou assine um plano para continuar.',
      ErrorCode.SUBSCRIPTION_REQUIRED,
      { reason },
    );
  }
}

/**
 * Barreira de limite. Conta o uso ATUAL (dentro da mesma transacao da
 * escrita, o que fecha a janela de corrida: duas criacoes simultaneas no
 * ultimo slot livre serializam pela mesma conexao/transacao e a segunda ve o
 * efeito da primeira).
 */
export async function assertWithinLimit(
  tx: Transaction,
  context: TenantContext,
  limitKey: LimitKey,
): Promise<void> {
  const { plan } = await getSubscriptionWithPlan(tx, context.tenantId);
  const limit = plan.limits[limitKey];
  if (limit === null) return; // ilimitado

  const usage = await computeUsage(tx, context.tenantId);
  const used = usage[limitKey].used;

  if (used >= limit) {
    throw new ConflictError(
      `Voce atingiu o limite de ${limit} ${LIMIT_KEY_LABELS[limitKey].toLowerCase()} do plano ${plan.name}. Faca upgrade para continuar.`,
      ErrorCode.LIMIT_REACHED,
      { limitKey, limit, used },
    );
  }
}

/**
 * Inicia o checkout no BillingProvider configurado.
 *
 * Sem provider real configurado (o padrao), o provider devolve um estado
 * explicito de "nao configurado" -- NUNCA fingimos uma URL de checkout.
 */
export async function startCheckout(
  tx: Transaction,
  context: TenantContext,
  planCode: 'PRO',
): Promise<CheckoutResultDto> {
  const targetPlan = await getPlanByCode(tx, planCode);
  const provider = getBillingProvider();

  await recordAudit(tx, context, {
    action: AuditAction.SUBSCRIPTION_CHECKOUT_REQUESTED,
    entity: AuditEntity.SUBSCRIPTION,
    metadata: { planCode },
  });

  if (!provider.configured) {
    return {
      checkoutUrl: null,
      message:
        'O checkout de pagamento ainda nao foi configurado nesta instalacao. ' +
        'Fale com o suporte para assinar o plano PRO.',
    };
  }

  const session = await provider.createCheckoutSession({
    tenantId: context.tenantId,
    planCode: targetPlan.code,
    priceCents: targetPlan.priceCents,
  });

  return { checkoutUrl: session.checkoutUrl, message: 'Redirecionando para o checkout.' };
}

/**
 * Aplica um evento vindo do webhook do provider de pagamento.
 *
 * Esta e a UNICA porta pela qual uma assinatura passa a ACTIVE. O frontend
 * nunca marca a propria assinatura como paga -- ele so reflete o que esta
 * funcao gravou.
 */
export async function applyBillingWebhookEvent(
  tx: Transaction,
  event: {
    tenantId: string;
    status: SubscriptionDto['status'];
    planCode?: 'TRIAL' | 'PRO';
    currentPeriodEnd?: string | null;
    provider?: string;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  },
): Promise<void> {
  const patch: Partial<typeof subscriptions.$inferInsert> = {
    status: event.status,
    currentPeriodEnd: event.currentPeriodEnd ? new Date(event.currentPeriodEnd) : null,
  };
  if (event.provider) patch.provider = event.provider;
  if (event.providerCustomerId) patch.providerCustomerId = event.providerCustomerId;
  if (event.providerSubscriptionId) patch.providerSubscriptionId = event.providerSubscriptionId;

  if (event.planCode) {
    const plan = await getPlanByCode(tx, event.planCode);
    patch.planId = plan.id;
  }

  await tx.update(subscriptions).set(patch).where(eq(subscriptions.tenantId, event.tenantId));

  // Evento de sistema, sem usuario associado -- mesmo caminho usado para
  // login que falhou e pedido de recuperacao de senha.
  await recordAnonymousAudit(
    tx,
    { tenantId: event.tenantId, userId: null },
    {
      action: AuditAction.SUBSCRIPTION_UPDATED,
      entity: AuditEntity.SUBSCRIPTION,
      metadata: { status: event.status, planCode: event.planCode ?? null },
    },
  );
}

/** Codigo de erro do Postgres para violacao de constraint UNIQUE. */
const UNIQUE_VIOLATION_CODE = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

export interface RawBillingEvent {
  provider: string;
  /** Identificador do evento NO PROVIDER -- a chave de idempotencia. */
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Nulo quando o evento ainda nao pode ser associado a um tenant. */
  tenantId: string | null;
}

/**
 * Registra um evento de webhook de forma idempotente.
 *
 * Devolve `null` quando o evento JA HAVIA sido recebido antes (reentrega --
 * comportamento normal de qualquer gateway de pagamento, que reenvia ate
 * receber 2xx). Nesse caso o chamador nao deve processar nada de novo: a
 * unicidade de `(provider, event_id)` no banco e a UNICA fonte de verdade
 * sobre "ja vimos isso", sem nenhuma logica de deduplicacao em memoria.
 */
export async function recordBillingEvent(
  tx: Transaction,
  event: RawBillingEvent,
): Promise<BillingEventRow | null> {
  try {
    const [row] = await tx
      .insert(billingEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId,
        payload: event.payload,
      })
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

export async function markBillingEventProcessed(tx: Transaction, eventRowId: string): Promise<void> {
  await tx
    .update(billingEvents)
    .set({ status: 'PROCESSED', processedAt: new Date() })
    .where(eq(billingEvents.id, eventRowId));
}

export async function markBillingEventFailed(
  tx: Transaction,
  eventRowId: string,
  errorMessage: string,
): Promise<void> {
  await tx
    .update(billingEvents)
    .set({ status: 'FAILED', processedAt: new Date(), errorMessage })
    .where(eq(billingEvents.id, eventRowId));
}
