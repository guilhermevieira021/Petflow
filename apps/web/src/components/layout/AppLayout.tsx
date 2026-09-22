import { ChevronDown, LogOut, Menu, PawPrint, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@petflow/contracts';
import { TrialBanner } from '@/components/billing/TrialBanner';
import { Avatar } from '@/components/ui/primitives';
import { useCurrentSession, useLogout, useSession } from '@/features/auth/session';
import { cn } from '@/lib/cn';
import { NAV_GROUPS } from './navigation';

/**
 * Rotas alcancaveis mesmo com o acesso bloqueado (trial vencido, assinatura
 * cancelada). O bloqueio de verdade e do backend -- ver assertActiveAccess em
 * billing.service.ts; isto so evita que a navegacao ofereca um caminho que
 * vai levar a um erro 403 na primeira tentativa de salvar algo.
 */
const ALLOWED_WHEN_BLOCKED = ['/billing', '/configuracoes', '/upgrade'];

function isAllowedWhenBlocked(pathname: string): boolean {
  return ALLOWED_WHEN_BLOCKED.some((prefix) => pathname.startsWith(prefix));
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useSession();
  const session = useCurrentSession();
  const blocked = session.billing.access.blocked;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => can(item.permission) && (!blocked || isAllowedWhenBlocked(item.to)),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Marca do tenant: logo e nome carregados dinamicamente (white-label). */}
      <div className="flex h-[var(--spacing-topbar)] shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
        {session.tenant.logoUrl ? (
          <img
            src={session.tenant.logoUrl}
            alt=""
            className="size-7 rounded-[var(--radius-sm)] object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-brand)] text-[var(--color-text-inverse)]"
          >
            <PawPrint className="size-4" />
          </span>
        )}
        <span className="truncate text-sm font-semibold tracking-tight" title={session.tenant.name}>
          {session.tenant.name}
        </span>
      </div>

      <nav aria-label="Navegacao principal" className="flex-1 overflow-y-auto p-2.5">
        {visibleGroups.map((group, index) => (
          <div key={group.title ?? 'principal'} className={index > 0 ? 'mt-4' : undefined}>
            {group.title ? (
              <p className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wide text-[var(--color-text-subtle)] uppercase">
                {group.title}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/painel'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2',
                          'text-sm font-medium transition-colors duration-150',
                          isActive
                            ? 'bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
                        )
                      }
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function UserMenu() {
  const session = useCurrentSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou ao pressionar Esc.
  useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  async function handleLogout(): Promise<void> {
    await logout.mutateAsync().catch(() => undefined);
    navigate('/entrar', { replace: true });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-[var(--radius-md)] p-1 pr-2 transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <Avatar name={session.user.name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block text-[0.8125rem] leading-tight font-medium">
            {session.user.name}
          </span>
          <span className="block text-[0.6875rem] leading-tight text-[var(--color-text-subtle)]">
            {ROLE_LABELS[session.user.role]}
          </span>
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-[var(--color-text-subtle)]" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
        >
          <div className="border-b border-[var(--color-border)] px-3.5 py-3">
            <p className="truncate text-[0.8125rem] font-medium">{session.user.name}</p>
            <p className="truncate text-[0.75rem] text-[var(--color-text-subtle)]">
              {session.user.email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] disabled:opacity-60"
          >
            <LogOut aria-hidden className="size-4" />
            Sair da conta
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const session = useCurrentSession();

  // Trocar de rota fecha o menu no mobile.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // O bloqueio que vale e o do backend (toda escrita passa por
  // assertActiveAccess). Isto e so a navegacao evitando levar o usuario a uma
  // tela que vai falhar de cara.
  if (session.billing.access.blocked && !isAllowedWhenBlocked(location.pathname)) {
    return <Navigate to="/upgrade" replace />;
  }

  return (
    <div className="min-h-dvh bg-[var(--color-canvas)]">
      {/* Link de pulo: primeiro item no tab order, visivel apenas com foco. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-md)]"
      >
        Pular para o conteudo
      </a>

      {/* Sidebar fixa no desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-[var(--spacing-sidebar)] border-r border-[var(--color-border)] bg-[var(--color-surface)] lg:block">
        <SidebarContent />
      </aside>

      {/* Drawer no mobile */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 w-[min(17rem,85vw)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[var(--spacing-sidebar)]">
        <header className="sticky top-0 z-30 flex h-[var(--spacing-topbar)] items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/85 px-4 backdrop-blur-sm sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={mobileOpen}
            className="-ml-1 rounded-[var(--radius-md)] p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] lg:hidden"
          >
            {mobileOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>

          <div className="flex-1" />

          <UserMenu />
        </header>

        <TrialBanner billing={session.billing} />

        <main id="conteudo" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
