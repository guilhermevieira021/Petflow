import { Permission, type Paginated, type ProductDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, PackageMinus, ScanBarcode, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { formatQuantity } from '@/lib/format';
import { MovementsList } from './MovementsList';
import { InventorySummaryStrip, StockBadge } from './ProductsPage';
import { StockNav } from './StockNav';

const SHORTCUTS = [
  {
    to: '/estoque/entrada',
    title: 'Entrada rápida',
    text: 'Bipe as mercadorias recebidas.',
    icon: ScanBarcode,
    permission: Permission.STOCK_RECEIVE,
  },
  { to: '/estoque/saida', title: 'Saída', text: 'Perdas, vencidos, consumo interno.', icon: PackageMinus, permission: Permission.STOCK_WRITE },
  { to: '/estoque/marcas', title: 'Marcas', text: 'Catálogo e marcas próprias.', icon: Tag, permission: Permission.PRODUCTS_READ },
];

/** Visao do estoque: alertas de saldo baixo e o historico completo. */
export function StockPage() {
  const { can } = useSession();
  const lowStock = useQuery({
    queryKey: ['products', 'low-stock'],
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { lowStock: 'true', active: 'true', pageSize: 50, sort: 'stockQuantity' }),
  });

  return (
    <>
      <PageHeader title="Estoque" description="Alertas de reposição e todas as entradas, saídas e ajustes." />
      <StockNav />
      <InventorySummaryStrip />

      <ul className="mb-4 grid gap-3 sm:grid-cols-3">
        {SHORTCUTS.filter((item) => can(item.permission)).map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex h-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--color-brand-subtle)]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]">
                <item.icon aria-hidden className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="block text-[0.75rem] text-[var(--color-text-muted)]">{item.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <CardHeader
            title="Repor em breve"
            icon={<AlertTriangle className="size-4" />}
            action={
              <Link to="/estoque/baixo" className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
                Ver todos
              </Link>
            }
          />
          {lowStock.isLoading ? (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : lowStock.data && lowStock.data.data.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 className="size-5" />} title="Nada abaixo do mínimo" />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(lowStock.data?.data ?? []).map((product) => (
                <li key={product.id}>
                  <Link to={`/produtos/${product.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)]">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{product.name}</span>
                      <span className="tabular block text-[0.75rem] text-[var(--color-text-muted)]">
                        Saldo {formatQuantity(product.stockQuantity)} · mínimo {formatQuantity(product.minStock)}
                      </span>
                    </span>
                    <StockBadge product={product} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title="Últimas movimentações"
            icon={<History className="size-4" />}
            action={
              <Link to="/estoque/movimentacoes" className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
                Histórico completo
              </Link>
            }
          />
          <MovementsList showProduct pageSize={10} />
        </Card>
      </div>
    </>
  );
}
