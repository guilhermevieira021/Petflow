import { DEFAULT_APPEARANCE, type TenantAppearanceDto, type ThemeId } from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { THEME_CSS_VARIABLE_NAMES, THEMES, themeCssVariables } from '@/lib/theme/themes';

/**
 * Tema do sistema autenticado.
 *
 * Fonte da verdade: `tenants.settings.appearance` (API), lida por qualquer
 * usuario logado em GET /tenants/current/appearance. O ultimo valor fica em
 * localStorage por pet shop so para a primeira pintura nao "piscar" o tema
 * padrao antes da resposta chegar.
 *
 * Aplicacao: todas as CSS variables do tema no <html> (os componentes so
 * usam var(--color-*)). A cor propria do pet shop (white-label) entra por
 * cima quando `brandColorMode = custom`. Sem sessao (landing, login), nada e
 * sobrescrito: vale o visual padrao definido em styles/index.css.
 */

export const APPEARANCE_QUERY_KEY = ['tenant', 'appearance'] as const;

interface ThemeContextValue {
  /** Aparencia salva do pet shop. */
  appearance: TenantAppearanceDto | null;
  /** Tema aplicado agora (a previa, se houver, senao o salvo). */
  activeThemeId: ThemeId;
  previewThemeId: ThemeId | null;
  /** Mostra um tema no sistema inteiro sem salvar. `null` volta ao salvo. */
  setPreviewTheme: (themeId: ThemeId | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function cacheKey(tenantId: string): string {
  return `petflow:appearance:${tenantId}`;
}

function readCache(tenantId: string): TenantAppearanceDto | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(tenantId));
    return raw ? (JSON.parse(raw) as TenantAppearanceDto) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(tenantId: string, appearance: TenantAppearanceDto): void {
  try {
    localStorage.setItem(cacheKey(tenantId), JSON.stringify(appearance));
  } catch {
    // Sem storage: so perde a pintura instantanea na proxima abertura.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session?.tenant.id ?? null;
  const [previewThemeId, setPreviewThemeId] = useState<ThemeId | null>(null);

  const query = useQuery({
    queryKey: [...APPEARANCE_QUERY_KEY, tenantId],
    queryFn: () => api.get<TenantAppearanceDto>('/tenants/current/appearance'),
    enabled: tenantId !== null,
    initialData: () => (tenantId ? readCache(tenantId) : undefined),
    staleTime: 60_000,
  });

  // Sem resposta nem cache (primeiro acesso): mesmo comportamento de antes
  // dos temas -- visual padrao com a cor do pet shop.
  const sessionColor = session?.tenant.primaryColor;
  const sessionLogo = session?.tenant.logoUrl ?? null;
  const hasSession = session !== null;
  const appearance = useMemo<TenantAppearanceDto | null>(() => {
    if (!hasSession) return null;
    return query.data ?? { ...DEFAULT_APPEARANCE, primaryColor: sessionColor ?? '#2f6bff', logoUrl: sessionLogo };
  }, [hasSession, query.data, sessionColor, sessionLogo]);

  useEffect(() => {
    if (tenantId && query.data) writeCache(tenantId, query.data);
  }, [tenantId, query.data]);

  // Salvar cor/logo em Configuracoes atualiza a sessao; a aparencia acompanha.
  useEffect(() => {
    if (tenantId) void queryClient.invalidateQueries({ queryKey: [...APPEARANCE_QUERY_KEY, tenantId] });
  }, [queryClient, tenantId, session?.tenant.primaryColor, session?.tenant.logoUrl]);

  // Previa nunca sobrevive a troca de sessao.
  useEffect(() => setPreviewThemeId(null), [tenantId]);

  const activeThemeId: ThemeId = previewThemeId ?? appearance?.theme ?? DEFAULT_APPEARANCE.theme;
  // Na previa mostra o tema como ele e; aplicado, respeita a cor propria.
  const brandOverride =
    appearance && !previewThemeId && appearance.brandColorMode === 'custom' ? appearance.primaryColor : null;

  useEffect(() => {
    const root = document.documentElement;
    if (!appearance) {
      for (const name of THEME_CSS_VARIABLE_NAMES) root.style.removeProperty(name);
      root.style.removeProperty('color-scheme');
      root.removeAttribute('data-theme');
      root.removeAttribute('data-theme-mode');
      return;
    }
    for (const [name, value] of Object.entries(themeCssVariables(activeThemeId, brandOverride))) {
      root.style.setProperty(name, value);
    }
    // Campos nativos (data, select, barras de rolagem) acompanham o modo.
    const mode = THEMES[activeThemeId].mode;
    root.style.setProperty('color-scheme', mode);
    root.setAttribute('data-theme', activeThemeId);
    root.setAttribute('data-theme-mode', mode);
  }, [appearance, activeThemeId, brandOverride]);

  const setPreviewTheme = useCallback((themeId: ThemeId | null) => setPreviewThemeId(themeId), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ appearance, activeThemeId, previewThemeId, setPreviewTheme }),
    [appearance, activeThemeId, previewThemeId, setPreviewTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return context;
}
