import type { ThemeId } from '@petflow/contracts';
import type { CSSProperties } from 'react';
import { themeCssVariables } from '@/lib/theme/themes';

/** Variaveis do tema aplicadas SO dentro do container (miniatura). */
function scopedThemeStyle(themeId: ThemeId): CSSProperties {
  return themeCssVariables(themeId) as CSSProperties;
}

/** Miniatura do sistema no tema: navegacao, fundo, card, botao e estados. */
export function ThemeThumbnail({ themeId }: { themeId: ThemeId }) {
  return (
    <div
      aria-hidden
      style={scopedThemeStyle(themeId)}
      className="flex aspect-[16/10] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)]"
    >
      <div className="flex w-[22%] flex-col gap-1.5 bg-[var(--color-ink)] p-2">
        <span className="mb-1 size-3 rounded-[3px] bg-[var(--color-brand)]" />
        <span className="h-1.5 rounded-full bg-[var(--color-brand-on-ink)]" />
        <span className="h-1.5 w-4/5 rounded-full bg-[var(--color-ink-muted)] opacity-60" />
        <span className="h-1.5 w-3/5 rounded-full bg-[var(--color-ink-muted)] opacity-60" />
        <span className="h-1.5 w-4/5 rounded-full bg-[var(--color-ink-muted)] opacity-60" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-2 w-2/5 rounded-full bg-[var(--color-text)]" />
        <div className="@container flex flex-1 flex-col gap-1.5 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
          <span className="h-1.5 w-3/5 rounded-full bg-[var(--color-text-muted)]" />
          <span className="h-1.5 w-4/5 rounded-full bg-[var(--color-border-strong)]" />
          {/* Estados encolhem e somem antes do botao: a miniatura cabe em cards estreitos. */}
          <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden">
            <span className="shrink-0 rounded-full bg-[var(--color-success-subtle)] px-1.5 text-[7px] font-semibold text-[var(--color-success)]">Pago</span>
            <span className="hidden shrink-0 rounded-full bg-[var(--color-warning-subtle)] @[7.5rem]:inline px-1.5 text-[7px] font-semibold text-[var(--color-warning)]">Pendente</span>
            <span className="ml-auto shrink-0 rounded-[4px] bg-[var(--color-brand)] px-1.5 py-0.5 text-[7px] font-semibold text-[var(--color-text-inverse)]">Salvar</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <span className="h-4 flex-1 rounded-[4px] bg-[var(--color-brand-subtle)]" />
          <span className="h-4 flex-1 rounded-[4px] bg-[var(--color-surface-sunken)]" />
        </div>
      </div>
    </div>
  );
}

