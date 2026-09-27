import { z } from 'zod';
import { isoDateSchema, notesSchema, uuidSchema } from './common.js';

/** Historico clinico do pet: vacinas, vermifugos, medicamentos e observacoes. */

export const PetHealthType = {
  VACCINE: 'VACCINE',
  DEWORMER: 'DEWORMER',
  MEDICATION: 'MEDICATION',
  CLINICAL_NOTE: 'CLINICAL_NOTE',
} as const;
export type PetHealthType = (typeof PetHealthType)[keyof typeof PetHealthType];

export const PET_HEALTH_TYPE_LABELS: Record<PetHealthType, string> = {
  VACCINE: 'Vacina',
  DEWORMER: 'Vermífugo',
  MEDICATION: 'Medicamento',
  CLINICAL_NOTE: 'Observação clínica',
};

export const petHealthTypeSchema = z.nativeEnum(PetHealthType, {
  errorMap: () => ({ message: 'Tipo de registro inválido.' }),
});

/** Janela padrao de alerta: itens que vencem nos proximos N dias. */
export const HEALTH_DUE_SOON_DAYS = 30;

const healthBaseSchema = z.object({
  type: petHealthTypeSchema,
  title: z
    .string({ required_error: 'Informe o nome (ex.: V10, Antirrábica).' })
    .trim()
    .min(2, 'Informe ao menos 2 caracteres.')
    .max(120, 'Use no máximo 120 caracteres.'),
  occurredOn: isoDateSchema,
  nextDueOn: isoDateSchema.optional().nullable(),
  notes: notesSchema,
});

export const createPetHealthRecordInputSchema = healthBaseSchema
  .strict()
  .refine((data) => !data.nextDueOn || data.nextDueOn >= data.occurredOn, {
    message: 'A próxima data deve ser igual ou posterior à data do registro.',
    path: ['nextDueOn'],
  });
export type CreatePetHealthRecordInput = z.infer<typeof createPetHealthRecordInputSchema>;

export const updatePetHealthRecordInputSchema = healthBaseSchema
  .partial()
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  })
  .refine((data) => !data.nextDueOn || !data.occurredOn || data.nextDueOn >= data.occurredOn, {
    message: 'A próxima data deve ser igual ou posterior à data do registro.',
    path: ['nextDueOn'],
  });
export type UpdatePetHealthRecordInput = z.infer<typeof updatePetHealthRecordInputSchema>;

export const petHealthParamsSchema = z.object({ id: uuidSchema, recordId: uuidSchema });

export type HealthDueStatus = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NONE';

export interface PetHealthRecordDto {
  id: string;
  petId: string;
  type: PetHealthType;
  title: string;
  occurredOn: string;
  nextDueOn: string | null;
  /** Calculado no fuso do pet shop. */
  dueStatus: HealthDueStatus;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

export const listDueHealthQuerySchema = z.object({
  /** Inclui itens que vencem ate N dias a frente (e todos os vencidos). */
  withinDays: z.coerce.number().int().min(1).max(365).default(HEALTH_DUE_SOON_DAYS),
});
export type ListDueHealthQuery = z.infer<typeof listDueHealthQuerySchema>;

export interface DueHealthItemDto {
  recordId: string;
  petId: string;
  petName: string;
  customerId: string;
  customerName: string;
  customerWhatsapp: string | null;
  type: PetHealthType;
  title: string;
  nextDueOn: string;
  dueStatus: Extract<HealthDueStatus, 'OVERDUE' | 'DUE_SOON'>;
  /** Dias ate o vencimento (negativo = vencido ha N dias). */
  daysUntilDue: number;
}
