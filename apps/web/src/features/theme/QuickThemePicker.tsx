import { THEME_IDS, type ThemeId } from '@petflow/contracts';
import { Check, Palette, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { THEMES } from '@/lib/theme/themes';
import { ThemeThumbnail } from './ThemeThumbnail';
import { useTheme } from './ThemeProvider';
import { useSaveAppearance } from './useSaveAppearance';

/**
 * "Escolher tema" -- a entrada principal de temas, no painel.
 *
 * Um clique abre as 6 opcoes com a previa real de cada tema; escolher aplica
 * na hora (sem recarregar) e salva para o pet shop (tenants.settings.appearance),
 * entao a escolha continua apos sair e entrar de novo. Configuracoes >
 * Aparencia continua existindo para cor e logo proprios.
 */
export function QuickThemePicker() {
  const { appearance } = useTheme();
  const save = useSaveAppearance();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current: ThemeId = appearance?.theme ?? 'original';

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(themeId: ThemeId): void {
    if (themeId === current) return;
    // Escolher um tema usa a cor DO TEMA (igual a Configuracoes > Aparencia).
    // Sem aviso de sucesso: o proprio sistema muda e o painel mostra o tema
    // atual -- avisos empilhados atrapalhariam quem esta experimentando.
    save.mutate({ theme: themeId, brandColorMode: 'theme' });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm font-medium shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--color-surface-hover)]"
      >
        <Palette aria-hidden className="size-4 text-[var(--color-brand-text)]" />
        Escolher tema
        <span
          aria-hidden
          className="size-3.5 rounded-full border border-[var(--color-border-strong)]"
          style={{ background: `linear-gradient(135deg, ${THEMES[current].tokens.ink} 50%, ${THEMES[current].tokens.brand} 50%)` }}
        />
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Escolha seu tema"
          className="absolute top-full left-0 z-30 mt-2 max-h-[75vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-lg)] sm:right-0 sm:left-auto"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Escolha seu tema</h2>
              <p className="text-[0.8125rem] text-[var(--color-text-muted)]">A mudança vale na hora, para toda a equipe.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          <div role="radiogroup" aria-label="Temas" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {THEME_IDS.map((themeId) => {
              const theme = THEMES[themeId];
              const checked = themeId === current;
              return (
                <button
                  key={themeId}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={`${theme.name}${checked ? ' (tema atual)' : ''}`}
                  disabled={save.isPending && !checked}
                  onClick={() => choose(themeId)}
                  className={cn(
                    'flex flex-col gap-2 rounded-[var(--radius-md)] border-2 p-2 text-left transition-colors',
                    checked
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-brand-border)]',
                  )}
                >
                  <ThemeThumbnail themeId={themeId} />
                  <span className="flex items-center justify-between gap-1 px-0.5">
                    <span className="truncate text-sm font-medium">{theme.name}</span>
                    {checked ? <Check aria-hidden className="size-4 shrink-0 text-[var(--color-brand-text)]" /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <p className="text-sm" aria-live="polite">
              Tema atual: <strong>{THEMES[current].name}</strong> <Check aria-hidden className="inline size-4 text-[var(--color-success)]" />
            </p>
            <Link
              to="/configuracoes?aba=aparencia"
              onClick={() => setOpen(false)}
              className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
            >
              Cor e logo do pet shop
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
