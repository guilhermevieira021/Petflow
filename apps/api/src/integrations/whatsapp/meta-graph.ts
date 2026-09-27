import { env } from '../../config/env.js';
import { getMetaFetch } from './whatsapp.provider.js';

/**
 * Chamadas a Graph API da Meta usadas para CONECTAR o WhatsApp Business de
 * um pet shop (WhatsApp Business Platform oficial). Erros viram MetaGraphError
 * com mensagem segura -- o token nunca entra em mensagem, log ou resposta.
 */

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

export interface MetaPhoneNumberInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** 'CLOUD_API' quando o numero ja esta registrado para envio pela Cloud API. */
  platformType: string | null;
}

export interface MetaAppConfig {
  appId: string | null;
  appSecret: string | null;
  embeddedSignupConfigId: string | null;
}

let appConfigOverride: MetaAppConfig | null = null;

/** App da Meta do Petflow (Tech Provider). Tudo do ambiente do servidor. */
export function getMetaAppConfig(): MetaAppConfig {
  return (
    appConfigOverride ?? {
      appId: env.META_APP_ID ?? null,
      appSecret: env.WHATSAPP_APP_SECRET ?? null,
      embeddedSignupConfigId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
    }
  );
}

/** Somente testes. */
export function setMetaAppConfigForTests(config: MetaAppConfig | null): void {
  appConfigOverride = config;
}

function baseUrl(): string {
  return env.WHATSAPP_API_URL.replace(/\/$/, '');
}

/** Versao da Graph (ex.: "v21.0"), para o SDK do Facebook no frontend. */
export function graphVersion(): string {
  return /\/(v\d+\.\d+)$/.exec(baseUrl())?.[1] ?? 'v21.0';
}

async function call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await getMetaFetch()(url, {
      ...rest,
      headers: { ...(headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new MetaGraphError(
      error instanceof Error && error.name === 'TimeoutError' ? 'A Meta nao respondeu a tempo.' : 'Nao foi possivel falar com a Meta.',
    );
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!response.ok || !payload) {
    const detail = payload?.error?.message ? `: ${payload.error.message}` : '';
    throw new MetaGraphError(`A Meta recusou a solicitacao (HTTP ${response.status})${detail}`.slice(0, 300), response.status);
  }
  return payload;
}

/**
 * Embedded Signup: troca o `code` devolvido ao frontend por um token de
 * negocio. Exige o app do Petflow configurado (META_APP_ID + WHATSAPP_APP_SECRET).
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const app = getMetaAppConfig();
  if (!app.appId || !app.appSecret) throw new MetaGraphError('App da Meta nao configurado no servidor.');
  const url = new URL(`${baseUrl()}/oauth/access_token`);
  url.searchParams.set('client_id', app.appId);
  url.searchParams.set('client_secret', app.appSecret);
  url.searchParams.set('code', code);
  const result = await call<{ access_token?: string }>(url.toString());
  if (!result.access_token) throw new MetaGraphError('A Meta nao devolveu o token de acesso.');
  return result.access_token;
}

/** Dados do numero (valida tambem que o token tem acesso a ele). */
export async function fetchPhoneNumber(phoneNumberId: string, token: string): Promise<MetaPhoneNumberInfo> {
  const url = `${baseUrl()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,platform_type`;
  const result = await call<{ display_phone_number?: string; verified_name?: string; platform_type?: string }>(url, { token });
  return {
    displayPhoneNumber: result.display_phone_number ?? null,
    verifiedName: result.verified_name ?? null,
    platformType: result.platform_type ?? null,
  };
}

/** Inscreve o app do Petflow nos webhooks desta conta (status entregue/lida). */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  await call(`${baseUrl()}/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', token });
}
