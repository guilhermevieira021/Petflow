import {
  AuditAction,
  AuditEntity,
  ErrorCode,
  type ConnectWhatsappEmbeddedInput,
  type ConnectWhatsappManualInput,
  type WhatsappConnectionDto,
  type WhatsappSetupDto,
  type WhatsappTestResultDto,
} from '@petflow/contracts';
import { eq, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { BusinessRuleError, ConflictError, NotFoundError, ServiceUnavailableError } from '../../core/errors.js';
import { toIso } from '../../core/serialization.js';
import { openSecret, parseEncryptionKey, sealSecret, SecretBoxError } from '../../core/secret-box.js';
import type { Transaction } from '../../db/client.js';
import { withTenant, type TenantContext } from '../../db/context.js';
import { whatsappConnections } from '../../db/schema/index.js';
import {
  exchangeEmbeddedSignupCode,
  fetchPhoneNumber,
  getMetaAppConfig,
  graphVersion,
  MetaGraphError,
  subscribeAppToWaba,
} from '../../integrations/whatsapp/meta-graph.js';
import {
  CloudApiProvider,
  getMetaFetch,
  getWhatsappProviderOverride,
  LINK_ONLY_PROVIDER,
  type WhatsappProvider,
} from '../../integrations/whatsapp/whatsapp.provider.js';
import { recordAudit } from '../audit/audit.service.js';

/**
 * WhatsApp Business POR PET SHOP.
 *
 * Cada tenant conecta o proprio numero pela WhatsApp Business Platform
 * oficial (Embedded Signup, ou IDs + token de usuario de sistema). O token e
 * guardado criptografado e so e aberto na hora de enviar, dentro do servidor.
 * O provider de envio e SEMPRE resolvido pelo tenant da mensagem: uma
 * mensagem do pet shop A nunca sai pelo numero do pet shop B.
 */

let keyOverride: Buffer | null | undefined;

function encryptionKey(): Buffer | null {
  return keyOverride !== undefined ? keyOverride : parseEncryptionKey(env.WHATSAPP_TOKEN_ENCRYPTION_KEY);
}

/** Somente testes. `undefined` volta a ler do ambiente. */
export function setWhatsappEncryptionKeyForTests(key: Buffer | null | undefined): void {
  keyOverride = key;
}

type ConnectionRow = typeof whatsappConnections.$inferSelect;

function toDto(row: ConnectionRow | null): WhatsappConnectionDto {
  if (!row || row.status === 'DISCONNECTED') {
    return {
      status: 'NOT_CONNECTED',
      method: null,
      displayPhoneNumber: null,
      verifiedName: null,
      phoneNumberId: null,
      wabaId: null,
      tokenHint: null,
      cloudApiReady: false,
      connectedAt: null,
      lastCheckedAt: toIso(row?.lastCheckedAt ?? null),
      lastError: null,
    };
  }
  return {
    status: row.status,
    method: row.connectionMethod,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    tokenHint: row.tokenLast4 ? `••••${row.tokenLast4}` : null,
    cloudApiReady: row.cloudApiReady,
    connectedAt: toIso(row.connectedAt),
    lastCheckedAt: toIso(row.lastCheckedAt),
    lastError: row.lastError,
  };
}

async function findRow(tx: Transaction, context: TenantContext): Promise<ConnectionRow | null> {
  const [row] = await tx.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, context.tenantId)).limit(1);
  return row ?? null;
}

export async function getConnection(tx: Transaction, context: TenantContext): Promise<WhatsappConnectionDto> {
  return toDto(await findRow(tx, context));
}

export function getSetup(): WhatsappSetupDto {
  const app = getMetaAppConfig();
  return {
    embeddedSignup: {
      available: Boolean(app.appId && app.appSecret && app.embeddedSignupConfigId),
      appId: app.appId,
      configId: app.embeddedSignupConfigId,
      graphVersion: graphVersion(),
    },
    storageReady: encryptionKey() !== null,
    webhookConfigured: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET),
  };
}

function requireKey(): Buffer {
  const key = encryptionKey();
  if (!key) {
    throw new ServiceUnavailableError(
      'Conexão do WhatsApp indisponível: o servidor ainda não tem a chave de criptografia configurada (WHATSAPP_TOKEN_ENCRYPTION_KEY).',
    );
  }
  return key;
}

/** Valida na Meta, inscreve o webhook e grava a conexao (so a gravacao e transacional). */
async function finalizeConnection(
  context: TenantContext,
  params: { method: 'EMBEDDED_SIGNUP' | 'MANUAL'; wabaId: string; phoneNumberId: string; token: string },
): Promise<WhatsappConnectionDto> {
  const key = requireKey();

  let info;
  try {
    info = await fetchPhoneNumber(params.phoneNumberId, params.token);
  } catch (error) {
    throw new BusinessRuleError(
      `Não foi possível validar o número na Meta. Confira os dados e as permissões do token. (${error instanceof MetaGraphError ? error.message : 'erro'})`,
    );
  }
  // Inscricao nos webhooks: sem ela nao ha "entregue/lida", mas o envio funciona.
  let subscribeError: string | null = null;
  try {
    await subscribeAppToWaba(params.wabaId, params.token);
  } catch (error) {
    subscribeError = `Webhook não inscrito: ${error instanceof MetaGraphError ? error.message : 'erro'}`.slice(0, 500);
  }

  return withTenant(context.tenantId, async (tx) => {
    // O numero ja pertence a outro pet shop? (a funcao so devolve o tenant)
    const owner = await tx.execute<{ tenant_id: string | null }>(
      sql`SELECT whatsapp_tenant_by_phone_number_id(${params.phoneNumberId}) AS tenant_id`,
    );
    const ownerTenant = owner.rows[0]?.tenant_id ?? null;
    if (ownerTenant && ownerTenant !== context.tenantId) {
      throw new ConflictError('Este número de WhatsApp já está conectado a outro pet shop.', ErrorCode.CONFLICT);
    }

    const values = {
      status: 'CONNECTED' as const,
      connectionMethod: params.method,
      wabaId: params.wabaId,
      phoneNumberId: params.phoneNumberId,
      displayPhoneNumber: info.displayPhoneNumber,
      verifiedName: info.verifiedName,
      cloudApiReady: info.platformType === 'CLOUD_API',
      accessTokenCiphertext: sealSecret(params.token, key),
      tokenLast4: params.token.slice(-4),
      connectedBy: context.userId,
      connectedAt: new Date(),
      disconnectedAt: null,
      lastCheckedAt: new Date(),
      lastError: subscribeError,
    };
    await tx
      .insert(whatsappConnections)
      .values({ tenantId: context.tenantId, ...values })
      .onConflictDoUpdate({ target: whatsappConnections.tenantId, set: values });

    await recordAudit(tx, context, {
      action: AuditAction.WHATSAPP_CONNECTED,
      entity: AuditEntity.WHATSAPP_CONNECTION,
      entityId: null,
      metadata: { method: params.method, phoneNumberId: params.phoneNumberId, wabaId: params.wabaId },
    });
    return toDto(await findRow(tx, context));
  });
}

/** Embedded Signup (fluxo oficial da Meta para SaaS): o frontend envia o `code`. */
export async function connectWithEmbeddedSignup(
  context: TenantContext,
  input: ConnectWhatsappEmbeddedInput,
): Promise<WhatsappConnectionDto> {
  requireKey();
  if (!getSetup().embeddedSignup.available) {
    throw new ServiceUnavailableError('A conexão automática com a Meta ainda não foi configurada no Petflow.');
  }
  let token: string;
  try {
    token = await exchangeEmbeddedSignupCode(input.code);
  } catch (error) {
    throw new BusinessRuleError(
      `A Meta não concluiu a conexão. Tente de novo. (${error instanceof MetaGraphError ? error.message : 'erro'})`,
    );
  }
  return finalizeConnection(context, { method: 'EMBEDDED_SIGNUP', wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, token });
}

/** Conexao manual (avancado): IDs + token de usuario de sistema. */
export async function connectManually(context: TenantContext, input: ConnectWhatsappManualInput): Promise<WhatsappConnectionDto> {
  return finalizeConnection(context, {
    method: 'MANUAL',
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    token: input.accessToken,
  });
}

/** Testa a conexao na Meta com o token guardado e registra o resultado. */
export async function testConnection(context: TenantContext): Promise<WhatsappTestResultDto> {
  const key = requireKey();
  const row = await withTenant(context.tenantId, (tx) => findRow(tx, context));
  if (!row || row.status === 'DISCONNECTED' || !row.accessTokenCiphertext) throw new NotFoundError('Conexão do WhatsApp');

  let ok = true;
  let message: string;
  let patch: Partial<typeof whatsappConnections.$inferInsert>;
  try {
    const info = await fetchPhoneNumber(row.phoneNumberId, openSecret(row.accessTokenCiphertext, key));
    const ready = info.platformType === 'CLOUD_API';
    patch = {
      status: 'CONNECTED',
      displayPhoneNumber: info.displayPhoneNumber,
      verifiedName: info.verifiedName,
      cloudApiReady: ready,
      lastError: null,
    };
    message = ready
      ? 'Conexão funcionando: a Meta confirmou o número.'
      : 'A Meta confirmou o número, mas ele ainda não está registrado na Cloud API. Conclua o registro no painel da Meta para enviar mensagens.';
  } catch (error) {
    ok = false;
    const reason = error instanceof MetaGraphError || error instanceof SecretBoxError ? error.message : 'erro desconhecido';
    patch = { status: 'ERROR', lastError: `Teste falhou: ${reason}`.slice(0, 500) };
    message = `A Meta não confirmou a conexão: ${reason}`;
  }

  const connection = await withTenant(context.tenantId, async (tx) => {
    await tx
      .update(whatsappConnections)
      .set({ ...patch, lastCheckedAt: new Date() })
      .where(eq(whatsappConnections.tenantId, context.tenantId));
    return getConnection(tx, context);
  });
  return { ok, message, connection };
}

export async function disconnect(tx: Transaction, context: TenantContext): Promise<WhatsappConnectionDto> {
  const row = await findRow(tx, context);
  if (!row || row.status === 'DISCONNECTED') throw new NotFoundError('Conexão do WhatsApp');
  await tx
    .update(whatsappConnections)
    .set({ status: 'DISCONNECTED', accessTokenCiphertext: null, tokenLast4: null, disconnectedAt: new Date(), lastError: null })
    .where(eq(whatsappConnections.tenantId, context.tenantId));
  await recordAudit(tx, context, {
    action: AuditAction.WHATSAPP_DISCONNECTED,
    entity: AuditEntity.WHATSAPP_CONNECTION,
    entityId: null,
    metadata: { phoneNumberId: row.phoneNumberId },
  });
  return getConnection(tx, context);
}

/**
 * Provider de envio DO PET SHOP. Sem conexao (ou sem chave para abrir o
 * token), devolve o provider "link": nada e enviado e a mensagem fica
 * registrada como nao enviada.
 */
export async function getTenantWhatsappProvider(tx: Transaction, tenantId: string): Promise<WhatsappProvider> {
  const override = getWhatsappProviderOverride();
  if (override) return override;
  const key = encryptionKey();
  if (!key) return LINK_ONLY_PROVIDER;
  const [row] = await tx.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, tenantId)).limit(1);
  if (!row || row.status === 'DISCONNECTED' || !row.accessTokenCiphertext) return LINK_ONLY_PROVIDER;
  try {
    return new CloudApiProvider(
      { apiUrl: env.WHATSAPP_API_URL, accessToken: openSecret(row.accessTokenCiphertext, key), phoneNumberId: row.phoneNumberId },
      getMetaFetch(),
    );
  } catch {
    return LINK_ONLY_PROVIDER;
  }
}

/** Mesmo que acima, fora de uma transacao (rotas, despacho apos o commit). */
export function resolveTenantWhatsappProvider(tenantId: string): Promise<WhatsappProvider> {
  return withTenant(tenantId, (tx) => getTenantWhatsappProvider(tx, tenantId));
}
