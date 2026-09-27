import { BRAND_SEGMENT_LABELS, Permission, type BrandDto, type BrandSegment } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';

export function useBrands() {
  return useQuery({
    queryKey: ['brands', 'active'],
    queryFn: () => api.get<BrandDto[]>('/brands'),
    staleTime: 60_000,
  });
}

/**
 * Seletor de marca: marcas proprias primeiro, depois o catalogo de
 * referencia. "+ Cadastrar marca" cria uma marca propria sem sair do
 * formulario do produto e ja a seleciona.
 */
export function BrandSelect({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (brandId: string | null) => void;
  error?: string;
}) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const brands = useBrands();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [segment, setSegment] = useState<BrandSegment>('GENERAL');

  const create = useMutation({
    mutationFn: () => api.post<BrandDto>('/brands', { name, segment }),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      onChange(brand.id);
      setCreating(false);
      setName('');
    },
  });

  const list = brands.data ?? [];
  const own = list.filter((brand) => !brand.isReference);
  const reference = list.filter((brand) => brand.isReference);
  const options = [
    { value: '', label: brands.isLoading ? 'Carregando marcas…' : 'Sem marca' },
    ...own.map((brand) => ({ value: brand.id, label: `${brand.name} (sua marca)` })),
    ...reference.map((brand) => ({ value: brand.id, label: brand.name })),
  ];
  const createError = create.error instanceof ApiError ? create.error : null;

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Marca"
        name="brandId"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        options={options}
        error={error}
        hint={can(Permission.PRODUCTS_WRITE) && !creating ? 'Não achou? Cadastre a marca abaixo.' : undefined}
      />
      {can(Permission.PRODUCTS_WRITE) && !creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
        >
          <Plus aria-hidden className="size-3.5" />
          Cadastrar marca
        </button>
      ) : null}
      {creating ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3">
          <TextField
            label="Nome da nova marca"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Este bloco vive dentro do formulario do produto: Enter aqui
              // cadastra a marca, nunca envia o produto pela metade.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (name.trim()) create.mutate();
              }
            }}
            placeholder="Ex.: Joãozinho Rações"
            error={createError?.fieldError('name') ?? (createError && createError.fields.length === 0 ? createError.message : undefined)}
          />
          <SelectField
            label="Segmento"
            value={segment}
            onChange={(event) => setSegment(event.target.value as BrandSegment)}
            options={(Object.keys(BRAND_SEGMENT_LABELS) as BrandSegment[]).map((key) => ({ value: key, label: BRAND_SEGMENT_LABELS[key] }))}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Cadastrar marca
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
