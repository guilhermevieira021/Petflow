import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, slugSchema, uuidSchema } from './common.js';
import { type Permission, type Role, roleSchema } from './rbac.js';
import type { BillingStatusDto } from './billing.js';

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Informe a senha.' }).min(1, 'Informe a senha.'),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Cadastro publico: cria o TENANT e o primeiro usuario (OWNER) numa unica
 * transacao. Nao existe caminho para criar usuario solto sem tenant.
 */
export const registerInputSchema = z.object({
  tenantName: nameSchema.describe('Nome do pet shop'),
  slug: slugSchema.optional(),
  userName: nameSchema.describe('Seu nome'),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const forgotPasswordInputSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

export const resetPasswordInputSchema = z
  .object({
    token: z.string().min(1, 'Token de recuperacao invalido.'),
    password: passwordSchema,
    passwordConfirmation: z.string().min(1, 'Confirme a senha.'),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'As senhas nao conferem.',
    path: ['passwordConfirmation'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    password: passwordSchema,
    passwordConfirmation: z.string().min(1, 'Confirme a nova senha.'),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'As senhas nao conferem.',
    path: ['passwordConfirmation'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

/** Identidade publica do usuario autenticado. NUNCA contem hash de senha. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Marca do tenant usada para white-label na interface. */
export interface TenantBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  timezone: string;
}

/** Payload de GET /api/auth/me -- tudo que o app precisa para montar a UI. */
export interface SessionPayload {
  user: AuthenticatedUser;
  tenant: TenantBranding;
  permissions: Permission[];
  onboarding: {
    completed: boolean;
    steps: OnboardingStep[];
  };
  /**
   * Snapshot do plano/assinatura no momento do login -- usado para pintar o
   * TrialBanner e decidir o redirecionamento inicial sem uma segunda chamada.
   * Telas que precisam de numeros atualizados (billing, indicadores de uso)
   * consultam GET /api/billing/status, que chama o mesmo servico.
   */
  billing: BillingStatusDto;
}

export interface OnboardingStep {
  key: 'tenant_profile' | 'services' | 'customers' | 'pets' | 'first_appointment' | 'team';
  label: string;
  done: boolean;
}

export const sessionUserIdSchema = uuidSchema;
export const authRoleSchema = roleSchema;
