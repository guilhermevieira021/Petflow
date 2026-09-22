import { z } from 'zod';

/**
 * Primitivos reutilizaveis. Toda mensagem de erro e escrita em portugues e
 * voltada ao usuario final -- o frontend exibe exatamente o que vem daqui.
 */

export const uuidSchema = z.string().uuid('Identificador invalido.');

export const idParamSchema = z.object({
  id: uuidSchema,
});
export type IdParam = z.infer<typeof idParamSchema>;

/** Nome de pessoa/empresa/pet: 2..120 chars, sem espacos nas pontas. */
export const nameSchema = z
  .string({ required_error: 'Informe o nome.' })
  .trim()
  .min(2, 'O nome deve ter ao menos 2 caracteres.')
  .max(120, 'O nome deve ter no maximo 120 caracteres.');

export const emailSchema = z
  .string({ required_error: 'Informe o email.' })
  .trim()
  .toLowerCase()
  .min(1, 'Informe o email.')
  .max(254, 'O email deve ter no maximo 254 caracteres.')
  .email('Informe um email valido.');

/**
 * Telefone brasileiro. Aceita o que o usuario digitar com mascara e normaliza
 * para digitos. Aceita 10 digitos (fixo) ou 11 (celular), com DDD valido.
 */
export const phoneSchema = z
  .string({ required_error: 'Informe o telefone.' })
  .transform((value) => value.replace(/\D/g, ''))
  .refine((digits) => digits.length === 10 || digits.length === 11, {
    message: 'Informe um telefone valido com DDD. Exemplo: (11) 98888-7777.',
  })
  .refine((digits) => Number(digits.slice(0, 2)) >= 11, {
    message: 'DDD invalido.',
  })
  .refine((digits) => digits.length === 10 || digits.startsWith('9', 2), {
    message: 'Celular deve comecar com 9 apos o DDD.',
  });

export const optionalPhoneSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value == null || value.trim() === '' ? null : value))
  .pipe(phoneSchema.nullable());

/** Senha: forca minima verificavel sem impor regras impossiveis de lembrar. */
export const passwordSchema = z
  .string({ required_error: 'Informe a senha.' })
  .min(8, 'A senha deve ter ao menos 8 caracteres.')
  .max(128, 'A senha deve ter no maximo 128 caracteres.')
  .refine((value) => /[a-zA-Z]/.test(value), {
    message: 'A senha deve conter ao menos uma letra.',
  })
  .refine((value) => /\d/.test(value), {
    message: 'A senha deve conter ao menos um numero.',
  });

/** Slug de tenant: usado em URL e subdominios futuros. */
export const slugSchema = z
  .string({ required_error: 'Informe o identificador.' })
  .trim()
  .toLowerCase()
  .min(3, 'O identificador deve ter ao menos 3 caracteres.')
  .max(48, 'O identificador deve ter no maximo 48 caracteres.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas letras minusculas, numeros e hifens.');

/** Cor hexadecimal para white-label. */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Informe uma cor valida. Exemplo: #2F6BFF.');

/** Valor monetario em reais, com no maximo 2 casas. */
export const moneySchema = z
  .number({ required_error: 'Informe o valor.', invalid_type_error: 'Informe um valor numerico.' })
  .nonnegative('O valor nao pode ser negativo.')
  .max(9_999_999.99, 'Valor acima do limite permitido.')
  .refine((value) => Number.isFinite(value) && Math.round(value * 100) === value * 100, {
    message: 'O valor deve ter no maximo 2 casas decimais.',
  });

/** Data/hora ISO 8601 com timezone. */
export const isoDateTimeSchema = z
  .string({ required_error: 'Informe a data e o horario.' })
  .datetime({ offset: true, message: 'Informe uma data e horario validos.' });

/** Data pura YYYY-MM-DD. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Informe uma data valida.');

export const notesSchema = z
  .string()
  .trim()
  .max(2000, 'As observacoes devem ter no maximo 2000 caracteres.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

// -----------------------------------------------------------------------------
// Paginacao
// -----------------------------------------------------------------------------

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Pagina invalida.').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'Tamanho de pagina invalido.')
    .max(PAGE_SIZE_MAX, `O tamanho de pagina deve ser no maximo ${PAGE_SIZE_MAX}.`)
    .default(PAGE_SIZE_DEFAULT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc');
export type SortOrder = z.infer<typeof sortOrderSchema>;

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

/** Helper de tipo para declarar o retorno paginado de um recurso. */
export function buildPagination(page: number, pageSize: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1 && total > 0,
  };
}
