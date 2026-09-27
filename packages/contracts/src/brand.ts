import { z } from 'zod';

/**
 * Marcas.
 *
 * O catalogo nasce com marcas de REFERENCIA do mercado pet (somente nomes --
 * nenhum produto, preco ou codigo de barras e inventado) e e aberto: cada pet
 * shop cadastra as proprias marcas (ex.: uma racao regional). Marcas de
 * referencia sao so leitura; as proprias podem ser editadas e desativadas.
 */

export const BrandSegment = {
  FOOD: 'FOOD',
  HEALTH: 'HEALTH',
  HYGIENE: 'HYGIENE',
  ACCESSORIES: 'ACCESSORIES',
  LITTER: 'LITTER',
  AQUARIUM_BIRDS: 'AQUARIUM_BIRDS',
  GENERAL: 'GENERAL',
} as const;
export type BrandSegment = (typeof BrandSegment)[keyof typeof BrandSegment];

export const BRAND_SEGMENT_LABELS: Record<BrandSegment, string> = {
  FOOD: 'Alimentação e petiscos',
  HEALTH: 'Saúde e antiparasitários',
  HYGIENE: 'Higiene, banho e tosa',
  ACCESSORIES: 'Brinquedos e acessórios',
  LITTER: 'Areia sanitária',
  AQUARIUM_BIRDS: 'Aquarismo, aves e roedores',
  GENERAL: 'Geral',
};

export const brandSegmentSchema = z.nativeEnum(BrandSegment, {
  errorMap: () => ({ message: 'Segmento invalido.' }),
});

const brandNameSchema = z
  .string({ required_error: 'Informe o nome da marca.' })
  .trim()
  .min(1, 'Informe o nome da marca.')
  .max(80, 'O nome deve ter no maximo 80 caracteres.');

export const createBrandInputSchema = z
  .object({
    name: brandNameSchema,
    segment: brandSegmentSchema.default('GENERAL'),
  })
  .strict();
export type CreateBrandInput = z.infer<typeof createBrandInputSchema>;

export const updateBrandInputSchema = z
  .object({
    name: brandNameSchema.optional(),
    segment: brandSegmentSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateBrandInput = z.infer<typeof updateBrandInputSchema>;

export const listBrandsQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  segment: brandSegmentSchema.optional(),
  /** 'reference' = catalogo Petflow; 'own' = cadastradas pelo pet shop. */
  origin: z.enum(['all', 'reference', 'own']).default('all'),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListBrandsQuery = z.infer<typeof listBrandsQuerySchema>;

export interface BrandDto {
  id: string;
  name: string;
  segment: BrandSegment;
  /** true = catalogo de referencia Petflow (somente leitura). */
  isReference: boolean;
  active: boolean;
  /** Produtos DESTE pet shop associados a marca. */
  productCount: number;
}
