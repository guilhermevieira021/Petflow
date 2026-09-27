import {
  isDryFoodCategory,
  marginOf,
  markupOf,
  PRICE_SUGGESTION_SOURCE_LABELS,
  PRICING_PROFILE_REFERENCES,
  priceForMargin,
  pricingProfileFromCategory,
  type PriceSuggestionDto,
  type PricingProfile,
} from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseDecimal } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

const percent = (fraction: number) => `${(fraction * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * "Deixa o preco com a gente": a partir do custo, sugere um preco de venda
 * (faixa de referencia da categoria ou margem que o pet shop ja pratica). A
 * sugestao e so recomendacao -- o usuario aceita ou ajusta. Sem base, calcula
 * pela margem desejada. Formula: preco = custo / (1 - margem).
 */
export function PricingAssistant({
  cost,
  price,
  category,
  excludeProductId,
  onUsePrice,
  onAdjust,
}: {
  cost: number | null;
  price: number | null;
  category: string;
  excludeProductId?: string;
  onUsePrice: (price: number) => void;
  onAdjust: () => void;
}) {
  const inferredProfile = pricingProfileFromCategory(category);
  const [chosenProfile, setChosenProfile] = useState<PricingProfile | null>(null);
  const [desiredMargin, setDesiredMargin] = useState('');
  const profile = inferredProfile ?? (isDryFoodCategory(category) ? chosenProfile : null);
  const debouncedCost = useDebounced(cost);
  const debouncedCategory = useDebounced(category.trim());

  const query = useQuery({
    queryKey: ['pricing', 'suggestion', debouncedCost, debouncedCategory, profile, excludeProductId],
    queryFn: () =>
      api.get<PriceSuggestionDto>('/pricing/suggestion', {
        cost: debouncedCost ?? undefined,
        category: debouncedCategory || undefined,
        profile: profile ?? undefined,
        excludeProductId,
      }),
    enabled: debouncedCost !== null && debouncedCost > 0,
    staleTime: 30_000,
  });

  if (cost === null || !(cost > 0)) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-[0.8125rem] text-[var(--color-text-muted)]">
        <Sparkles aria-hidden className="mr-1.5 inline size-3.5 text-[var(--color-brand-text)]" />
        Informe o custo de compra e deixa o preço com a gente: sugerimos um valor de venda.
      </div>
    );
  }

  const currentMargin = marginOf(price, cost);
  const currentMarkup = markupOf(price, cost);
  const suggestion = query.data;
  const margin = parseDecimal(desiredMargin.replace('%', ''));
  const marginPrice = Number.isFinite(margin) && margin > 0 && margin < 100 ? priceForMargin(cost, margin / 100) : null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] p-4" aria-live="polite">
      <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[var(--color-brand-text)]">
        <Sparkles aria-hidden className="size-4" />
        Deixa o preço com a gente
      </p>

      {isDryFoodCategory(category) && !inferredProfile ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.8125rem]">Qual a linha desta ração?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Linha da ração">
            {(Object.keys(PRICING_PROFILE_REFERENCES) as PricingProfile[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={chosenProfile === key}
                onClick={() => setChosenProfile(key)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                  chosenProfile === key
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-brand-border)]',
                )}
              >
                {PRICING_PROFILE_REFERENCES[key].label.replace('Ração ', '')}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {query.isFetching && !suggestion ? <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Calculando…</p> : null}

      {suggestion?.status === 'SUGGESTED' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[0.8125rem]">
            Preço sugerido: <strong className="tabular text-base">{formatMoney(suggestion.price)}</strong>{' '}
            <span className="text-[var(--color-text-muted)]">· margem estimada de {percent(suggestion.margin)}</span>
          </p>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)]">{suggestion.explanation}</p>
          {suggestion.range ? (
            <p className="tabular text-[0.75rem] text-[var(--color-text-muted)]">
              Faixa de referência: {formatMoney(suggestion.range.minPrice)} a {formatMoney(suggestion.range.maxPrice)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onUsePrice(suggestion.price)}>
              Usar preço sugerido
            </Button>
            <Button size="sm" variant="secondary" onClick={onAdjust}>
              Ajustar preço
            </Button>
          </div>
          <p className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {PRICE_SUGGESTION_SOURCE_LABELS[suggestion.source]}. {suggestion.disclaimer}
          </p>
        </div>
      ) : null}

      {suggestion?.status === 'INSUFFICIENT_DATA' ? (
        <p className="text-[0.8125rem] text-[var(--color-text-muted)]">{suggestion.explanation}</p>
      ) : null}

      {suggestion && (suggestion.status === 'INSUFFICIENT_DATA' ? !suggestion.needsProfile : true) ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[0.75rem] font-medium">
            {suggestion.status === 'SUGGESTED' ? 'Ou use a sua margem (%)' : 'Margem desejada (%)'}
            <input
              value={desiredMargin}
              onChange={(event) => setDesiredMargin(event.target.value)}
              inputMode="decimal"
              placeholder="Ex.: 30"
              className="tabular h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-base sm:text-sm"
            />
          </label>
          {marginPrice !== null ? (
            <>
              <span className="tabular pb-2 text-sm">
                = <strong>{formatMoney(marginPrice)}</strong>
              </span>
              <Button size="sm" variant="secondary" onClick={() => onUsePrice(marginPrice)}>
                Usar este preço
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {price !== null && price > 0 ? (
        <p
          className={cn(
            'tabular flex items-center gap-1.5 border-t border-[var(--color-brand-border)] pt-2 text-[0.75rem]',
            currentMargin !== null && currentMargin < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]',
          )}
        >
          {currentMargin !== null && currentMargin < 0 ? <AlertTriangle aria-hidden className="size-3.5" /> : null}
          Com o preço atual ({formatMoney(price)}): margem {currentMargin === null ? '--' : percent(currentMargin)}
          {currentMarkup !== null ? ` · markup ${percent(currentMarkup)}` : ''}
          {currentMargin !== null && currentMargin < 0 ? ' · abaixo do custo' : ''}
        </p>
      ) : null}
    </div>
  );
}
