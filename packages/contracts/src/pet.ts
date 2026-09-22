import { z } from 'zod';
import {
  isoDateSchema,
  nameSchema,
  notesSchema,
  paginationQuerySchema,
  sortOrderSchema,
  uuidSchema,
} from './common.js';

export const PetSpecies = {
  DOG: 'DOG',
  CAT: 'CAT',
  BIRD: 'BIRD',
  RODENT: 'RODENT',
  REPTILE: 'REPTILE',
  OTHER: 'OTHER',
} as const;
export type PetSpecies = (typeof PetSpecies)[keyof typeof PetSpecies];

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  DOG: 'Cachorro',
  CAT: 'Gato',
  BIRD: 'Ave',
  RODENT: 'Roedor',
  REPTILE: 'Reptil',
  OTHER: 'Outro',
};

export const petSpeciesSchema = z.nativeEnum(PetSpecies, {
  errorMap: () => ({ message: 'Informe uma especie valida.' }),
});

export const PetSex = { MALE: 'MALE', FEMALE: 'FEMALE', UNKNOWN: 'UNKNOWN' } as const;
export type PetSex = (typeof PetSex)[keyof typeof PetSex];

export const PET_SEX_LABELS: Record<PetSex, string> = {
  MALE: 'Macho',
  FEMALE: 'Femea',
  UNKNOWN: 'Nao informado',
};

export const petSexSchema = z
  .nativeEnum(PetSex, { errorMap: () => ({ message: 'Informe um sexo valido.' }) })
  .default('UNKNOWN');

export const createPetInputSchema = z
  .object({
    customerId: uuidSchema,
    name: nameSchema,
    species: petSpeciesSchema,
    breed: z.string().trim().max(80, 'Raca deve ter no maximo 80 caracteres.').optional().nullable(),
    sex: petSexSchema.optional(),
    birthDate: isoDateSchema.optional().nullable(),
    weightKg: z
      .number()
      .positive('O peso deve ser maior que zero.')
      .max(200, 'Peso acima do limite permitido.')
      .optional()
      .nullable(),
    color: z.string().trim().max(40).optional().nullable(),
    notes: notesSchema,
  })
  .strict();
export type CreatePetInput = z.infer<typeof createPetInputSchema>;

export const updatePetInputSchema = createPetInputSchema
  .omit({ customerId: true })
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdatePetInput = z.infer<typeof updatePetInputSchema>;

export const listPetsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  customerId: uuidSchema.optional(),
  species: petSpeciesSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sort: z.enum(['name', 'createdAt']).default('name'),
  order: sortOrderSchema,
});
export type ListPetsQuery = z.infer<typeof listPetsQuerySchema>;

export interface PetDto {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  species: PetSpecies;
  breed: string | null;
  sex: PetSex;
  birthDate: string | null;
  weightKg: number | null;
  color: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PetWithCustomerDto extends PetDto {
  customerName: string;
  customerWhatsapp: string | null;
  lastVisitAt: string | null;
}
