import { z } from 'zod';
import {
  emailSchema,
  hexColorSchema,
  nameSchema,
  optionalPhoneSchema,
} from './common.js';

/** Fuso horario IANA. Lista curta e suficiente para o Brasil no MVP. */
export const BRAZIL_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
] as const;

export type Timezone = (typeof BRAZIL_TIMEZONES)[number];

export function isTimezone(value: string): value is Timezone {
  return (BRAZIL_TIMEZONES as readonly string[]).includes(value);
}

export const timezoneSchema = z
  .enum(BRAZIL_TIMEZONES, { errorMap: () => ({ message: 'Fuso horario invalido.' }) })
  .default('America/Sao_Paulo');

export const addressSchema = z
  .object({
    street: z.string().trim().max(160).optional().nullable(),
    number: z.string().trim().max(20).optional().nullable(),
    complement: z.string().trim().max(80).optional().nullable(),
    district: z.string().trim().max(80).optional().nullable(),
    city: z.string().trim().max(80).optional().nullable(),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .length(2, 'UF deve ter 2 letras.')
      .optional()
      .nullable(),
    zipCode: z
      .string()
      .transform((value) => value.replace(/\D/g, ''))
      .refine((value) => value === '' || value.length === 8, 'CEP invalido.')
      .optional()
      .nullable(),
  })
  .strict();
export type Address = z.infer<typeof addressSchema>;

/** Configuracoes de automacao do tenant (secao "Automacao" das configuracoes). */
export const tenantSettingsSchema = z
  .object({
    /** Dias sem agendamento para o cliente ser considerado inativo. */
    inactiveCustomerDays: z
      .number()
      .int()
      .min(7, 'Use no minimo 7 dias.')
      .max(365, 'Use no maximo 365 dias.')
      .default(45),
    /** Horas de antecedencia do lembrete de agendamento. */
    appointmentReminderHours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    /** Se o tenant autorizou o envio automatico de mensagens. Padrao: NAO. */
    automationEnabled: z.boolean().default(false),
    /** Horario de funcionamento padrao, usado para validar agendamentos. */
    businessHours: z
      .object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario invalido.').default('08:00'),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario invalido.').default('18:00'),
        /** 0 = domingo ... 6 = sabado */
        weekdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
      })
      .default({ start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5, 6] }),
  })
  .strict();
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const DEFAULT_TENANT_SETTINGS: TenantSettings = tenantSettingsSchema.parse({});

export const updateTenantInputSchema = z
  .object({
    name: nameSchema.optional(),
    logoUrl: z.string().trim().url('Informe uma URL valida para o logo.').max(500).optional().nullable(),
    primaryColor: hexColorSchema.optional(),
    phone: optionalPhoneSchema.optional(),
    whatsapp: optionalPhoneSchema.optional(),
    email: emailSchema.optional().nullable(),
    address: addressSchema.optional().nullable(),
    timezone: timezoneSchema.optional(),
    settings: tenantSettingsSchema.partial().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateTenantInput = z.infer<typeof updateTenantInputSchema>;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: Address | null;
  timezone: Timezone;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}
