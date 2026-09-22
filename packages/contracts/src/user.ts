import { z } from 'zod';
import { emailSchema, nameSchema, paginationQuerySchema, passwordSchema } from './common.js';
import { type Role, roleSchema } from './rbac.js';

export const createUserInputSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: roleSchema,
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
    /** Redefinicao de senha pelo administrador. */
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Representacao publica de usuario. Sem hash de senha, sempre. */
export interface UserDto {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
