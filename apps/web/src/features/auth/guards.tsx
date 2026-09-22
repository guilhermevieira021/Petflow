import type { Permission } from '@petflow/contracts';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { EmptyState } from '@/components/ui/primitives';
import { useSession } from './session';

function FullPageLoader() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-[var(--color-canvas)]"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Carregando sua sessao</span>
      <div className="flex flex-col items-center gap-3">
        <div className="skeleton size-10 rounded-[var(--radius-lg)]" />
        <div className="skeleton h-3 w-28 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Exige sessao ativa.
 *
 * Isto e conveniencia de navegacao, NAO seguranca: quem remover este
 * componente pelo DevTools continua esbarrando no 401 do backend em toda
 * chamada. A autorizacao que vale e a do servidor.
 */
export function RequireAuth() {
  const { session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;

  if (!session) {
    // Guarda o destino para devolver a pessoa ao lugar certo apos o login.
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/** Redireciona quem ja esta logado para longe das telas publicas. */
export function RequireGuest() {
  const { session, isLoading } = useSession();

  if (isLoading) return <FullPageLoader />;
  if (session) return <Navigate to="/painel" replace />;

  return <Outlet />;
}

/** Bloqueia a rota quando falta permissao, explicando o motivo. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useSession();

  if (!can(permission)) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title="Voce nao tem acesso a esta area"
        description="Fale com o responsavel pelo pet shop se precisar destas informacoes."
      />
    );
  }

  return <>{children}</>;
}
