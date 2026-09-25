import type { DashboardRevenuePoint } from '@petflow/contracts';
import { useEffect, useRef, useState } from 'react';
import { formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * Receita prevista x recebida nos ultimos 14 dias.
 *
 * Decisoes de leitura:
 *   - UM eixo. As duas series sao reais (R$), entao compartilham escala.
 *     Grafico de eixo duplo e a forma mais rapida de mentir com dados.
 *   - Linha, e nao barra agrupada: 28 barras nao cabem num celular; a
 *     pergunta do lojista e "como veio variando", que e tendencia.
 *   - Legenda sempre presente E rotulo direto na ultima ponta de cada serie:
 *     a identidade nunca depende so da cor.
 *   - Tabela equivalente abaixo, para leitor de tela e para quem precisa do
 *     numero exato.
 */

const PADDING = { top: 14, right: 16, bottom: 26, left: 56 } as const;
const HEIGHT = 220;
const GRID_LINES = 4;

interface HoverState {
  index: number;
  x: number;
}

/** Arredonda o topo do eixo para um valor "redondo" legivel. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  // Comeca pequeno: um valor inicial largo esticaria colunas de grid no mobile
  // antes da primeira medicao.
  const [width, setWidth] = useState(280);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Medimos o container em pixels reais em vez de esticar o viewBox: assim
    // o texto e a espessura das linhas nao distorcem em telas estreitas.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(280, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

export function RevenueChart({ data }: { data: DashboardRevenuePoint[] }) {
  const [containerRef, width] = useContainerWidth();
  const [hover, setHover] = useState<HoverState | null>(null);

  const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const maxValue = niceCeiling(
    Math.max(1, ...data.flatMap((point) => [point.expected, point.received])),
  );

  const xAt = (index: number): number =>
    PADDING.left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const yAt = (value: number): number => PADDING.top + plotHeight - (value / maxValue) * plotHeight;

  const buildPath = (accessor: (point: DashboardRevenuePoint) => number): string =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index)},${yAt(accessor(point))}`).join(' ');

  const gridValues = Array.from({ length: GRID_LINES + 1 }, (_, i) => (maxValue / GRID_LINES) * i);
  const hovered = hover ? data[hover.index] : undefined;

  // Em telas estreitas, rotular todo dia colide. Mostramos um a cada N.
  const labelEvery = width < 420 ? 4 : width < 640 ? 3 : 2;

  return (
    <div>
      {/* Legenda: obrigatoria a partir de duas series. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {[
          { label: 'Previsto', color: 'var(--color-chart-1)' },
          { label: 'Recebido', color: 'var(--color-chart-2)' },
        ].map((series) => (
          <span
            key={series.label}
            className="inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--color-text-muted)]"
          >
            <span
              aria-hidden
              className="inline-block h-0.5 w-3.5 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative w-full min-w-0 overflow-hidden">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Receita prevista e recebida nos ultimos ${data.length} dias`}
          className="block overflow-visible"
          onMouseLeave={() => setHover(null)}
        >
          {/* Grade recessiva: orienta sem competir com os dados. */}
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={yAt(value)}
                y2={yAt(value)}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={yAt(value)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[var(--color-text-subtle)] text-[0.6875rem]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoneyCompact(value)}
              </text>
            </g>
          ))}

          {/* Eixo x */}
          {data.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.date}
                x={xAt(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-[var(--color-text-subtle)] text-[0.6875rem]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {shortDate(point.date)}
              </text>
            ) : null,
          )}

          {/* Linha de referencia do ponto sob o cursor */}
          {hover ? (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null}

          {/* Series -- traco fino, sem preenchimento sob a linha */}
          <path
            d={buildPath((point) => point.expected)}
            fill="none"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={buildPath((point) => point.received)}
            fill="none"
            stroke="var(--color-chart-2)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Marcadores apenas no ponto sob o cursor: anel da cor da superficie
              para separar as duas series quando se cruzam. */}
          {hovered ? (
            <>
              <circle
                cx={xAt(hover!.index)}
                cy={yAt(hovered.expected)}
                r={4.5}
                fill="var(--color-chart-1)"
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
              <circle
                cx={xAt(hover!.index)}
                cy={yAt(hovered.received)}
                r={4.5}
                fill="var(--color-chart-2)"
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </>
          ) : null}

          {/* Areas de captura do mouse: alvo maior que o marcador. */}
          {data.map((point, index) => {
            const bandWidth = plotWidth / Math.max(1, data.length - 1);
            return (
              <rect
                key={point.date}
                x={xAt(index) - bandWidth / 2}
                y={PADDING.top}
                width={bandWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover({ index, x: xAt(index) })}
              />
            );
          })}
        </svg>

        {hovered ? (
          <div
            className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-md)]"
            style={{
              left: `${Math.min(Math.max(hover!.x, 72), width - 72)}px`,
              top: '0px',
            }}
          >
            <p className="mb-1 text-[0.6875rem] font-medium text-[var(--color-text-muted)]">
              {shortDate(hovered.date)}
            </p>
            {[
              { label: 'Previsto', value: hovered.expected, color: 'var(--color-chart-1)' },
              { label: 'Recebido', value: hovered.received, color: 'var(--color-chart-2)' },
            ].map((row) => (
              <p key={row.label} className="flex items-center gap-1.5 text-[0.75rem]">
                <span
                  aria-hidden
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[var(--color-text-muted)]">{row.label}</span>
                <span className="tabular ml-auto font-medium">{formatMoney(row.value)}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* Equivalente textual: leitores de tela e quem precisa do numero exato. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[0.75rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          Ver dados em tabela
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <table className="w-full text-[0.75rem]">
            <caption className="sr-only">
              Receita prevista e recebida por dia nos ultimos {data.length} dias
            </caption>
            <thead className="sticky top-0 bg-[var(--color-surface-sunken)]">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Dia
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Previsto
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Recebido
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date} className="border-t border-[var(--color-border)]">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {shortDate(point.date)}
                  </th>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(point.expected)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(point.received)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
