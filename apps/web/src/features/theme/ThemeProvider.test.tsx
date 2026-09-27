import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@/lib/theme/themes';
import { ThemeProvider, useTheme } from './ThemeProvider';

/**
 * Tema: aplicado como CSS variables no <html>, combinado com a cor propria do
 * pet shop, com previa instantanea e limpo quando nao ha sessao.
 */

const sessionState: { current: unknown } = { current: null };

vi.mock('@/features/auth/session', () => ({
  useSession: () => ({ session: sessionState.current }),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const SESSION = {
  tenant: { id: '11111111-1111-4111-8111-111111111111', primaryColor: '#2F6BFF', logoUrl: null },
};

let api: ReturnType<typeof useTheme> | null = null;
function Probe() {
  api = useTheme();
  return null;
}

function renderProvider(): { rerender: (node: ReactNode) => void } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Arvore nova a cada render: com o mesmo objeto o React pula a atualizacao.
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { rerender: () => result.rerender(tree()) };
}

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  sessionState.current = SESSION;
  api = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('aplica o tema salvo no <html>, com a cor do tema', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ theme: 'forest', brandColorMode: 'theme', primaryColor: '#2F6BFF', logoUrl: null }));
    renderProvider();
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('forest'));
    expect(cssVar('--color-brand')).toBe(THEMES.forest.tokens.brand);
    expect(cssVar('--color-ink')).toBe(THEMES.forest.tokens.ink);
    expect(cssVar('--color-canvas')).toBe(THEMES.forest.tokens.canvas);
  });

  it('cor propria do pet shop por cima do tema (white-label preservado)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ theme: 'ocean', brandColorMode: 'custom', primaryColor: '#aa3300', logoUrl: null }));
    renderProvider();
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('ocean'));
    expect(cssVar('--color-brand')).toBe('#aa3300');
    expect(cssVar('--color-brand-hover')).toContain('#aa3300');
    expect(cssVar('--color-ink')).toBe(THEMES.ocean.tokens.ink);
  });

  it('sem resposta da API ainda: mesmo visual de antes dos temas (Original + cor do pet shop)', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    renderProvider();
    expect(document.documentElement.getAttribute('data-theme')).toBe('original');
    expect(cssVar('--color-brand')).toBe('#2F6BFF');
  });

  it('usa o ultimo tema salvo no aparelho enquanto a API responde (sem piscar)', () => {
    localStorage.setItem(
      `petflow:appearance:${SESSION.tenant.id}`,
      JSON.stringify({ theme: 'lavender', brandColorMode: 'theme', primaryColor: '#2F6BFF', logoUrl: null }),
    );
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    renderProvider();
    expect(document.documentElement.getAttribute('data-theme')).toBe('lavender');
    expect(cssVar('--color-brand')).toBe(THEMES.lavender.tokens.brand);
  });

  it('previa troca o tema na hora e volta ao salvo', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ theme: 'original', brandColorMode: 'custom', primaryColor: '#2F6BFF', logoUrl: null }));
    renderProvider();
    await waitFor(() => expect(api?.appearance?.theme).toBe('original'));

    act(() => api!.setPreviewTheme('sunset'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    // Na previa o tema aparece como e, com a propria cor.
    expect(cssVar('--color-brand')).toBe(THEMES.sunset.tokens.brand);

    act(() => api!.setPreviewTheme(null));
    expect(document.documentElement.getAttribute('data-theme')).toBe('original');
    expect(cssVar('--color-brand')).toBe('#2F6BFF');
  });

  it('sem sessao (logout): remove o tema e volta ao visual padrao do CSS', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ theme: 'forest', brandColorMode: 'theme', primaryColor: '#2F6BFF', logoUrl: null }));
    const view = renderProvider();
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('forest'));

    sessionState.current = null;
    view.rerender(null);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBeNull());
    expect(cssVar('--color-brand')).toBe('');
    expect(cssVar('--color-ink')).toBe('');
  });
});
