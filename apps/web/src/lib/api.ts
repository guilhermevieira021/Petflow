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

const CSRF_COOKIE = 'petflow_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

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

function readCsrfToken(): string | null {
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
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

  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(`/api${path}`, options.query), {
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
