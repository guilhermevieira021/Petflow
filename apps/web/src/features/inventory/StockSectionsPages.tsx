import {
  BRAND_SEGMENT_LABELS,
  Permission,
  STOCK_MOVEMENT_SOURCE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  type BrandDto,
  type BrandSegment,
  type Paginated,
  type ProductCategoryDto,
  type ProductDto,
  type StockMovementSource,
  type StockMovementType,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, Pencil, Plus, Tag, Tags } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { FilterChip, SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatQuantity } from '@/lib/format';
import { MovementsList } from './MovementsList';
import { StockBadge } from './ProductsPage';
import { StockNav } from './StockNav';

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Estoque baixo
--------------------------------------------------------------------------- */

export function LowStockPage() {
  const { can } = useSession();
  const query = useQuery({
    queryKey: ['products', 'low-stock', 'page'],
    queryFn: () =>
      api.get<Paginated<ProductDto>>('/products', {
        lowStock: 'true',
        active: 'true',
        pageSize: 100,
        sort: 'stockQuantity',
        order: 'asc',
      }),
  });
  const items = query.data?.data ?? [];
  const total = query.data?.pagination.total ?? 0;

  return (
    <>
      <PageHeader
        title="Estoque baixo"
        description="Produtos com saldo igual ou abaixo do estoque mínimo."
        action={
          can(Permission.STOCK_RECEIVE) ? (
            <Link to="/estoque/entrada" className={buttonClasses('primary')}>
              <Plus aria-hidden className="size-4" />
              Dar entrada
            </Link>
          ) : null
        }
      />
      <StockNav />
      <Card className="overflow-hidden">
        <CardHeader
          title="Repor"
          icon={<AlertTriangle className="size-4" />}
          action={query.data ? <Badge tone={total > 0 ? 'warning' : 'success'}>{total}</Badge> : null}
        />
        {query.isLoading ? <ListSkeleton /> : null}
        {query.isError ? <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} /> : null}
        {query.data && items.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-5" />}
            title="Nada abaixo do mínimo"
            description="Todos os produtos estão acima do estoque mínimo."
          />
        ) : null}
        {items.length > 0 ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((product) => {
              const missing = Math.max(0, product.minStock - product.stockQuantity);
              const unitLabel =
                product.unit === 'UN' ? (product.stockQuantity === 1 ? 'unidade' : 'unidades') : product.unit.toLowerCase();
              return (
                <li
                  key={product.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 border-l-4 px-5 py-3.5',
                    product.stockQuantity <= 0 ? 'border-l-[var(--color-danger)]' : 'border-l-[var(--color-warning)]',
                  )}
                >
                  <Link to={`/produtos/${product.id}`} className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold hover:underline">
                        {product.stockQuantity <= 0
                          ? `${product.name} está sem estoque.`
                          : `${product.name} está com apenas ${formatQuantity(product.stockQuantity)} ${unitLabel}.`}
                      </p>
                      <p className="tabular text-[0.75rem] text-[var(--color-text-muted)]">
                        {[product.brandName, product.category].filter(Boolean).join(' · ')}
                        {product.brandName || product.category ? ' · ' : ''}
                        saldo {formatQuantity(product.stockQuantity)} · mínimo {formatQuantity(product.minStock)}
                        {missing > 0 ? ` · faltam ${formatQuantity(missing)}` : ''}
                      </p>
                    </div>
                    <StockBadge product={product} />
                  </Link>
                  {can(Permission.STOCK_RECEIVE) ? (
                    <Link to={`/estoque/entrada?produto=${product.id}`} className={buttonClasses('secondary', 'sm')}>
                      <Plus aria-hidden className="size-3.5" />
                      Repor estoque
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Movimentacoes
--------------------------------------------------------------------------- */

export function MovementsPage() {
  const [type, setType] = useState<StockMovementType | 'ALL'>('ALL');
  const [source, setSource] = useState<StockMovementSource | 'ALL'>('ALL');

  return (
    <>
      <PageHeader
        title="Movimentações"
        description="Histórico completo e imutável: entradas, saídas, vendas, estornos, ajustes e devoluções."
      />
      <StockNav />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <SelectField
          label="Tipo"
          value={type}
          onChange={(event) => setType(event.target.value as StockMovementType | 'ALL')}
          options={[
            { value: 'ALL', label: 'Todos os tipos' },
            ...(Object.keys(STOCK_MOVEMENT_TYPE_LABELS) as StockMovementType[]).map((key) => ({
              value: key,
              label: STOCK_MOVEMENT_TYPE_LABELS[key],
            })),
          ]}
        />
        <SelectField
          label="Origem"
          value={source}
          onChange={(event) => setSource(event.target.value as StockMovementSource | 'ALL')}
          options={[
            { value: 'ALL', label: 'Todas as origens' },
            ...(Object.keys(STOCK_MOVEMENT_SOURCE_LABELS) as StockMovementSource[]).map((key) => ({
              value: key,
              label: STOCK_MOVEMENT_SOURCE_LABELS[key],
            })),
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Histórico" icon={<History className="size-4" />} />
        <MovementsList
          key={`${type}-${source}`}
          showProduct
          pageSize={25}
          type={type === 'ALL' ? undefined : type}
          source={source === 'ALL' ? undefined : source}
        />
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Marcas
--------------------------------------------------------------------------- */

type Origin = 'all' | 'own' | 'reference';

function BrandDrawer({ brand, onClose }: { brand: BrandDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (payload: { name: string; segment: BrandSegment }) =>
      brand ? api.patch<BrandDto>(`/brands/${brand.id}`, payload) : api.post<BrandDto>('/brands', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast.success(brand ? 'Marca atualizada.' : 'Marca cadastrada.');
      onClose();
    },
  });
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      name: String(data.get('name') ?? ''),
      segment: String(data.get('segment')) as BrandSegment,
    });
  }

  return (
    <Drawer
      open
      title={brand ? 'Editar marca' : 'Nova marca'}
      description="Marca própria do seu pet shop. Depois, associe-a aos produtos."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Nome"
          name="name"
          required
          autoFocus
          defaultValue={brand?.name}
          placeholder="Ex.: Joãozinho Rações"
          error={apiError?.fieldError('name') ?? (apiError && apiError.fields.length === 0 ? apiError.message : undefined)}
        />
        <SelectField
          label="Segmento"
          name="segment"
          defaultValue={brand?.segment ?? 'GENERAL'}
          options={(Object.keys(BRAND_SEGMENT_LABELS) as BrandSegment[]).map((key) => ({
            value: key,
            label: BRAND_SEGMENT_LABELS[key],
          }))}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {brand ? 'Salvar' : 'Cadastrar marca'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function BrandsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState<Origin>('all');
  const [segment, setSegment] = useState<BrandSegment | 'ALL'>('ALL');
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);
  const canWrite = can(Permission.PRODUCTS_WRITE);

  const query = useQuery({
    queryKey: ['brands', 'list', { search, origin, segment }],
    queryFn: () =>
      api.get<BrandDto[]>('/brands', {
        search: search || undefined,
        origin,
        segment: segment === 'ALL' ? undefined : segment,
        includeInactive: 'true',
      }),
    placeholderData: (previous) => previous,
  });

  const toggle = useMutation({
    mutationFn: (brand: BrandDto) => api.patch<BrandDto>(`/brands/${brand.id}`, { active: !brand.active }),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast.success(brand.active ? 'Marca reativada.' : 'Marca desativada. Ela não aparece mais no cadastro de produtos.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível alterar.'),
  });

  const brands = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Marcas"
        description="O catálogo já traz marcas conhecidas do mercado pet. Cadastre as que faltarem, como marcas regionais."
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Cadastrar marca
            </Button>
          ) : null
        }
      />
      <StockNav />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar marca"
            label="Buscar marca"
            className="md:max-w-sm md:flex-1"
          />
          <SegmentedControl<Origin>
            label="Origem das marcas"
            value={origin}
            onChange={setOrigin}
            size="sm"
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'own', label: 'Suas marcas' },
              { value: 'reference', label: 'Catálogo Petflow' },
            ]}
          />
        </div>
        <div className="scroll-x -mx-4 flex gap-2 px-4 md:mx-0 md:px-0" role="group" aria-label="Filtrar por segmento">
          <FilterChip active={segment === 'ALL'} onClick={() => setSegment('ALL')}>
            Todos
          </FilterChip>
          {(Object.keys(BRAND_SEGMENT_LABELS) as BrandSegment[]).map((key) => (
            <FilterChip key={key} active={segment === key} onClick={() => setSegment(key)}>
              {BRAND_SEGMENT_LABELS[key]}
            </FilterChip>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? <ListSkeleton rows={6} /> : null}
        {query.isError ? <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} /> : null}
        {query.data && brands.length === 0 ? (
          <EmptyState
            icon={<Tag className="size-5" />}
            title={origin === 'own' && !search ? 'Nenhuma marca própria ainda' : 'Nenhuma marca encontrada'}
            description={canWrite ? 'Cadastre a marca para associá-la aos produtos.' : undefined}
          />
        ) : null}
        {brands.length > 0 ? (
          <ul className="grid divide-y divide-[var(--color-border)] md:grid-cols-2 md:divide-y-0 xl:grid-cols-3">
            {brands.map((brand) => (
              <li
                key={brand.id}
                className={cn(
                  'flex items-center gap-3 border-[var(--color-border)] px-5 py-3 md:border-b',
                  !brand.active && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold">
                    <span className="truncate">{brand.name}</span>
                    {brand.isReference ? null : <Badge tone="brand">Sua</Badge>}
                    {!brand.active ? <Badge>Inativa</Badge> : null}
                  </p>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                    {BRAND_SEGMENT_LABELS[brand.segment]} · {brand.productCount}{' '}
                    {brand.productCount === 1 ? 'produto' : 'produtos'}
                  </p>
                </div>
                {canWrite && !brand.isReference ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(brand)}
                      aria-label={`Editar ${brand.name}`}
                      className="flex size-8 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                    >
                      <Pencil aria-hidden className="size-3.5" />
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={toggle.isPending && toggle.variables?.id === brand.id}
                      onClick={() => toggle.mutate(brand)}
                    >
                      {brand.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <p className="mt-3 text-[0.75rem] text-[var(--color-text-subtle)]">
        Marcas do catálogo Petflow são apenas nomes de referência: nenhum produto, preço ou código de barras vem junto.
      </p>

      {editing ? <BrandDrawer brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Categorias
--------------------------------------------------------------------------- */

function RenameCategoryDrawer({ category, onClose }: { category: ProductCategoryDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (to: string) =>
      api.patch<{ updated: number }>('/inventory/categories', {
        from: category.name,
        to,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['inventory', 'categories'],
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${result.updated} ${result.updated === 1 ? 'produto atualizado' : 'produtos atualizados'}.`);
      onClose();
    },
  });
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer
      open
      title="Renomear categoria"
      description={`Todos os produtos em "${category.name}" passam para o novo nome.`}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(String(new FormData(event.currentTarget).get('to') ?? ''));
        }}
      >
        <TextField
          label="Novo nome"
          name="to"
          required
          autoFocus
          defaultValue={category.name}
          error={apiError?.fieldError('to') ?? (apiError && apiError.fields.length === 0 ? apiError.message : undefined)}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Renomear
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function CategoriesPage() {
  const { can } = useSession();
  const [renaming, setRenaming] = useState<ProductCategoryDto | null>(null);
  const query = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: () => api.get<ProductCategoryDto[]>('/inventory/categories'),
  });
  const categories = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Categorias"
        description="Agrupam os produtos para busca e relatórios. Defina a categoria no cadastro de cada produto."
      />
      <StockNav />
      <Card className="overflow-hidden">
        <CardHeader title="Categorias em uso" icon={<Tags className="size-4" />} />
        {query.isLoading ? <ListSkeleton /> : null}
        {query.isError ? <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} /> : null}
        {query.data && categories.length === 0 ? (
          <EmptyState
            icon={<Tags className="size-5" />}
            title="Nenhuma categoria ainda"
            description="Ao cadastrar um produto, escolha uma categoria sugerida (Ração, Petiscos, Higiene…) ou digite uma nova."
          />
        ) : null}
        {categories.length > 0 ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {categories.map((category) => (
              <li key={category.name} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/produtos?categoria=${encodeURIComponent(category.name)}`}
                    className="truncate text-sm font-semibold hover:underline"
                  >
                    {category.name}
                  </Link>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)]">
                    {category.products} {category.products === 1 ? 'produto' : 'produtos'}
                    {category.lowStock > 0 ? (
                      <span className="text-[var(--color-warning)]"> · {category.lowStock} com estoque baixo</span>
                    ) : null}
                  </p>
                </div>
                {can(Permission.PRODUCTS_WRITE) ? (
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setRenaming(category)}>
                    Renomear
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {renaming ? <RenameCategoryDrawer category={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}
