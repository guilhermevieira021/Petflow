import { Permission, type InventorySummaryDto, type Paginated, type ProductDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Package, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { FilterChip, SearchInput } from '@/components/ui/SearchInput';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatQuantity } from '@/lib/format';
import { ProductFormDrawer } from './ProductFormDrawer';
import { StockNav } from './StockNav';

type Filter = 'active' | 'low' | 'inactive' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'low', label: 'Estoque baixo' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

export function StockBadge({ product }: { product: ProductDto }) {
  if (!product.trackStock) return <Badge>Sem controle</Badge>;
  if (product.stockQuantity <= 0) return <Badge dot tone="danger">Sem estoque</Badge>;
  if (product.lowStock) return <Badge dot tone="warning">Baixo</Badge>;
  return <Badge dot tone="success">Ok</Badge>;
}

export function InventorySummaryStrip() {
  const query = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => api.get<InventorySummaryDto>('/inventory/summary'),
  });
  if (!query.data) return <Skeleton className="mb-4 h-20 w-full rounded-[var(--radius-lg)]" />;
  const data = query.data;
  const cells = [
    { label: 'Produtos ativos', value: String(data.activeProducts) },
    { label: 'Estoque baixo', value: String(data.lowStockProducts), tone: data.lowStockProducts > 0 ? 'warning' : undefined },
    { label: 'Sem estoque', value: String(data.outOfStockProducts), tone: data.outOfStockProducts > 0 ? 'danger' : undefined },
    { label: 'Valor em estoque (custo)', value: formatMoney(data.stockCostValue) },
  ];
  return (
    <Card className="mb-4 @container">
      <dl className="grid grid-cols-2 @2xl:grid-cols-4">
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={cn(
              'min-w-0 px-5 py-4',
              index % 2 === 1 && 'border-l border-[var(--color-border)]',
              index >= 2 && 'border-t border-[var(--color-border)] @2xl:border-t-0',
              index === 2 && '@2xl:border-l',
            )}
          >
            <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{cell.label}</dt>
            <dd
              className={cn(
                'tabular mt-1 truncate text-lg font-semibold tracking-tight',
                cell.tone === 'warning' && 'text-[var(--color-warning)]',
                cell.tone === 'danger' && 'text-[var(--color-danger)]',
              )}
            >
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>
      {data.productsWithoutCost > 0 ? (
        <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-[0.75rem] text-[var(--color-text-muted)]">
          {data.productsWithoutCost} {data.productsWithoutCost === 1 ? 'produto sem custo informado não entra' : 'produtos sem custo informado não entram'} no valor em estoque.
        </p>
      ) : null}
    </Card>
  );
}

export function ProductsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('categoria') ?? undefined;
  const supplierId = searchParams.get('fornecedor') ?? undefined;
  const canWrite = can(Permission.PRODUCTS_WRITE);

  const query = useQuery({
    queryKey: ['products', 'list', { search, filter, page, category, supplierId }],
    queryFn: () =>
      api.get<Paginated<ProductDto>>('/products', {
        search: search || undefined,
        category,
        supplierId,
        active: filter === 'active' || filter === 'low' ? 'true' : filter === 'inactive' ? 'false' : undefined,
        lowStock: filter === 'low' ? 'true' : undefined,
        page,
        pageSize: 20,
      }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo do pet shop, com preço, custo e saldo em estoque."
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo produto
            </Button>
          ) : null
        }
      />

      <StockNav />
      <InventorySummaryStrip />

      {supplierId ? (
        <p className="mb-3 flex items-center gap-2 text-sm">
          Filtrando por fornecedor.
          <button type="button" onClick={() => setSearchParams({})} className="font-medium text-[var(--color-brand-text)] hover:underline">
            Limpar filtro
          </button>
        </p>
      ) : null}
      {category ? (
        <p className="mb-3 flex items-center gap-2 text-sm">
          Categoria:
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="flex items-center gap-1 rounded-full bg-[var(--color-brand-subtle)] px-3 py-1 font-medium text-[var(--color-brand-text)]"
            aria-label={`Remover filtro da categoria ${category}`}
          >
            {category}
            <X aria-hidden className="size-3.5" />
          </button>
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por nome, marca, SKU ou código de barras"
          label="Buscar produtos"
          className="flex-1"
        />
        <div className="scroll-x -mx-4 flex gap-2 px-4 md:mx-0 md:px-0" role="group" aria-label="Filtrar produtos">
          {FILTERS.map((option) => (
            <FilterChip
              key={option.value}
              active={filter === option.value}
              onClick={() => {
                setFilter(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando produtos</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : null}
        {query.isError ? (
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data && query.data.data.length === 0 ? (
          <EmptyState
            icon={filter === 'low' ? <AlertTriangle className="size-5" /> : <Package className="size-5" />}
            title={
              filter === 'low'
                ? 'Nenhum produto com estoque baixo'
                : search
                  ? 'Nenhum produto encontrado'
                  : 'Nenhum produto cadastrado'
            }
            description={filter === 'low' ? 'Tudo acima do mínimo definido.' : 'Cadastre produtos para vendê-los e controlar o estoque.'}
            action={
              canWrite && !search && filter === 'active' ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
                  Cadastrar produto
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            <div className="hidden md:block">
              <table className="w-full text-[0.8125rem]">
                <caption className="sr-only">Lista de produtos</caption>
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-left text-[var(--color-text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Produto</th>
                    <th scope="col" className="px-4 py-3 font-medium">Categoria</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Preço</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Margem</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Mínimo</th>
                    <th scope="col" className="px-4 py-3 font-medium">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {query.data.data.map((product) => (
                    <tr
                      key={product.id}
                      onClick={() => navigate(`/produtos/${product.id}`)}
                      className={cn('cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]', !product.active && 'opacity-60')}
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`/produtos/${product.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="block truncate text-sm font-semibold hover:underline"
                        >
                          {product.name}
                        </Link>
                        <span className="block text-[0.75rem] text-[var(--color-text-muted)]">
                          {[product.brandName, product.sku ?? 'Sem SKU'].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{product.category ?? '--'}</td>
                      <td className="tabular px-4 py-3 text-right">{formatMoney(product.salePrice)}</td>
                      <td
                        className={cn(
                          'tabular px-4 py-3 text-right',
                          product.margin !== null && product.margin < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]',
                        )}
                      >
                        {product.margin === null ? '--' : `${(product.margin * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-semibold">{product.trackStock ? formatQuantity(product.stockQuantity) : '--'}</td>
                      <td className="tabular px-4 py-3 text-right text-[var(--color-text-muted)]">{product.trackStock ? formatQuantity(product.minStock) : '--'}</td>
                      <td className="px-4 py-3">
                        <StockBadge product={product} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-[var(--color-border)] md:hidden">
              {query.data.data.map((product) => (
                <li key={product.id}>
                  <Link to={`/produtos/${product.id}`} className={cn('flex items-center gap-3 px-4 py-3.5', !product.active && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-semibold">{product.name}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[0.8125rem] text-[var(--color-text-muted)]">
                        {product.brandName ? <span className="truncate">{product.brandName} ·</span> : null}
                        <span className="tabular">{formatMoney(product.salePrice)}</span>
                        {product.trackStock ? <span className="tabular">· saldo {formatQuantity(product.stockQuantity)}</span> : null}
                      </p>
                    </div>
                    <StockBadge product={product} />
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      {drawerOpen ? <ProductFormDrawer open onClose={() => setDrawerOpen(false)} onSaved={(product) => navigate(`/produtos/${product.id}`)} /> : null}
    </>
  );
}
