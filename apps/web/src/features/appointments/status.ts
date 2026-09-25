import type { AppointmentStatus } from '@petflow/contracts';
import type { BadgeTone } from '@/components/ui/primitives';

/** Tom visual de cada status -- um unico lugar para agenda, dashboard e fichas. */
export const APPOINTMENT_STATUS_TONES: Record<AppointmentStatus, BadgeTone> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  IN_PROGRESS: 'brand',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
};

/** Cor da barra lateral do cartao de atendimento (mesma semantica dos badges). */
export const APPOINTMENT_STATUS_ACCENTS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'var(--color-border-strong)',
  CONFIRMED: 'var(--color-info)',
  IN_PROGRESS: 'var(--color-brand)',
  COMPLETED: 'var(--color-success)',
  CANCELLED: 'var(--color-danger)',
  NO_SHOW: 'var(--color-warning)',
};

export const APPOINTMENT_STATUS_ORDER: AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];
