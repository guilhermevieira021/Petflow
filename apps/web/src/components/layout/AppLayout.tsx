import { ROLE_LABELS, Permission } from '@petflow/contracts';
import { CalendarPlus, ChevronsUpDown, LogOut, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TrialBanner } from '@/components/billing/TrialBanner';
import { LogoMark } from '@/components/brand/Logo';
import { buttonClasses } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/primitives';
import { useCurrentSession, useLogout, useSession } from '@/features/auth/session';
import { cn } from '@/lib/cn';
import { MOBILE_PRIMARY_ROUTES, NAV_GROUPS, type NavGroup, type NavItem } from './navigation';

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

/** Grupos de navegacao que este usuario pode ver agora. */
function useVisibleGroups(): NavGroup[] {
  const { can } = useSession();
  const session = useCurrentSession();
  const blocked = session.billing.access.blocked;

  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => can(item.permission) && (!blocked || isAllowedWhenBlocked(item.to)),
    ),
  })).filter((group) => group.items.length > 0);
}

function useLogoutAndLeave(): { leave: () => Promise<void>; pending: boolean } {
  const logout = useLogout();
  const navigate = useNavigate();
  return {
    pending: logout.isPending,
    leave: async () => {
      await logout.mutateAsync().catch(() => undefined);
      navigate('/entrar', { replace: true });
    },
  };
}

/* ---------------------------------------------------------------------------
   Marca do tenant (white-label)
--------------------------------------------------------------------------- */

function TenantBrand({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const session = useCurrentSession();
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {session.tenant.logoUrl ? (
        <img
          src={session.tenant.logoUrl}
          alt=""
          className="size-8 shrink-0 rounded-[var(--radius-sm)] bg-white object-contain"
        />
      ) : (
        <LogoMark />
      )}
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-sm leading-tight font-semibold tracking-tight',
            tone === 'light' ? 'text-[var(--color-ink-text)]' : 'text-[var(--color-text)]',
          )}
          title={session.tenant.name}
        >
          {session.tenant.name}
        </span>
        <span
          className={cn(
            'block text-[0.6875rem] leading-tight',
            tone === 'light' ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-text-subtle)]',
          )}
        >
          Petflow
        </span>
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Sidebar (desktop)
--------------------------------------------------------------------------- */

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/painel'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2',
          'text-[0.875rem] font-medium transition-colors duration-150',
          isActive
            ? 'bg-white/[0.08] text-[var(--color-ink-text)]'
            : 'text-[var(--color-ink-muted)] hover:bg-white/[0.04] hover:text-[var(--color-ink-text)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span aria-hidden className="absolute top-2 bottom-2 -left-2.5 w-[3px] rounded-full bg-[var(--color-brand)]" />
          ) : null}
          <Icon
            aria-hidden
            className={cn('size-[1.05rem] shrink-0', isActive ? 'text-[var(--color-brand-on-ink)]' : '')}
          />
          <span className="flex-1 truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function SidebarUser() {
  const session = useCurrentSession();
  const { leave, pending } = useLogoutAndLeave();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-ink-border)] bg-[var(--color-ink-raised)] shadow-[var(--shadow-lg)]"
        >
          <div className="border-b border-[var(--color-ink-border)] px-3.5 py-3">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--color-ink-text)]">{session.user.name}</p>
            <p className="truncate text-[0.75rem] text-[var(--color-ink-muted)]">{session.user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void leave()}
            disabled={pending}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-ink-text)] disabled:opacity-60"
          >
            <LogOut aria-hidden className="size-4" />
            Sair da conta
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] p-2 text-left transition-colors hover:bg-white/[0.05]"
      >
        <Avatar name={session.user.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] leading-tight font-medium text-[var(--color-ink-text)]">
            {session.user.name}
          </span>
          <span className="block truncate text-[0.6875rem] leading-tight text-[var(--color-ink-muted)]">
            {ROLE_LABELS[session.user.role]}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-[var(--color-ink-muted)]" />
      </button>
    </div>
  );
}

function Sidebar() {
  const groups = useVisibleGroups();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--spacing-sidebar)] flex-col bg-[var(--color-ink)] lg:flex">
      <div className="flex h-[var(--spacing-topbar)] shrink-0 items-center px-5">
        <TenantBrand />
      </div>

      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {groups.map((group, index) => (
          <div key={group.title ?? 'principal'} className={index > 0 ? 'mt-6' : undefined}>
            {group.title ? (
              <p className="eyebrow px-3 pb-2 text-[var(--color-ink-muted)]/70">{group.title}</p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--color-ink-border)] p-3">
        <SidebarUser />
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
   Barra inferior + folha "Mais" (mobile)
--------------------------------------------------------------------------- */

function MoreSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: NavItem[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const session = useCurrentSession();
  const { leave, pending } = useLogoutAndLeave();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="more-sheet-title"
      onClick={(event) => {
        // Clique no backdrop (fora da folha) fecha.
        if (event.target === ref.current) onClose();
      }}
      className="animate-sheet-up m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-[var(--radius-xl)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] backdrop:bg-black/45 lg:hidden"
    >
      <div className="safe-bottom">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 id="more-sheet-title" className="text-base font-semibold">
            Mais opções
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-10 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 border-y border-[var(--color-border)] px-5 py-3.5">
          <Avatar name={session.user.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{session.user.name}</p>
            <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
              {ROLE_LABELS[session.user.role]} · {session.tenant.name}
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-2 p-4">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border px-2 py-3 text-center text-[0.8125rem] font-medium',
                      isActive
                        ? 'border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
                    )
                  }
                >
                  <Icon aria-hidden className="size-5" />
                  <span className="leading-tight">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="px-4 pb-5">
          <button
            type="button"
            onClick={() => void leave()}
            disabled={pending}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-danger)] disabled:opacity-60"
          >
            <LogOut aria-hidden className="size-4" />
            Sair da conta
          </button>
        </div>
      </div>
    </dialog>
  );
}

function BottomNav() {
  const groups = useVisibleGroups();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const allItems = groups.flatMap((group) => group.items);
  const primary = MOBILE_PRIMARY_ROUTES.map((route) => allItems.find((item) => item.to === route)).filter(
    (item): item is NavItem => Boolean(item),
  );
  const secondary = allItems.filter((item) => !MOBILE_PRIMARY_ROUTES.includes(item.to));
  const moreActive = secondary.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex h-[var(--spacing-bottomnav)] max-w-lg items-stretch justify-around px-1">
          {primary.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/painel'}
                  className={({ isActive }) =>
                    cn(
                      'flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
                      isActive ? 'text-[var(--color-brand-text)]' : 'text-[var(--color-text-subtle)]',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                          isActive && 'bg-[var(--color-brand-subtle)]',
                        )}
                      >
                        <Icon aria-hidden className="size-5" />
                      </span>
                      {item.shortLabel ?? item.label}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          {secondary.length > 0 ? (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={cn(
                  'flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium',
                  moreActive ? 'text-[var(--color-brand-text)]' : 'text-[var(--color-text-subtle)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full',
                    moreActive && 'bg-[var(--color-brand-subtle)]',
                  )}
                >
                  <MoreHorizontal aria-hidden className="size-5" />
                </span>
                Mais
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={secondary} />
    </>
  );
}

/* ---------------------------------------------------------------------------
   Layout
--------------------------------------------------------------------------- */

export function AppLayout() {
  const location = useLocation();
  const session = useCurrentSession();
  const { can } = useSession();
  const blocked = session.billing.access.blocked;

  // Trocar de rota leva o foco/scroll ao topo -- no mobile, sem isso a nova
  // tela abre no meio da rolagem da anterior.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // O bloqueio que vale e o do backend (toda escrita passa por
  // assertActiveAccess). Isto e so a navegacao evitando levar o usuario a uma
  // tela que vai falhar de cara.
  if (blocked && !isAllowedWhenBlocked(location.pathname)) {
    return <Navigate to="/upgrade" replace />;
  }

  const canSchedule = can(Permission.APPOINTMENTS_WRITE) && !blocked;

  return (
    <div className="min-h-dvh bg-[var(--color-canvas)]">
      {/* Link de pulo: primeiro item no tab order, visivel apenas com foco. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-md)]"
      >
        Pular para o conteúdo
      </a>

      <Sidebar />

      <div className="lg:pl-[var(--spacing-sidebar)]">
        <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-canvas)]/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-[var(--spacing-topbar)] lg:px-8">
            <div className="min-w-0 lg:hidden">
              <TenantBrand tone="dark" />
            </div>
            <div className="hidden lg:block" />

            {canSchedule ? (
              <Link
                to="/agenda?novo=1"
                // Na propria agenda o cabecalho da pagina ja tem o botao (desktop).
                className={buttonClasses('primary', 'md', cn('shrink-0 max-sm:h-9 max-sm:px-3', location.pathname === '/agenda' && 'sm:hidden'))}
              >
                <CalendarPlus aria-hidden className="size-4" />
                <span className="max-sm:sr-only">Novo agendamento</span>
              </Link>
            ) : null}
          </div>
        </header>

        <TrialBanner billing={session.billing} />

        <main id="conteudo" className="pb-bottomnav mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
