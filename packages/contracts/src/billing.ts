import { z } from 'zod';

/**
 * Planos, assinatura, trial e entitlements.
 *
 * Regra de ouro deste arquivo: NENHUM numero de limite ou preco e hardcoded
 * fora daqui/do banco. O frontend consulta `GET /api/billing/status` e exibe
 * o que o backend disser -- nunca calcula "10 clientes" por conta propria.
 */

export const PlanCode = { TRIAL: 'TRIAL', PRO: 'PRO' } as const;
export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

export const planCodeSchema = z.nativeEnum(PlanCode);

/** Recursos numericos limitados por plano. `null` = ilimitado. */
export const LimitKey = {
  CUSTOMERS: 'customers',
  PETS: 'pets',
  APPOINTMENTS: 'appointments',
  SERVICES: 'services',
  USERS: 'users',
} as const;
export type LimitKey = (typeof LimitKey)[keyof typeof LimitKey];

export const LIMIT_KEY_LABELS: Record<LimitKey, string> = {
  customers: 'Clientes',
  pets: 'Pets',
  appointments: 'Agendamentos',
  services: 'Servicos',
  users: 'Usuarios',
};

/** Recursos liga/desliga por plano -- checados via hasFeature(), nunca `if (plan === 'PRO')`. */
export const FeatureKey = {
  ADVANCED_REPORTS: 'advanced_reports',
  AUTOMATION: 'automation',
  UNLIMITED_RETENTION_WINDOW: 'unlimited_retention_window',
} as const;
export type FeatureKey = (typeof FeatureKey)[keyof typeof FeatureKey];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  advanced_reports: 'Relatorios avancados',
  automation: 'Automacao de mensagens',
  unlimited_retention_window: 'Recuperacao de clientes sem limite de periodo',
};

export type PlanLimits = Record<LimitKey, number | null>;

export interface PlanDto {
  id: string;
  code: PlanCode;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: 'MONTHLY' | null;
  /** Duracao do trial em horas. `null` para planos pagos. */
  trialHours: number | null;
  limits: PlanLimits;
  features: FeatureKey[];
}

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Pagamento pendente',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
};

export interface SubscriptionDto {
  id: string;
  tenantId: string;
  planCode: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface UsageEntry {
  used: number;
  /** `null` = ilimitado. */
  limit: number | null;
}

export type UsageDto = Record<LimitKey, UsageEntry>;

export type AccessBlockReason = 'TRIAL_EXPIRED' | 'SUBSCRIPTION_EXPIRED' | 'SUBSCRIPTION_CANCELLED';

export interface TrialInfo {
  active: boolean;
  endsAt: string | null;
  hoursRemaining: number | null;
}

/** Payload combinado consumido por TrialBanner, UsageIndicator e /billing. */
export interface BillingStatusDto {
  plan: PlanDto;
  subscription: SubscriptionDto;
  usage: UsageDto;
  trial: TrialInfo;
  access: {
    blocked: boolean;
    reason: AccessBlockReason | null;
  };
}

export const checkoutInputSchema = z.object({
  planCode: z.literal(PlanCode.PRO),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export interface CheckoutResultDto {
  /** URL de checkout do provider. `null` quando nenhum provider esta configurado. */
  checkoutUrl: string | null;
  message: string;
}

export function usageRatio(entry: UsageEntry): number {
  if (entry.limit === null || entry.limit === 0) return 0;
  return entry.used / entry.limit;
}

export function isLimitReached(entry: UsageEntry): boolean {
  return entry.limit !== null && entry.used >= entry.limit;
}
