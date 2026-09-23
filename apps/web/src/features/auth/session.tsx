import type { LoginInput, Permission, SessionPayload } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, api, setCsrfToken } from '@/lib/api';

export const SESSION_QUERY_KEY = ['session'] as const;

interface SessionContextValue {
  session: SessionPayload | null;
  isLoading: boolean;
  /** true quando a sessao ja foi resolvida (com ou sem usuario). */
  isResolved: boolean;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => api.get<SessionPayload>('/auth/me'),
    // 401 aqui significa "nao logado", que e um estado valido e nao um erro
    // a ser repetido. Qualquer outra falha merece uma nova tentativa.
    retry: (failureCount, error) =>
      error instanceof ApiError && error.isUnauthenticated ? false : failureCount < 2,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const session = query.data ?? null;

  /**
   * Mantem o token CSRF em memoria (lib/api.ts) sincronizado com a sessao
   * atual -- inclusive limpando quando a sessao cai (logout, 401), para que
   * uma aba que troque de usuario nunca reuse um token da sessao anterior.
   */
  useEffect(() => {
    setCsrfToken(session?.csrfToken ?? null);
  }, [session?.csrfToken]);

  /**
   * White-label: a cor do tenant vira o token --color-brand, e todos os tons
   * derivados (hover, fundo suave, borda) recalculam sozinhos via color-mix.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (session?.tenant.primaryColor) {
      root.style.setProperty('--color-brand', session.tenant.primaryColor);
    } else {
      root.style.removeProperty('--color-brand');
    }
  }, [session?.tenant.primaryColor]);

  useEffect(() => {
    document.title = session?.tenant.name
      ? `${session.tenant.name} - PetFlow`
      : 'PetFlow - Gestao para pet shops';
  }, [session?.tenant.name]);

  const permissions = useMemo(
    () => new Set<Permission>(session?.permissions ?? []),
    [session?.permissions],
  );

  const can = useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions],
  );

  const canAny = useCallback(
    (list: Permission[]) => list.some((permission) => permissions.has(permission)),
    [permissions],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isLoading: query.isLoading,
      isResolved: !query.isLoading,
      can,
      canAny,
      refresh,
    }),
    [session, query.isLoading, can, canAny, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  }
  return context;
}

/** Sessao garantida. Use dentro de rotas ja protegidas. */
export function useCurrentSession(): SessionPayload {
  const { session } = useSession();
  if (!session) {
    throw new Error('Nenhuma sessao ativa neste ponto da arvore.');
  }
  return session;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: unknown }>('/auth/login', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      // Limpa TODO o cache, e nao apenas a sessao: dados de um tenant nunca
      // podem sobrar em memoria depois que outra pessoa faz login na mesma
      // maquina.
      queryClient.clear();
    },
  });
}
