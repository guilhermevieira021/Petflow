import { Permission } from '@petflow/contracts';
import { NavLink } from 'react-router-dom';
import { useSession } from '@/features/auth/session';
import { cn } from '@/lib/cn';

const ITEMS: { to: string; label: string; end?: boolean; permission?: Permission }[] = [
  { to: '/estoque', label: 'Visão geral', end: true },
  { to: '/produtos', label: 'Produtos' },
  { to: '/estoque/entrada', label: 'Entrada rápida', permission: Permission.STOCK_RECEIVE },
  { to: '/estoque/saida', label: 'Saída', permission: Permission.STOCK_WRITE },
  { to: '/estoque/baixo', label: 'Estoque baixo' },
  { to: '/estoque/movimentacoes', label: 'Movimentações' },
  { to: '/estoque/marcas', label: 'Marcas' },
  { to: '/estoque/fornecedores', label: 'Fornecedores' },
  { to: '/estoque/categorias', label: 'Categorias' },
];

/** Abas do modulo de estoque. Rolam na horizontal no mobile. */
export function StockNav() {
  const { can } = useSession();
  return (
    <nav aria-label="Seções do estoque" className="scroll-x -mx-4 mb-5 border-b border-[var(--color-border)] px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        {ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => (
          <li key={item.to} className="shrink-0">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'block border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-[var(--color-brand)] text-[var(--color-brand-text)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
