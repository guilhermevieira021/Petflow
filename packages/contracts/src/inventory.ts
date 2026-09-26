import { z } from 'zod';
import { moneySchema, notesSchema, paginationQuerySchema, sortOrderSchema, uuidSchema } from './common.js';

/**
 * Produtos e estoque do pet shop.
 *
 * Quantidades aceitam 3 casas decimais porque racao a granel e vendida por kg.
 * O saldo nunca e editado direto: toda mudanca e uma MOVIMENTACAO registrada
 * (entrada, saida, ajuste, venda, cancelamento de venda).
 */

export const ProductUnit = { UN: 'UN', KG: 'KG', L: 'L' } as const;
export type ProductUnit = (typeof ProductUnit)[keyof typeof ProductUnit];

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  UN: 'Unidade',
  KG: 'Quilo',
  L: 'Litro',
};

export const productUnitSchema = z.nativeEnum(ProductUnit, {
  errorMap: () => ({ message: 'Unidade invalida.' }),
});

/** Quantidade de estoque: ate 3 casas decimais. */
export const quantitySchema = z
  .number({ required_error: 'Informe a quantidade.', invalid_type_error: 'Informe uma quantidade numerica.' })
  .max(999_999_999.999, 'Quantidade acima do limite permitido.')
  .refine((value) => Number.isFinite(value) && Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6, {
    message: 'A quantidade deve ter no maximo 3 casas decimais.',
  });

const skuSchema = z
  .string()
  .trim()
  .max(64, 'O SKU deve ter no maximo 64 caracteres.')
  .regex(/^[A-Za-z0-9._/-]*$/, 'Use apenas letras, numeros e . _ / - no SKU.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

/** Codigo de barras (EAN/GTIN ou interno) -- preparado para leitor no futuro. */
const barcodeSchema = z
  .string()
  .trim()
  .max(64, 'O codigo de barras deve ter no maximo 64 caracteres.')
  .regex(/^[0-9A-Za-z-]*$/, 'Codigo de barras invalido.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value))
  .refine((value) => value === null || value.length >= 4, 'Codigo de barras invalido.');

const categorySchema = z
  .string()
  .trim()
  .max(60, 'A categoria deve ter no maximo 60 caracteres.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

export const createProductInputSchema = z
  .object({
    name: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(120),
    sku: skuSchema,
    barcode: barcodeSchema,
    category: categorySchema,
    unit: productUnitSchema.default('UN'),
    salePrice: moneySchema,
    costPrice: moneySchema.optional().nullable(),
    minStock: quantitySchema.refine((value) => value >= 0, 'O estoque minimo nao pode ser negativo.').default(0),
    trackStock: z.boolean().default(true),
    /** Saldo inicial. Vira uma movimentacao de ENTRADA -- nunca um numero solto. */
    initialStock: quantitySchema.refine((value) => value >= 0, 'O saldo inicial nao pode ser negativo.').default(0),
  })
  .strict();
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

/** Saldo NAO e editavel aqui: use uma movimentacao. */
export const updateProductInputSchema = z
  .object({
    name: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(120).optional(),
    sku: skuSchema,
    barcode: barcodeSchema,
    category: categorySchema,
    unit: productUnitSchema.optional(),
    salePrice: moneySchema.optional(),
    costPrice: moneySchema.optional().nullable(),
    minStock: quantitySchema.refine((value) => value >= 0, 'O estoque minimo nao pode ser negativo.').optional(),
    trackStock: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  /** Busca por nome, SKU ou codigo de barras. */
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  /** Somente produtos com saldo <= estoque minimo. */
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  sort: z.enum(['name', 'stockQuantity', 'createdAt']).default('name'),
  order: sortOrderSchema,
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export interface ProductDto {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: ProductUnit;
  salePrice: number;
  costPrice: number | null;
  stockQuantity: number;
  minStock: number;
  trackStock: boolean;
  /** Controla estoque e o saldo esta no minimo ou abaixo dele. */
  lowStock: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Movimentacoes
// -----------------------------------------------------------------------------

export const StockMovementType = {
  IN: 'IN',
  OUT: 'OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  SALE: 'SALE',
  SALE_CANCELLATION: 'SALE_CANCELLATION',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  IN: 'Entrada',
  OUT: 'Saída',
  ADJUSTMENT: 'Ajuste',
  SALE: 'Venda',
  SALE_CANCELLATION: 'Cancelamento de venda',
};

/**
 * Movimentacao MANUAL. SALE e SALE_CANCELLATION so nascem do modulo de
 * vendas, nunca desta rota.
 *   - IN/OUT: `quantity` positiva (o sinal vem do tipo).
 *   - ADJUSTMENT: `quantity` e o NOVO saldo contado (inventario fisico).
 */
export const createStockMovementInputSchema = z
  .object({
    type: z.enum(['IN', 'OUT', 'ADJUSTMENT'], { errorMap: () => ({ message: 'Tipo de movimentacao invalido.' }) }),
    quantity: quantitySchema.refine((value) => value >= 0, 'A quantidade nao pode ser negativa.'),
    unitCost: moneySchema.optional().nullable(),
    reason: notesSchema,
  })
  .strict()
  .refine((data) => data.type === 'ADJUSTMENT' || data.quantity > 0, {
    message: 'A quantidade deve ser maior que zero.',
    path: ['quantity'],
  });
export type CreateStockMovementInput = z.infer<typeof createStockMovementInputSchema>;

export const listStockMovementsQuerySchema = paginationQuerySchema.extend({
  productId: uuidSchema.optional(),
  type: z.nativeEnum(StockMovementType).optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

export interface StockMovementDto {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  /** Variacao assinada: positiva entra, negativa sai. */
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  reason: string | null;
  saleId: string | null;
  saleNumber: number | null;
  userName: string | null;
  createdAt: string;
}

export interface InventorySummaryDto {
  activeProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  /** Soma de saldo x custo, apenas de produtos com custo informado. */
  stockCostValue: number;
  /** Produtos ativos que controlam estoque mas nao tem custo informado. */
  productsWithoutCost: number;
}
