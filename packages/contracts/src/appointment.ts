import { z } from 'zod';
import {
  isoDateTimeSchema,
  moneySchema,
  notesSchema,
  paginationQuerySchema,
  sortOrderSchema,
  uuidSchema,
} from './common.js';

export const AppointmentStatus = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const appointmentStatusSchema = z.nativeEnum(AppointmentStatus, {
  errorMap: () => ({ message: 'Status de agendamento invalido.' }),
});

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  IN_PROGRESS: 'Em atendimento',
  COMPLETED: 'Concluido',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Nao compareceu',
};

/**
 * Maquina de estados do atendimento.
 *
 * Estados finais (COMPLETED, CANCELLED, NO_SHOW) nao possuem transicao de
 * saida: um atendimento cancelado NUNCA volta a IN_PROGRESS. Para reabrir,
 * cria-se um novo agendamento -- assim o historico nunca e reescrito.
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

/** Status que ocupam a agenda e portanto disputam horario. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
];

/** Status que contam como atendimento efetivamente realizado. */
export const REALIZED_STATUSES: readonly AppointmentStatus[] = ['COMPLETED'];

export const createAppointmentInputSchema = z
  .object({
    customerId: uuidSchema,
    petId: uuidSchema,
    serviceId: uuidSchema,
    professionalId: uuidSchema.optional().nullable(),
    startsAt: isoDateTimeSchema,
    /** Se omitido, calculado a partir da duracao do servico. */
    endsAt: isoDateTimeSchema.optional().nullable(),
    /** Se omitido, herda o preco do servico no momento do agendamento. */
    price: moneySchema.optional().nullable(),
    notes: notesSchema,
    /** Permite agendar no passado (lancamento retroativo). Exige permissao. */
    allowPast: z.boolean().optional().default(false),
  })
  .strict();
export type CreateAppointmentInput = z.infer<typeof createAppointmentInputSchema>;

export const updateAppointmentInputSchema = z
  .object({
    petId: uuidSchema.optional(),
    serviceId: uuidSchema.optional(),
    professionalId: uuidSchema.optional().nullable(),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional().nullable(),
    price: moneySchema.optional().nullable(),
    notes: notesSchema,
    allowPast: z.boolean().optional().default(false),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentInputSchema>;

export const changeAppointmentStatusInputSchema = z
  .object({
    status: appointmentStatusSchema,
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();
export type ChangeAppointmentStatusInput = z.infer<typeof changeAppointmentStatusInputSchema>;

export const listAppointmentsQuerySchema = paginationQuerySchema.extend({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  status: z
    .union([appointmentStatusSchema, z.array(appointmentStatusSchema)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
  customerId: uuidSchema.optional(),
  petId: uuidSchema.optional(),
  serviceId: uuidSchema.optional(),
  professionalId: uuidSchema.optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['startsAt', 'createdAt']).default('startsAt'),
  order: sortOrderSchema,
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export interface AppointmentDto {
  id: string;
  tenantId: string;
  customerId: string;
  petId: string;
  serviceId: string;
  professionalId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  price: number;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Agendamento enriquecido para exibicao na agenda (evita N+1 no frontend). */
export interface AppointmentDetailDto extends AppointmentDto {
  customerName: string;
  customerWhatsapp: string | null;
  petName: string;
  serviceName: string;
  serviceColor: string | null;
  professionalName: string | null;
}
