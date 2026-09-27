import {
  isDryFoodCategory,
  OWN_HISTORY_MIN_PRODUCTS,
  PRICE_SUGGESTION_DISCLAIMER,
  PRICING_PROFILE_REFERENCES,
  priceForMargin,
  pricingProfileFromCategory,
  type PriceSuggestionDto,
  type PriceSuggestionQuery,
} from '@petflow/contracts';
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { products } from '../../db/schema/index.js';

/**
 * Preco de venda SUGERIDO. Nunca consulta nem inventa preco de mercado.
 *
 * Fontes, em ordem:
 *  1. Margem de REFERENCIA da faixa (hoje so racao seca: standard, premium,
 *     super premium), escolhida pelo usuario ou clara no nome da categoria.
 *  2. Margem que o PROPRIO pet shop ja pratica na categoria (mediana dos
 *     produtos com custo e preco), com amostra minima.
 *  3. Sem nenhuma das duas: "dados insuficientes" -- o usuario informa a
 *     margem desejada e o calculo acontece na tela (mesma formula).
 *
 * Ponto de extensao: novas fontes (preco sugerido pelo fabricante,
 * historico de vendas, descontos, concorrencia) entram como novos passos
 * aqui e novos valores em PriceSuggestionSource -- sem mudar o contrato.
 */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

const percent = (fraction: number) =>
  `${(fraction * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function suggestPrice(
  tx: Transaction,
  context: TenantContext,
  query: PriceSuggestionQuery,
): Promise<PriceSuggestionDto> {
  const { cost } = query;
  const profile = query.profile ?? pricingProfileFromCategory(query.category);

  // 1. Referencia da faixa.
  if (profile) {
    const reference = PRICING_PROFILE_REFERENCES[profile];
    const price = priceForMargin(cost, reference.suggestedMargin);
    return {
      status: 'SUGGESTED',
      cost,
      margin: reference.suggestedMargin,
      price,
      range: {
        minMargin: reference.minMargin,
        maxMargin: reference.maxMargin,
        minPrice: priceForMargin(cost, reference.minMargin),
        maxPrice: priceForMargin(cost, reference.maxMargin),
      },
      source: 'REFERENCE_MARGIN',
      profile,
      sampleSize: null,
      explanation:
        `Com base na categoria ${reference.label}, recomendamos começar em aproximadamente ${money(price)} ` +
        `(margem de ${percent(reference.suggestedMargin)}; referência entre ${percent(reference.minMargin)} e ${percent(reference.maxMargin)}).`,
      disclaimer: PRICE_SUGGESTION_DISCLAIMER,
    };
  }

  // 2. Margem que o proprio pet shop pratica na categoria.
  if (query.category) {
    const filters: SQL[] = [
      eq(products.tenantId, context.tenantId),
      isNull(products.deletedAt),
      eq(products.active, true),
      sql`lower(btrim(${products.category})) = lower(btrim(${query.category}))`,
      sql`${products.costPrice} > 0`,
      sql`${products.salePrice} > 0`,
    ];
    if (query.excludeProductId) filters.push(ne(products.id, query.excludeProductId));
    const rows = await tx
      .select({ salePrice: products.salePrice, costPrice: products.costPrice })
      .from(products)
      .where(and(...filters))
      .limit(500);

    const margins = rows.map((row) => {
      const price = toNumber(row.salePrice);
      return (price - toNumber(row.costPrice)) / price;
    });
    if (margins.length >= OWN_HISTORY_MIN_PRODUCTS) {
      const margin = Math.round(median(margins) * 10_000) / 10_000;
      if (margin > 0 && margin < 0.95) {
        const price = priceForMargin(cost, margin);
        return {
          status: 'SUGGESTED',
          cost,
          margin,
          price,
          range: null,
          source: 'OWN_CATEGORY_HISTORY',
          profile: null,
          sampleSize: margins.length,
          explanation:
            `Nos seus ${margins.length} produtos de "${query.category}", a margem mediana é ${percent(margin)}. ` +
            `Mantendo essa margem, o preço fica em aproximadamente ${money(price)}.`,
          disclaimer: PRICE_SUGGESTION_DISCLAIMER,
        };
      }
    }
  }

  // 3. Sem base para sugerir.
  const needsProfile = isDryFoodCategory(query.category);
  return {
    status: 'INSUFFICIENT_DATA',
    cost,
    needsProfile,
    explanation: needsProfile
      ? 'Escolha a linha da ração (Standard, Premium ou Super Premium) para sugerirmos um preço.'
      : 'Não temos dados suficientes para sugerir um preço. Informe a margem desejada e calculamos para você.',
  };
}
