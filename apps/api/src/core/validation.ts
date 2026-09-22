import type { FieldError } from '@petflow/contracts';
import { z } from 'zod';
import { ValidationError } from './errors.js';

/** Converte o erro do Zod no formato de campos que o frontend consome. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || '_root',
    message: issue.message,
  }));
}

/**
 * Valida e retorna o dado tipado, ou lanca ValidationError (422).
 * Usado em rotas e servicos -- nunca confiamos no payload cru.
 */
export function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(toFieldErrors(result.error));
  }
  return result.data;
}
