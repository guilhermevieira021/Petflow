import { ErrorCode, type ApiErrorBody } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../../core/errors.js';
import { toFieldErrors } from '../../core/validation.js';

/** Erros do proprio Fastify (parsing, rate limit) carregam statusCode. */
function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number' ? candidate : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tratamento global de erros.
 *
 * Contrato: o cliente SEMPRE recebe { error: { code, message } }. Stack trace,
 * SQL, nome de constraint e qualquer detalhe interno ficam no log do servidor
 * -- eles ajudam um atacante a mapear o sistema e nao ajudam o usuario em nada.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Recurso nao encontrado.',
        requestId: request.id,
      },
    };
    reply.status(404).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    // 1. Erros de dominio: previstos, com mensagem ja pronta para o usuario.
    if (isAppError(error)) {
      if (!error.expected) {
        request.log.error({ err: error, ...error.logContext }, 'Erro inesperado de aplicacao');
      } else {
        request.log.info({ code: error.code, ...error.logContext }, 'Erro de negocio');
      }

      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          requestId: request.id,
        },
      };
      return reply.status(error.statusCode).send(body);
    }

    // 2. Falha de validacao que escapou da rota.
    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Alguns campos precisam ser corrigidos.',
          fields: toFieldErrors(error),
          requestId: request.id,
        },
      };
      return reply.status(422).send(body);
    }

    const status = statusCodeOf(error);

    // 3. Rate limit do @fastify/rate-limit.
    if (status === 429) {
      const body: ApiErrorBody = {
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'Muitas tentativas. Aguarde um instante e tente novamente.',
          requestId: request.id,
        },
      };
      return reply.status(429).send(body);
    }

    // 4. JSON malformado e demais erros de parsing do proprio Fastify.
    if (status !== null && status >= 400 && status < 500) {
      request.log.info({ err: messageOf(error) }, 'Requisicao malformada');
      const body: ApiErrorBody = {
        error: {
          code: ErrorCode.BAD_REQUEST,
          message: 'Requisicao invalida.',
          requestId: request.id,
        },
      };
      return reply.status(status).send(body);
    }

    // 5. Qualquer outra coisa e bug nosso. Log completo no servidor,
    //    mensagem generica para o cliente.
    request.log.error({ err: error }, 'Erro nao tratado');

    const body: ApiErrorBody = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
        requestId: request.id,
      },
    };
    return reply.status(500).send(body);
  });
}

/** Re-exportado para os testes garantirem que o contrato nao mudou. */
export type { AppError };
