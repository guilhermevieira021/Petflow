import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, notesSchema, phoneSchema, slugSchema, uuidSchema } from './common.js';
import { petSpeciesSchema, type PetSpecies } from './pet.js';

/**
 * Agendamento publico (/agendar/:slug).
 *
 * O tutor envia uma SOLICITACAO; o pet shop aceita (vira agendamento pelo
 * fluxo normal) ou recusa. As respostas publicas nunca carregam dado de
 * cliente, pet ou agendamento -- somente o perfil publico do pet shop, os
 * servicos ativos e horarios LIVRES.
 */

export const publicSlugParamSchema = z.object({ slug: slugSchema });

export interface PublicBookingProfileDto {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  timezone: string;
  maxDaysAhead: number;
  services: { id: string; name: string; description: string | null; durationMinutes: number; price: number }[];
}

export const publicAvailabilityQuerySchema = z.object({
  serviceId: uuidSchema,
  date: isoDateSchema,
});
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;

export interface PublicAvailabilityDto {
  date: string;
  /** Horarios de inicio livres, em ISO UTC. */
  slots: string[];
  /** Explica dias sem horario (fechado, fora da janela, lotado). */
  reason: 'OPEN' | 'CLOSED_DAY' | 'OUT_OF_RANGE' | 'FULL';
}

export const createBookingRequestInputSchema = z
  .object({
    serviceId: uuidSchema,
    startsAt: isoDateTimeSchema,
    customerName: z.string({ required_error: 'Informe seu nome.' }).trim().min(2, 'Informe seu nome.').max(120),
    customerPhone: phoneSchema,
    petName: z.string({ required_error: 'Informe o nome do pet.' }).trim().min(1, 'Informe o nome do pet.').max(80),
    petSpecies: petSpeciesSchema,
    notes: notesSchema.pipe(z.string().max(500, 'Use no maximo 500 caracteres.').nullable()),
    /** Honeypot anti-bot: campo invisivel que deve chegar vazio. */
    website: z.string().max(0).optional(),
  })
  .strict();
export type CreateBookingRequestInput = z.infer<typeof createBookingRequestInputSchema>;

export interface PublicBookingRequestResultDto {
  status: 'PENDING';
  startsAt: string;
  serviceName: string;
  message: string;
}

// -----------------------------------------------------------------------------
// Lado do pet shop
// -----------------------------------------------------------------------------

export const BookingRequestStatus = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' } as const;
export type BookingRequestStatus = (typeof BookingRequestStatus)[keyof typeof BookingRequestStatus];

export const BOOKING_REQUEST_STATUS_LABELS: Record<BookingRequestStatus, string> = {
  PENDING: 'Aguardando',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
};

export const listBookingRequestsQuerySchema = z.object({
  status: z.nativeEnum(BookingRequestStatus).default('PENDING'),
});
export type ListBookingRequestsQuery = z.infer<typeof listBookingRequestsQuerySchema>;

export interface BookingRequestDto {
  id: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerPhone: string;
  petName: string;
  petSpecies: PetSpecies;
  notes: string | null;
  status: BookingRequestStatus;
  /** Cliente ja cadastrado com este telefone (sugestao para o aceite). */
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  appointmentId: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export const rejectBookingRequestInputSchema = z
  .object({ reason: z.string().trim().max(300).optional().nullable() })
  .strict();
export type RejectBookingRequestInput = z.infer<typeof rejectBookingRequestInputSchema>;

export interface BookingSettingsDto {
  enabled: boolean;
  slug: string;
  /** Caminho publico relativo (o frontend monta a URL completa). */
  path: string;
}
