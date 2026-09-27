import { Permission, type SupplierDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: () => api.get<SupplierDto[]>('/suppliers'),
    staleTime: 60_000,
  });
}

/** Seletor de fornecedor com cadastro rapido (so o nome) sem sair do produto. */
export function SupplierSelect({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (supplierId: string | null) => void;
  error?: string;
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => api.post<SupplierDto>('/suppliers', { name }),
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onChange(supplier.id);
      setCreating(false);
      setName('');
    },
  });
  const createError = create.error instanceof ApiError ? create.error : null;

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Fornecedor"
        name="supplierId"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        options={[
          { value: '', label: suppliers.isLoading ? 'Carregando…' : 'Sem fornecedor' },
          ...(suppliers.data ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })),
        ]}
        error={error}
      />
      {can(Permission.PRODUCTS_WRITE) && !creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
        >
          <Plus aria-hidden className="size-3.5" />
          Cadastrar fornecedor
        </button>
      ) : null}
      {creating ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3">
          <TextField
            label="Nome do fornecedor"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Dentro do formulario do produto: Enter cadastra o fornecedor.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (name.trim()) create.mutate();
              }
            }}
            placeholder="Ex.: Distribuidora Pet Sul"
            hint="Dados completos (CNPJ, contato) em Estoque › Fornecedores."
            error={createError?.fieldError('name') ?? (createError && createError.fields.length === 0 ? createError.message : undefined)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Cadastrar fornecedor
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
