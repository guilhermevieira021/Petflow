import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_QUERY_KEY, useLogin } from './session';

/**
 * Regressao do bug de login que nao funcionava no mobile: `useLogin` usava
 * `invalidateQueries`, que so promete que uma nova tentativa de
 * GET /auth/me aconteceu -- NAO que ela deu certo. A promessa resolvia
 * mesmo com um 401 de volta, entao quem chamava `mutateAsync()` navegava
 * para uma rota protegida sem sessao de verdade confirmada, e a guarda de
 * rota devolvia a pessoa para o login sem nenhuma explicacao (exatamente
 * "a tela carrega e volta pro login sozinha").
 *
 * A causa raiz de a sessao falhar de verdade (ex.: cookie cross-site
 * recusado por politica de navegador) fica fora do controle do app -- mas
 * o app NUNCA pode navegar como se tivesse dado certo quando nao deu. E
 * exatamente isso que estes testes travam.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe('useLogin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('REJEITA quando /auth/login da 200 mas /auth/me falha logo em seguida -- nunca finge sucesso', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/login')) {
        return Promise.resolve(jsonResponse(200, { user: { id: 'u1' }, csrfToken: 'token-1' }));
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sua sessao expirou.' } }),
        );
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useLogin(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ email: 'dono@example.com', password: 'senhaSegura1' }),
    ).rejects.toBeTruthy();

    // A sessao continua ausente do cache -- ninguem pode navegar achando
    // que existe uma sessao valida.
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeUndefined();
  });

  it('RESOLVE e popula o cache da sessao quando /auth/me confirma de verdade', async () => {
    const sessionPayload = { user: { id: 'u1', name: 'Dono' }, csrfToken: 'token-1' };
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/login')) {
        return Promise.resolve(jsonResponse(200, { user: { id: 'u1' }, csrfToken: 'token-1' }));
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(200, sessionPayload));
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useLogin(), { wrapper: Wrapper });

    await result.current.mutateAsync({ email: 'dono@example.com', password: 'senhaSegura1' });

    await waitFor(() => {
      expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(sessionPayload);
    });
  });
});
