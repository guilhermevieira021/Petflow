import { z } from 'zod';
import { emailSchema, optionalPhoneSchema } from './common.js';

/** Fornecedores do pet shop (distribuidoras, representantes). Sempre do tenant. */

const supplierNameSchema = z
  .string({ required_error: 'Informe o nome do fornecedor.' })
  .trim()
  .min(2, 'O nome deve ter ao menos 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

const documentSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((digits) => digits === '' || digits.length === 11 || digits.length === 14, 'Informe um CPF (11) ou CNPJ (14 dígitos).')
  .transform((digits) => (digits === '' ? null : digits))
  .optional()
  .nullable();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value == null || value === '' ? null : value));

export const createSupplierInputSchema = z
  .object({
    name: supplierNameSchema,
    document: documentSchema,
    phone: optionalPhoneSchema.optional(),
    email: emailSchema.optional().nullable(),
    contactName: optionalText(120),
    notes: optionalText(1000),
  })
  .strict();
export type CreateSupplierInput = z.infer<typeof createSupplierInputSchema>;

export const updateSupplierInputSchema = z
  .object({
    name: supplierNameSchema.optional(),
    document: documentSchema,
    phone: optionalPhoneSchema.optional(),
    email: emailSchema.optional().nullable(),
    contactName: optionalText(120),
    notes: optionalText(1000),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateSupplierInput = z.infer<typeof updateSupplierInputSchema>;

export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export interface SupplierDto {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  notes: string | null;
  active: boolean;
  productCount: number;
  createdAt: string;
}
