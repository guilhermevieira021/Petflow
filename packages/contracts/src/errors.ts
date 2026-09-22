/**
 * Codigos de erro estaveis da API.
 *
 * O frontend NUNCA deve depender da mensagem (ela pode mudar/ser traduzida),
 * apenas do `code`. A mensagem ja vem pronta para exibicao ao usuario final.
 */
export const ErrorCode = {
  // 400
  BAD_REQUEST: 'BAD_REQUEST',
  // 401
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  // 403
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  INVALID_CSRF_TOKEN: 'INVALID_CSRF_TOKEN',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  // 409
  CONFLICT: 'CONFLICT',
  EMAIL_ALREADY_USED: 'EMAIL_ALREADY_USED',
  SLUG_ALREADY_USED: 'SLUG_ALREADY_USED',
  TIME_SLOT_TAKEN: 'TIME_SLOT_TAKEN',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  LIMIT_REACHED: 'LIMIT_REACHED',
  // 422
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  // 500 / 503
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Detalhe de erro por campo, para o frontend destacar o input correto. */
export interface FieldError {
  field: string;
  message: string;
}

/** Envelope unico de erro da API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Presente apenas em VALIDATION_ERROR. */
    fields?: FieldError[];
    /** Correlaciona o erro exibido com o log do servidor. */
    requestId?: string;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return false;
  return typeof (candidate as { code?: unknown }).code === 'string';
}
