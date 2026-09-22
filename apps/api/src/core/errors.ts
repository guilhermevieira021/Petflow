import { ErrorCode, type FieldError } from '@petflow/contracts';

/**
 * Hierarquia unica de erros da aplicacao.
 *
 * Servicos lancam AppError; o error handler HTTP traduz para status + corpo.
 * Nenhuma camada de dominio conhece Fastify, e nenhum stack trace chega ao
 * usuario.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly fields?: FieldError[];
  /** Dados extras para o log do servidor. NUNCA vao para a resposta HTTP. */
  readonly logContext?: Record<string, unknown>;
  /** true = erro previsto de negocio; false = falha inesperada. */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options: {
      fields?: FieldError[];
      logContext?: Record<string, unknown>;
      cause?: unknown;
      expected?: boolean;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    if (options.fields) this.fields = options.fields;
    if (options.logContext) this.logContext = options.logContext;
    this.expected = options.expected ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Requisicao invalida.', logContext?: Record<string, unknown>) {
    super(ErrorCode.BAD_REQUEST, message, 400, { logContext });
  }
}

export class ValidationError extends AppError {
  constructor(fields: FieldError[], message = 'Alguns campos precisam ser corrigidos.') {
    super(ErrorCode.VALIDATION_ERROR, message, 422, { fields });
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, logContext?: Record<string, unknown>) {
    super(ErrorCode.BUSINESS_RULE_VIOLATION, message, 422, { logContext });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(
    message = 'Sua sessao expirou. Faca login novamente.',
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
  ) {
    super(code, message, 401);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // Mensagem deliberadamente generica: nao revela se o email existe.
    super(ErrorCode.INVALID_CREDENTIALS, 'Email ou senha incorretos.', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'Voce nao possui permissao para realizar esta acao.',
    code: ErrorCode = ErrorCode.FORBIDDEN,
    logContext?: Record<string, unknown>,
  ) {
    super(code, message, 403, { logContext });
  }
}

export class InactiveAccountError extends AppError {
  constructor() {
    super(
      ErrorCode.ACCOUNT_INACTIVE,
      'Seu acesso foi desativado. Fale com o responsavel pelo pet shop.',
      403,
    );
  }
}

/**
 * Usado tambem quando o recurso existe em OUTRO tenant.
 *
 * Devolver 404 (e nao 403) nesse caso e deliberado: um 403 confirmaria a
 * existencia do registro e permitiria enumeracao entre tenants.
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Registro', logContext?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, `${resource} nao encontrado.`, 404, { logContext });
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
    logContext?: Record<string, unknown>,
  ) {
    super(code, message, 409, { logContext });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, logContext?: Record<string, unknown>) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, 503, { logContext });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Muitas tentativas. Aguarde um instante e tente novamente.') {
    super(ErrorCode.RATE_LIMITED, message, 429);
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown, logContext?: Record<string, unknown>) {
    super(
      ErrorCode.INTERNAL_ERROR,
      'Ocorreu um erro inesperado. Tente novamente em instantes.',
      500,
      { cause, logContext, expected: false },
    );
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
