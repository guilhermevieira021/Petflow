import { Permission, type SupplierDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Truck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPhone } from '@/lib/format';
import { StockNav } from './StockNav';

function formatDocument(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
}

function SupplierDrawer({ supplier, onClose }: { supplier: SupplierDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      supplier ? api.patch<SupplierDto>(`/suppliers/${supplier.id}`, payload) : api.post<SupplierDto>('/suppliers', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(supplier ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    mutation.mutate({
      name: text('name'),
      document: text('document') || null,
      phone: text('phone') || null,
      email: text('email') || null,
      contactName: text('contactName') || null,
      notes: text('notes') || null,
    });
  }

  return (
    <Drawer open title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'} description="Distribuidora, representante ou fabricante." onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome" name="name" required autoFocus defaultValue={supplier?.name} error={apiError?.fieldError('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="CNPJ ou CPF" name="document" inputMode="numeric" defaultValue={formatDocument(supplier?.document ?? null) ?? ''} error={apiError?.fieldError('document')} />
          <TextField label="Telefone" name="phone" type="tel" defaultValue={supplier?.phone ? formatPhone(supplier.phone) : ''} error={apiError?.fieldError('phone')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Contato" name="contactName" defaultValue={supplier?.contactName ?? ''} error={apiError?.fieldError('contactName')} />
          <TextField label="E-mail" name="email" type="email" defaultValue={supplier?.email ?? ''} error={apiError?.fieldError('email')} />
        </div>
        <TextAreaField label="Observações" name="notes" rows={3} defaultValue={supplier?.notes ?? ''} error={apiError?.fieldError('notes')} />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {supplier ? 'Salvar' : 'Cadastrar fornecedor'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function SuppliersPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const canWrite = can(Permission.PRODUCTS_WRITE);

  const query = useQuery({
    queryKey: ['suppliers', 'list', search],
    queryFn: () => api.get<SupplierDto[]>('/suppliers', { search: search || undefined, includeInactive: 'true' }),
    placeholderData: (previous) => previous,
  });
  const toggle = useMutation({
    mutationFn: (supplier: SupplierDto) => api.patch<SupplierDto>(`/suppliers/${supplier.id}`, { active: !supplier.active }),
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(supplier.active ? 'Fornecedor reativado.' : 'Fornecedor desativado.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível alterar.'),
  });
  const suppliers = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description="Quem vende para o seu pet shop. Associe o fornecedor a cada produto."
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Cadastrar fornecedor
            </Button>
          ) : null
        }
      />
      <StockNav />
      <SearchInput value={search} onChange={setSearch} placeholder="Nome, contato ou CNPJ" label="Buscar fornecedor" className="mb-4 md:max-w-sm" />
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : null}
        {query.isError ? <ErrorState message="Não foi possível carregar." onRetry={() => void query.refetch()} /> : null}
        {query.data && suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="size-5" />}
            title={search ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
            description={canWrite ? 'Cadastre as distribuidoras de quem você compra.' : undefined}
          />
        ) : null}
        {suppliers.length > 0 ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3.5', !supplier.active && 'opacity-60')}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{supplier.name}</span>
                    {!supplier.active ? <Badge>Inativo</Badge> : null}
                  </p>
                  <p className="truncate text-[0.75rem] text-[var(--color-text-muted)]">
                    {[formatDocument(supplier.document), supplier.contactName, supplier.phone ? formatPhone(supplier.phone) : null, supplier.email]
                      .filter(Boolean)
                      .join(' · ') || 'Sem dados de contato'}
                  </p>
                </div>
                <Link
                  to={`/produtos?fornecedor=${supplier.id}`}
                  className="text-[0.8125rem] text-[var(--color-brand-text)] hover:underline"
                >
                  {supplier.productCount} {supplier.productCount === 1 ? 'produto' : 'produtos'}
                </Link>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(supplier)}
                      aria-label={`Editar ${supplier.name}`}
                      className="flex size-8 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                    >
                      <Pencil aria-hidden className="size-3.5" />
                    </button>
                    <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === supplier.id} onClick={() => toggle.mutate(supplier)}>
                      {supplier.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {editing ? <SupplierDrawer supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
