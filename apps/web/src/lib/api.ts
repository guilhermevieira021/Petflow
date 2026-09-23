import { ErrorCode, isApiErrorBody, type ApiErrorBody, type FieldError } from '@petflow/contracts';

/**
 * Cliente HTTP da aplicacao.
 *
 * Responsabilidades:
 *   - enviar o cookie de sessao (credentials: 'include');
 *   - anexar o token CSRF nas mutacoes;
 *   - transformar QUALQUER falha num ApiError tipado, com mensagem em
 *     portugues pronta para exibicao.
 *
 * Nenhum componente chama fetch diretamente. Isso mantem o tratamento de erro
 * em um lugar so e impede que uma tela invente a sua propria mensagem.
 */

const CSRF_HEADER = 'X-CSRF-Token';

/**
 * URL base da API. Vazia em desenvolvimento (fetch relativo `/api/...`,
 * encaminhado pelo proxy do Vite para a API local na mesma origem -- ver
 * vite.config.ts). Em producao, `VITE_API_URL` aponta para o host separado
 * onde a API roda (frontend e API sao origens diferentes por arquitetura).
 */
const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: FieldError[];
  readonly requestId: string | undefined;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    fields?: FieldError[];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.fields = params.fields ?? [];
    this.requestId = params.requestId;
  }

  /** Mensagem do campo, para exibir abaixo do input correspondente. */
  fieldError(field: string): string | undefined {
    return this.fields.find((item) => item.field === field)?.message;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/**
 * Token CSRF em memoria, atualizado por `setCsrfToken` sempre que a sessao
 * (login/registro/GET /auth/me) entrega um novo -- ver session.tsx.
 *
 * NAO le mais de um cookie: `petflow_csrf` e definido pela API, e API e
 * frontend sao origens diferentes (Railway/Vercel). `document.cookie`
 * executado na origem do frontend nunca enxerga um cookie definido por uma
 * origem diferente -- isso independe de httpOnly/SameSite, e a causa raiz de
 * "Sessao invalida" ter passado a aparecer em toda mutacao autenticada assim
 * que a API saiu para um dominio proprio.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function apiRequest<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (method !== 'GET' && csrfToken) {
    headers[CSRF_HEADER] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(`${API_BASE_URL}/api${path}`, options.query), {
      method,
      headers,
      // Necessario para que o cookie httpOnly de sessao acompanhe a chamada.
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // Falha de rede: o servidor nem chegou a responder.
    throw new ApiError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Nao foi possivel conectar ao servidor. Verifique sua conexao.',
      status: 0,
      ...(cause instanceof Error ? {} : {}),
    });
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const raw = await response.text();
  const payload: unknown = raw ? safeParse(raw) : null;

  if (!response.ok) {
    throw toApiError(payload, response.status);
  }

  return payload as TResponse;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toApiError(payload: unknown, status: number): ApiError {
  if (isApiErrorBody(payload)) {
    const body = payload as ApiErrorBody;
    return new ApiError({
      code: body.error.code,
      message: body.error.message,
      status,
      ...(body.error.fields ? { fields: body.error.fields } : {}),
      ...(body.error.requestId ? { requestId: body.error.requestId } : {}),
    });
  }

  // Resposta fora do contrato (proxy, gateway, HTML de erro): nunca mostramos
  // o corpo cru ao usuario.
  return new ApiError({
    code: ErrorCode.INTERNAL_ERROR,
    message:
      status >= 500
        ? 'O servidor encontrou um problema. Tente novamente em instantes.'
        : 'Nao foi possivel completar a operacao.',
    status,
  });
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    apiRequest<T>(path, query ? { query } : {}),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
