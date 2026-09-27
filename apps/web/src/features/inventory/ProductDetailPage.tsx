import { PRODUCT_UNIT_LABELS, Permission, type ProductDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpDown, History, Pencil, Power } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card, CardHeader, ErrorState, InfoItem, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatQuantity } from '@/lib/format';
import { MovementsList } from './MovementsList';
import { ProductFormDrawer } from './ProductFormDrawer';
import { StockBadge } from './ProductsPage';
import { StockMovementDialog } from './StockMovementDialog';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);

  const query = useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => api.get<ProductDto>(`/products/${id}`),
    enabled: Boolean(id),
  });

  const toggle = useMutation({
    mutationFn: (active: boolean) => api.patch<ProductDto>(`/products/${id}`, { active }),
    onSuccess: async (product) => {
      setConfirmToggle(false);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(product.active ? 'Produto reativado.' : 'Produto desativado.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível alterar.'),
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando produto</span>
        <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar este produto.'}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  const product = query.data;
  const margin =
    product.costPrice !== null && product.salePrice > 0
      ? Math.round(((product.salePrice - product.costPrice) / product.salePrice) * 1000) / 10
      : null;

  return (
    <>
      <Link
        to="/produtos"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft aria-hidden className="size-4" /> Produtos
      </Link>

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{product.name}</h1>
              <StockBadge product={product} />
              {!product.active ? <span className="text-sm text-[var(--color-text-muted)]">(inativo)</span> : null}
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {[product.category, product.sku ? `SKU ${product.sku}` : null, product.barcode ? `EAN ${product.barcode}` : null]
                .filter(Boolean)
                .join(' · ') || 'Sem categoria'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {can(Permission.STOCK_WRITE) && product.trackStock && product.active ? (
              <Button icon={<ArrowUpDown className="size-4" />} onClick={() => setMoveOpen(true)}>
                Movimentar estoque
              </Button>
            ) : null}
            {can(Permission.PRODUCTS_WRITE) ? (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                Editar
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 sm:grid-cols-4">
          {[
            { label: 'Saldo', value: product.trackStock ? formatQuantity(product.stockQuantity) : '--' },
            { label: 'Estoque mínimo', value: product.trackStock ? formatQuantity(product.minStock) : '--' },
            { label: 'Preço de venda', value: formatMoney(product.salePrice) },
            { label: 'Margem', value: margin === null ? '--' : `${formatQuantity(margin)}%` },
          ].map((cell, index) => (
            <div
              key={cell.label}
              className={cn(
                'px-5 py-3.5',
                index % 2 === 1 && 'border-l border-[var(--color-border)]',
                index >= 2 && 'border-t border-[var(--color-border)] sm:border-t-0',
                index === 2 && 'sm:border-l',
              )}
            >
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{cell.label}</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold tracking-tight">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Histórico de movimentações" icon={<History className="size-4" />} />
          <MovementsList productId={product.id} />
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Cadastro" />
            <dl className="grid grid-cols-2 gap-4 p-5">
              <InfoItem label="Unidade" value={PRODUCT_UNIT_LABELS[product.unit]} />
              <InfoItem label="Custo" value={product.costPrice === null ? 'Não informado' : formatMoney(product.costPrice)} muted={product.costPrice === null} />
              <InfoItem
                label="Margem"
                value={product.margin === null ? 'Sem custo' : `${(product.margin * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                muted={product.margin === null}
              />
              <InfoItem label="Marca" value={product.brandName ?? 'Sem marca'} muted={!product.brandName} />
              <InfoItem label="Fornecedor" value={product.supplierName ?? 'Não informado'} muted={!product.supplierName} />
              <InfoItem label="Categoria" value={product.category ?? 'Sem categoria'} muted={!product.category} />
              <InfoItem label="Controla estoque" value={product.trackStock ? 'Sim' : 'Não'} />
              <InfoItem label="Situação" value={product.active ? 'Ativo' : 'Inativo'} />
            </dl>
          </Card>
          {can(Permission.PRODUCTS_WRITE) ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">{product.active ? 'Desativar produto' : 'Reativar produto'}</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                {product.active
                  ? 'Some da busca de vendas. O histórico é mantido.'
                  : 'Volta a aparecer na busca de vendas.'}
              </p>
              <Button
                variant="secondary"
                className={cn('mt-4 w-full', product.active && 'text-[var(--color-danger)]')}
                icon={<Power className="size-4" />}
                onClick={() => setConfirmToggle(true)}
              >
                {product.active ? 'Desativar' : 'Reativar'}
              </Button>
            </Card>
          ) : null}
        </div>
      </div>

      {editOpen ? <ProductFormDrawer key={product.id} open product={product} onClose={() => setEditOpen(false)} /> : null}
      <StockMovementDialog open={moveOpen} product={product} onClose={() => setMoveOpen(false)} />
      <ConfirmDialog
        open={confirmToggle}
        title={product.active ? 'Desativar produto?' : 'Reativar produto?'}
        description={product.active ? 'O produto deixa de aparecer na busca de vendas.' : 'O produto volta a aparecer na busca de vendas.'}
        confirmLabel={product.active ? 'Desativar' : 'Reativar'}
        destructive={product.active}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate(!product.active)}
        onCancel={() => setConfirmToggle(false)}
      />
    </>
  );
}
