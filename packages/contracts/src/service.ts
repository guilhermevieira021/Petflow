import { z } from 'zod';
import {
  moneySchema,
  nameSchema,
  paginationQuerySchema,
  sortOrderSchema,
} from './common.js';

export const createServiceInputSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().max(500).optional().nullable(),
    durationMinutes: z
      .number({ required_error: 'Informe a duracao do servico.' })
      .int('A duracao deve ser em minutos inteiros.')
      .min(5, 'A duracao minima e de 5 minutos.')
      .max(600, 'A duracao maxima e de 600 minutos.'),
    price: moneySchema,
    color: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Informe uma cor valida.')
      .optional()
      .nullable(),
  })
  .strict();
export type CreateServiceInput = z.infer<typeof createServiceInputSchema>;

export const updateServiceInputSchema = createServiceInputSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateServiceInput = z.infer<typeof updateServiceInputSchema>;

export const listServicesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: z.enum(['name', 'price', 'durationMinutes']).default('name'),
  order: sortOrderSchema,
});
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

export interface ServiceDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  color: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
