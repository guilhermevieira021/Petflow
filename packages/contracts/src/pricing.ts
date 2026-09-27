import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Precificacao: preco SUGERIDO a partir do custo.
 *
 * REGRA: a sugestao e uma RECOMENDACAO calculada (custo + margem de
 * referencia), nunca um "preco de mercado". Nenhum preco externo e consultado
 * ou inventado. O dono sempre pode alterar.
 *
 * MARGEM x MARKUP -- nao confundir:
 *   margem (sobre a venda) = (preco - custo) / preco
 *   preco para uma margem   = custo / (1 - margem)
 *   markup (sobre o custo)  = (preco - custo) / custo
 * Ex.: custo R$ 60 com margem de 20% = R$ 75,00 (e NAO 60 x 1,20 = R$ 72,00,
 * que e markup de 20% -- margem de apenas 16,7%).
 */

/** Arredonda para centavos (meio para cima), sem ruido de ponto flutuante. */
export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Preco de venda que produz a margem (fracao 0..1) desejada sobre a venda. */
export function priceForMargin(cost: number, margin: number): number {
  if (!Number.isFinite(cost) || cost < 0) throw new RangeError('Custo invalido.');
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) throw new RangeError('A margem deve estar entre 0% e 99,99%.');
  return roundToCents(cost / (1 - margin));
}

/** Margem sobre a venda (fracao). null quando nao ha preco positivo ou custo. */
export function marginOf(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null || !(price > 0)) return null;
  return (price - cost) / price;
}

/** Markup sobre o custo (fracao). null quando nao ha custo positivo. */
export function markupOf(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null || !(cost > 0)) return null;
  return (price - cost) / cost;
}

// -----------------------------------------------------------------------------
// Referencias por categoria
// -----------------------------------------------------------------------------

/**
 * Faixas de margem de REFERENCIA (ponto de partida, nao regra). So existem
 * para racao seca fechada, onde ha referencia conhecida; para as demais
 * categorias o sistema nao inventa faixa -- usa o historico do proprio pet
 * shop ou pede a margem desejada.
 */
export const PricingProfile = {
  DRY_FOOD_STANDARD: 'DRY_FOOD_STANDARD',
  DRY_FOOD_PREMIUM: 'DRY_FOOD_PREMIUM',
  DRY_FOOD_SUPER_PREMIUM: 'DRY_FOOD_SUPER_PREMIUM',
} as const;
export type PricingProfile = (typeof PricingProfile)[keyof typeof PricingProfile];

export interface PricingProfileReference {
  label: string;
  /** Faixa de referencia (fracoes). */
  minMargin: number;
  maxMargin: number;
  /** Ponto inicial dentro da faixa. */
  suggestedMargin: number;
}

export const PRICING_PROFILE_REFERENCES: Record<PricingProfile, PricingProfileReference> = {
  DRY_FOOD_STANDARD: { label: 'Ração Standard / popular', minMargin: 0.15, maxMargin: 0.2, suggestedMargin: 0.2 },
  DRY_FOOD_PREMIUM: { label: 'Ração Premium', minMargin: 0.25, maxMargin: 0.35, suggestedMargin: 0.3 },
  DRY_FOOD_SUPER_PREMIUM: { label: 'Ração Super Premium', minMargin: 0.35, maxMargin: 0.45, suggestedMargin: 0.4 },
};

export const pricingProfileSchema = z.nativeEnum(PricingProfile, {
  errorMap: () => ({ message: 'Perfil de preco invalido.' }),
});

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** A categoria e de racao? (qualquer grafia: "Ração", "racao premium"...) */
export function isDryFoodCategory(category: string | null | undefined): boolean {
  return !!category && /\bracao|\bracoes/.test(normalizeText(category));
}

/**
 * Perfil a partir do nome da categoria, quando ele deixa claro
 * ("Ração Premium", "Ração Super Premium", "Ração Standard"). "Ração" sozinha
 * nao define a faixa: o usuario escolhe.
 */
export function pricingProfileFromCategory(category: string | null | undefined): PricingProfile | null {
  if (!isDryFoodCategory(category)) return null;
  const text = normalizeText(category ?? '');
  if (/super\s*-?\s*premium/.test(text)) return 'DRY_FOOD_SUPER_PREMIUM';
  if (/premium/.test(text)) return 'DRY_FOOD_PREMIUM';
  if (/standard|popular|economica|basica/.test(text)) return 'DRY_FOOD_STANDARD';
  return null;
}

// -----------------------------------------------------------------------------
// Sugestao
// -----------------------------------------------------------------------------

/**
 * De onde a sugestao veio. Preparado para crescer (preco sugerido pelo
 * fabricante, historico de vendas, descontos, concorrencia) sem mudar o
 * contrato -- hoje so as duas primeiras fontes existem.
 */
export type PriceSuggestionSource = 'REFERENCE_MARGIN' | 'OWN_CATEGORY_HISTORY';

export const PRICE_SUGGESTION_SOURCE_LABELS: Record<PriceSuggestionSource, string> = {
  REFERENCE_MARGIN: 'Margem de referência da categoria',
  OWN_CATEGORY_HISTORY: 'Margem que você já pratica nesta categoria',
};

/** Minimo de produtos com custo e preco na categoria para usar o historico proprio. */
export const OWN_HISTORY_MIN_PRODUCTS = 3;

export const priceSuggestionQuerySchema = z.object({
  cost: z.coerce
    .number({ invalid_type_error: 'Informe o custo.' })
    .positive('O custo deve ser maior que zero.')
    .max(99_999_999.99, 'Custo acima do limite.'),
  category: z.string().trim().max(60).optional(),
  profile: pricingProfileSchema.optional(),
  brandId: uuidSchema.optional(),
  /** Produto sendo editado: fica fora do proprio historico. */
  excludeProductId: uuidSchema.optional(),
});
export type PriceSuggestionQuery = z.infer<typeof priceSuggestionQuerySchema>;

export type PriceSuggestionDto =
  | {
      status: 'SUGGESTED';
      cost: number;
      /** Margem sobre a venda (fracao). */
      margin: number;
      price: number;
      /** Faixa de referencia, quando a fonte tem faixa. */
      range: { minMargin: number; maxMargin: number; minPrice: number; maxPrice: number } | null;
      source: PriceSuggestionSource;
      profile: PricingProfile | null;
      /** Quantos produtos do proprio pet shop embasaram (OWN_CATEGORY_HISTORY). */
      sampleSize: number | null;
      explanation: string;
      disclaimer: string;
    }
  | {
      status: 'INSUFFICIENT_DATA';
      cost: number;
      /** true quando a categoria e racao e so falta escolher a faixa. */
      needsProfile: boolean;
      explanation: string;
    };

export const PRICE_SUGGESTION_DISCLAIMER =
  'Sugestão calculada a partir do custo e de uma margem de referência. Não é preço de mercado. Você pode alterar.';
