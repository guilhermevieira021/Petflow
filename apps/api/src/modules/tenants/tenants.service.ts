import {
  AuditAction,
  AuditEntity,
  DEFAULT_TENANT_SETTINGS,
  isTimezone,
  tenantSettingsSchema,
  type OnboardingStep,
  type Tenant,
  type TenantBranding,
  type TenantSettings,
  type UpdateTenantInput,
} from '@petflow/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NotFoundError } from '../../core/errors.js';
import { toCount, toIsoRequired } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { appointments, customers, services, tenants, users } from '../../db/schema/index.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * Preenche lacunas de configuracoes vindas do banco com os padroes atuais.
 * Assim, adicionar uma chave nova em TenantSettings nao quebra tenants antigos.
 */
function normalizeSettings(raw: TenantSettings | null): TenantSettings {
  const parsed = tenantSettingsSchema.safeParse({ ...DEFAULT_TENANT_SETTINGS, ...(raw ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_TENANT_SETTINGS;
}

export async function getTenant(tx: Transaction, context: TenantContext): Promise<Tenant> {
  const [row] = await tx
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, context.tenantId), isNull(tenants.deletedAt)))
    .limit(1);

  if (!row) throw new NotFoundError('Pet shop');

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    address: row.address,
    // A coluna e TEXT; estreitamos com guard em vez de cast. Um fuso invalido
    // no banco (migracao antiga, import manual) vira o padrao em vez de
    // envenenar o calculo de "hoje" na agenda.
    timezone: isTimezone(row.timezone) ? row.timezone : 'America/Sao_Paulo',
    settings: normalizeSettings(row.settings),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export function toBranding(tenant: Tenant): TenantBranding {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    timezone: tenant.timezone,
  };
}

export async function updateTenant(
  tx: Transaction,
  context: TenantContext,
  input: UpdateTenantInput,
): Promise<Tenant> {
  const current = await getTenant(tx, context);

  const nextSettings = input.settings
    ? normalizeSettings({ ...current.settings, ...input.settings } as TenantSettings)
    : current.settings;

  const patch: Partial<typeof tenants.$inferInsert> = { settings: nextSettings };
  if (input.name !== undefined) patch.name = input.name;
  if (input.logoUrl !== undefined) patch.logoUrl = input.logoUrl;
  if (input.primaryColor !== undefined) patch.primaryColor = input.primaryColor;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp;
  if (input.email !== undefined) patch.email = input.email;
  if (input.address !== undefined) patch.address = input.address;
  if (input.timezone !== undefined) patch.timezone = input.timezone;

  // O WHERE por tenant_id e redundante sob RLS -- e permanece de proposito.
  // Defesa em profundidade nao e duplicacao.
  await tx.update(tenants).set(patch).where(eq(tenants.id, context.tenantId));

  await recordAudit(tx, context, {
    action: AuditAction.TENANT_UPDATED,
    entity: AuditEntity.TENANT,
    entityId: context.tenantId,
    metadata: { fields: Object.keys(input) },
  });

  return getTenant(tx, context);
}

/**
 * Progresso do onboarding, derivado do estado real do tenant.
 *
 * E derivado, e nao um campo booleano armazenado, porque estado derivado nunca
 * fica dessincronizado: se o dono apagar todos os servicos, o passo volta a
 * ficar pendente sozinho.
 */
export async function getOnboarding(
  tx: Transaction,
  context: TenantContext,
): Promise<{ completed: boolean; steps: OnboardingStep[] }> {
  const tenant = await getTenant(tx, context);

  const countRows = async (
    table: typeof services | typeof users | typeof customers,
  ): Promise<number> => {
    const [row] = await tx
      .select({ value: sql<string>`count(*)` })
      .from(table)
      .where(and(eq(table.tenantId, context.tenantId), isNull(table.deletedAt)));
    return toCount(row?.value);
  };

  // Sequencial de proposito: uma transacao ocupa UMA conexao, entao disparar
  // estas consultas em paralelo com Promise.all as serializaria de qualquer
  // forma -- ou pior, quebraria o protocolo do driver.
  const servicesCount = await countRows(services);
  const teamCount = await countRows(users);
  const customersCount = await countRows(customers);
  const [appointmentRow] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(appointments)
    .where(eq(appointments.tenantId, context.tenantId));

  const steps: OnboardingStep[] = [
    {
      key: 'tenant_profile',
      label: 'Complete os dados do pet shop',
      done: Boolean(tenant.phone ?? tenant.whatsapp),
    },
    { key: 'services', label: 'Cadastre seus servicos', done: servicesCount > 0 },
    { key: 'team', label: 'Adicione sua equipe', done: teamCount > 1 },
    { key: 'customers', label: 'Cadastre seus clientes', done: customersCount > 0 },
    {
      key: 'first_appointment',
      label: 'Faca o primeiro agendamento',
      done: toCount(appointmentRow?.value) > 0,
    },
  ];

  return { completed: steps.every((step) => step.done), steps };
}
