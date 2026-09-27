import type { BrandColorMode, Tenant, TenantAppearanceDto, ThemeId } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { APPEARANCE_QUERY_KEY } from './ThemeProvider';

/**
 * Salva o tema do pet shop (tenants.settings.appearance). A troca aparece na
 * hora: o valor novo e aplicado antes da resposta e desfeito se falhar.
 * Usado em Configuracoes > Aparencia e no seletor rapido do painel.
 */
export function useSaveAppearance() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session } = useSession();
  const key = [...APPEARANCE_QUERY_KEY, session?.tenant.id ?? null];

  return useMutation({
    mutationFn: (next: { theme: ThemeId; brandColorMode: BrandColorMode }) =>
      api.patch<Tenant>('/tenants/current', { settings: { appearance: next } }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TenantAppearanceDto>(key);
      if (previous) queryClient.setQueryData<TenantAppearanceDto>(key, { ...previous, ...next });
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar o tema.');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['tenant', 'current'] });
    },
  });
}
