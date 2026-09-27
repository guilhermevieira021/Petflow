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
  errorMap: () => ({ message: 'Unidade inválida.' }),
});

/** Quantidade de estoque: ate 3 casas decimais. */
export const quantitySchema = z
  .number({ required_error: 'Informe a quantidade.', invalid_type_error: 'Informe uma quantidade numérica.' })
  .max(999_999_999.999, 'Quantidade acima do limite permitido.')
  .refine((value) => Number.isFinite(value) && Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6, {
    message: 'A quantidade deve ter no máximo 3 casas decimais.',
  });

const skuSchema = z
  .string()
  .trim()
  .max(64, 'O SKU deve ter no máximo 64 caracteres.')
  .regex(/^[A-Za-z0-9._/-]*$/, 'Use apenas letras, números e . _ / - no SKU.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

/** Codigo de barras (EAN/GTIN ou interno) -- preparado para leitor no futuro. */
const barcodeSchema = z
  .string()
  .trim()
  .max(64, 'O código de barras deve ter no máximo 64 caracteres.')
  .regex(/^[0-9A-Za-z-]*$/, 'Código de barras inválido.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value))
  .refine((value) => value === null || value.length >= 4, 'Código de barras inválido.');

/**
 * Normaliza o que chega de um leitor de codigo de barras (teclado HID) ou da
 * digitacao: remove espacos, quebras de linha e caracteres de controle que
 * alguns leitores enviam junto (prefixo/sufixo). O codigo e um IDENTIFICADOR:
 * nada (nome, marca, preco, peso) e extraido dele.
 */
export function normalizeScannedCode(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f\s]/g, '');
}

const descriptionSchema = z
  .string()
  .trim()
  .max(1000, 'A descrição deve ter no máximo 1000 caracteres.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

const categorySchema = z
  .string()
  .trim()
  .max(60, 'A categoria deve ter no máximo 60 caracteres.')
  .optional()
  .nullable()
  .transform((value) => (value == null || value === '' ? null : value));

export const createProductInputSchema = z
  .object({
    name: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(120),
    sku: skuSchema,
    barcode: barcodeSchema,
    brandId: uuidSchema.optional().nullable(),
    supplierId: uuidSchema.optional().nullable(),
    description: descriptionSchema,
    category: categorySchema,
    unit: productUnitSchema.default('UN'),
    salePrice: moneySchema,
    costPrice: moneySchema.optional().nullable(),
    minStock: quantitySchema.refine((value) => value >= 0, 'O estoque mínimo não pode ser negativo.').default(0),
    trackStock: z.boolean().default(true),
    /** Saldo inicial. Vira uma movimentacao de ENTRADA -- nunca um numero solto. */
    initialStock: quantitySchema.refine((value) => value >= 0, 'O saldo inicial não pode ser negativo.').default(0),
    /**
     * De onde veio o cadastro. BARCODE = produto desconhecido bipado na
     * entrada rapida: o saldo inicial e registrado como entrada de mercadoria
     * lida pelo leitor (mesma transacao do cadastro).
     */
    entrySource: z.enum(['MANUAL', 'BARCODE']).default('MANUAL'),
  })
  .strict();
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

/** Saldo NAO e editavel aqui: use uma movimentacao. */
export const updateProductInputSchema = z
  .object({
    name: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(120).optional(),
    sku: skuSchema,
    barcode: barcodeSchema,
    brandId: uuidSchema.optional().nullable(),
    supplierId: uuidSchema.optional().nullable(),
    description: descriptionSchema,
    category: categorySchema,
    unit: productUnitSchema.optional(),
    salePrice: moneySchema.optional(),
    costPrice: moneySchema.optional().nullable(),
    minStock: quantitySchema.refine((value) => value >= 0, 'O estoque mínimo não pode ser negativo.').optional(),
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
  brandId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
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
  brandId: string | null;
  brandName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  description: string | null;
  category: string | null;
  unit: ProductUnit;
  salePrice: number;
  costPrice: number | null;
  /** Margem sobre a venda (fracao): (preco - custo) / preco. null sem custo. */
  margin: number | null;
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
  /** Devolucao de mercadoria por cliente (volta ao estoque). */
  RETURN: 'RETURN',
  /** Perda (extravio, vencimento). */
  LOSS: 'LOSS',
  /** Avaria (produto danificado). */
  DAMAGE: 'DAMAGE',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  IN: 'Entrada',
  OUT: 'Saída',
  ADJUSTMENT: 'Ajuste',
  SALE: 'Venda',
  SALE_CANCELLATION: 'Cancelamento de venda',
  RETURN: 'Devolução',
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
};

/** Como a movimentacao foi registrada. */
export const StockMovementSource = {
  MANUAL: 'MANUAL',
  BARCODE: 'BARCODE',
  SALE: 'SALE',
  PRODUCT_CREATION: 'PRODUCT_CREATION',
} as const;
export type StockMovementSource = (typeof StockMovementSource)[keyof typeof StockMovementSource];

export const STOCK_MOVEMENT_SOURCE_LABELS: Record<StockMovementSource, string> = {
  MANUAL: 'Manual',
  BARCODE: 'Leitor de código',
  SALE: 'PDV (caixa)',
  PRODUCT_CREATION: 'Cadastro do produto',
};

/**
 * Movimentacao MANUAL. SALE e SALE_CANCELLATION so nascem do modulo de
 * vendas, nunca desta rota.
 *   - IN/OUT: `quantity` positiva (o sinal vem do tipo).
 *   - ADJUSTMENT: `quantity` e o NOVO saldo contado (inventario fisico).
 */
export const createStockMovementInputSchema = z
  .object({
    type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'RETURN', 'LOSS', 'DAMAGE'], { errorMap: () => ({ message: 'Tipo de movimentação inválido.' }) }),
    quantity: quantitySchema.refine((value) => value >= 0, 'A quantidade não pode ser negativa.'),
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
  source: z.nativeEnum(StockMovementSource).optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

export interface StockMovementDto {
  id: string;
  productId: string;
  productName: string;
  /** Codigo de barras no momento da movimentacao (ou o codigo lido). */
  barcode: string | null;
  type: StockMovementType;
  source: StockMovementSource;
  /** Variacao assinada: positiva entra, negativa sai. */
  quantity: number;
  balanceBefore: number;
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

// -----------------------------------------------------------------------------
// Leitor de codigo de barras / entrada rapida
// -----------------------------------------------------------------------------

export const productLookupQuerySchema = z.object({
  code: z
    .string({ required_error: 'Informe o código.' })
    .transform(normalizeScannedCode)
    .pipe(z.string().min(1, 'Informe o código.').max(64, 'Código muito longo.')),
});
export type ProductLookupQuery = z.infer<typeof productLookupQuerySchema>;

/**
 * Sugestao vinda de uma base GLOBAL de produtos (futura). Hoje nenhuma base
 * esta ligada, entao `catalogSuggestion` e sempre null -- o sistema nunca
 * inventa nome, marca ou preco a partir do codigo.
 */
export interface CatalogProductSuggestionDto {
  source: string;
  name: string;
  brandName: string | null;
  category: string | null;
  variant: string | null;
}

export type ProductLookupDto =
  | { status: 'FOUND'; code: string; matchedBy: 'BARCODE' | 'SKU'; product: ProductDto }
  | { status: 'NOT_FOUND'; code: string; catalogSuggestion: CatalogProductSuggestionDto | null };

/**
 * Motivo de uma saida manual. Vira o TIPO da movimentacao:
 * LOSS -> Perda, DAMAGE -> Avaria, ADJUSTMENT -> Ajuste (negativo),
 * SALE/OTHER -> Saida com o motivo no historico.
 *
 * SALE aqui e "venda registrada fora do caixa": baixa o estoque, mas NAO
 * entra no "Recebido" (isso so acontece pelo modulo de Vendas).
 */
export const StockExitReason = {
  SALE: 'SALE',
  LOSS: 'LOSS',
  DAMAGE: 'DAMAGE',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER',
} as const;
export type StockExitReason = (typeof StockExitReason)[keyof typeof StockExitReason];

export const STOCK_EXIT_REASON_LABELS: Record<StockExitReason, string> = {
  SALE: 'Venda',
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
  ADJUSTMENT: 'Ajuste',
  OTHER: 'Outro',
};

/**
 * Lancamento em lote (entrada rapida / saida). Tudo ou nada: se um item
 * falhar (ex.: saida maior que o saldo), nenhum saldo muda.
 */
export const stockEntryInputSchema = z
  .object({
    type: z.enum(['IN', 'OUT', 'RETURN'], { errorMap: () => ({ message: 'Tipo de lançamento inválido.' }) }),
    source: z.enum(['MANUAL', 'BARCODE']).default('MANUAL'),
    /** Obrigatorio na saida (OUT). */
    exitReason: z.nativeEnum(StockExitReason).optional(),
    /** Entrada: grava o custo desta compra como custo atual do produto. */
    updateCostPrice: z.boolean().default(false),
    reason: notesSchema,
    items: z
      .array(
        z
          .object({
            productId: uuidSchema,
            quantity: quantitySchema.refine((value) => value > 0, 'A quantidade deve ser maior que zero.'),
            unitCost: moneySchema.optional().nullable(),
            /** Codigo efetivamente lido pelo leitor (auditoria). */
            scannedCode: z.string().transform(normalizeScannedCode).pipe(z.string().max(64)).optional().nullable(),
          })
          .strict(),
      )
      .min(1, 'Adicione ao menos um produto.')
      .max(200, 'Lance no máximo 200 produtos por vez.'),
  })
  .strict()
  .refine((data) => data.type !== 'OUT' || !!data.exitReason, {
    message: 'Informe o motivo da saída.',
    path: ['exitReason'],
  })
  .refine((data) => data.exitReason !== 'OTHER' || !!data.reason, {
    message: 'Descreva o motivo da saída.',
    path: ['reason'],
  });
export type StockEntryInput = z.infer<typeof stockEntryInputSchema>;

export interface StockEntryResultDto {
  movements: number;
  products: ProductDto[];
}

// -----------------------------------------------------------------------------
// Categorias
// -----------------------------------------------------------------------------

/** Sugestoes para acelerar o cadastro. A categoria continua texto livre. */
export const PRODUCT_CATEGORY_SUGGESTIONS = [
  'Ração',
  'Petiscos',
  'Medicamentos',
  'Antiparasitários',
  'Higiene',
  'Banho e tosa',
  'Areia sanitária',
  'Brinquedos',
  'Acessórios',
  'Camas e casinhas',
  'Coleiras e guias',
  'Aquarismo',
  'Aves e roedores',
] as const;

export interface ProductCategoryDto {
  name: string;
  products: number;
  lowStock: number;
}

export const renameCategoryInputSchema = z
  .object({
    from: z.string().trim().min(1).max(60),
    to: z.string().trim().min(1, 'Informe o novo nome.').max(60, 'A categoria deve ter no máximo 60 caracteres.'),
  })
  .strict();
export type RenameCategoryInput = z.infer<typeof renameCategoryInputSchema>;

// -----------------------------------------------------------------------------
// Indicadores de estoque (dashboard)
// -----------------------------------------------------------------------------

export interface InventoryTopProductDto {
  productId: string;
  name: string;
  unit: ProductUnit;
  /** Quantidade vendida no periodo (vendas nao canceladas). */
  quantitySold: number;
  revenue: number;
  stockQuantity: number;
  /**
   * Giro no periodo: vendido / (vendido + saldo atual) -- fracao do estoque
   * disponivel que saiu por venda. null quando o produto nao controla estoque.
   */
  turnover: number | null;
}

export interface InventoryInsightsDto {
  summary: InventorySummaryDto;
  periodDays: number;
  topSelling: InventoryTopProductDto[];
  topTurnover: InventoryTopProductDto[];
  lowStock: ProductDto[];
  outOfStock: ProductDto[];
}
