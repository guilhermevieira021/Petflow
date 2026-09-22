import { z } from 'zod';
import {
  emailSchema,
  isoDateSchema,
  nameSchema,
  notesSchema,
  optionalPhoneSchema,
  paginationQuerySchema,
  phoneSchema,
  sortOrderSchema,
} from './common.js';

/** Validacao de CPF com digitos verificadores (nao so formato). */
function isValidCpf(digits: string): boolean {
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calcCheckDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calcCheckDigit(9) === Number(digits[9]) && calcCheckDigit(10) === Number(digits[10]);
}

export const cpfSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .refine(isValidCpf, 'Informe um CPF valido.');

export const optionalCpfSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value == null || value.trim() === '' ? null : value))
  .pipe(cpfSchema.nullable());

export const createCustomerInputSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    /** Se omitido, assume o mesmo numero do telefone. */
    whatsapp: optionalPhoneSchema.optional(),
    email: z
      .string()
      .optional()
      .nullable()
      .transform((value) => (value == null || value.trim() === '' ? null : value))
      .pipe(emailSchema.nullable()),
    cpf: optionalCpfSchema.optional(),
    birthDate: isoDateSchema.optional().nullable(),
    notes: notesSchema,
  })
  .strict();
export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;

export const updateCustomerInputSchema = createCustomerInputSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export const customerSortSchema = z
  .enum(['name', 'createdAt', 'lastVisitAt'])
  .default('name');

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  /** Busca por nome, telefone, whatsapp ou email. */
  search: z.string().trim().max(120).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: customerSortSchema,
  order: sortOrderSchema,
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export interface CustomerDto {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  cpf: string | null;
  birthDate: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Cliente com os agregados exibidos na listagem e no perfil. */
export interface CustomerWithSummaryDto extends CustomerDto {
  petsCount: number;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  totalSpent: number;
  appointmentsCount: number;
}
