import { PRODUCT_UNIT_LABELS, type ProductDto, type ProductUnit } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { parseDecimal } from '@/lib/decimal';

function decimalOrUndefined(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? '').trim();
  return text ? parseDecimal(text) : undefined;
}

export function ProductFormDrawer({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product?: ProductDto;
  onClose: () => void;
  onSaved?: (product: ProductDto) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(product);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing ? api.patch<ProductDto>(`/products/${product!.id}`, payload) : api.post<ProductDto>('/products', payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(isEditing ? 'Produto atualizado.' : 'Produto cadastrado.');
      onSaved?.(result);
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setLocalError(null);
    const data = new FormData(event.currentTarget);
    const salePrice = decimalOrUndefined(data.get('salePrice'));
    const costPrice = decimalOrUndefined(data.get('costPrice'));
    const minStock = decimalOrUndefined(data.get('minStock'));
    const initialStock = decimalOrUndefined(data.get('initialStock'));

    if ([salePrice, costPrice, minStock, initialStock].some((value) => value !== undefined && Number.isNaN(value))) {
      setLocalError('Confira os valores numéricos (use vírgula para decimais).');
      return;
    }

    const payload: Record<string, unknown> = {
      name: String(data.get('name') ?? ''),
      sku: String(data.get('sku') ?? '').trim() || null,
      barcode: String(data.get('barcode') ?? '').trim() || null,
      category: String(data.get('category') ?? '').trim() || null,
      unit: String(data.get('unit') ?? 'UN') as ProductUnit,
      salePrice,
      costPrice: costPrice ?? null,
      minStock: minStock ?? 0,
      trackStock,
    };
    if (!isEditing) payload.initialStock = trackStock ? (initialStock ?? 0) : 0;
    mutation.mutate(payload);
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer
      open={open}
      title={isEditing ? 'Editar produto' : 'Novo produto'}
      description={isEditing ? 'O saldo muda somente por movimentação de estoque.' : 'Cadastre o produto e, se quiser, o saldo inicial.'}
      onClose={onClose}
    >
      <form key={product?.id ?? 'new'} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome" name="name" required defaultValue={product?.name} error={apiError?.fieldError('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="SKU (código interno)" name="sku" defaultValue={product?.sku ?? ''} error={apiError?.fieldError('sku')} />
          <TextField
            label="Código de barras"
            name="barcode"
            inputMode="numeric"
            defaultValue={product?.barcode ?? ''}
            hint="Preparado para leitor no futuro."
            error={apiError?.fieldError('barcode')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Categoria" name="category" placeholder="Ex.: Ração, Higiene" defaultValue={product?.category ?? ''} />
          <SelectField
            label="Unidade"
            name="unit"
            defaultValue={product?.unit ?? 'UN'}
            options={(Object.keys(PRODUCT_UNIT_LABELS) as ProductUnit[]).map((unit) => ({ value: unit, label: PRODUCT_UNIT_LABELS[unit] }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Preço de venda (R$)"
            name="salePrice"
            inputMode="decimal"
            required
            defaultValue={product ? String(product.salePrice).replace('.', ',') : ''}
            error={apiError?.fieldError('salePrice')}
          />
          <TextField
            label="Custo (R$)"
            name="costPrice"
            inputMode="decimal"
            defaultValue={product?.costPrice != null ? String(product.costPrice).replace('.', ',') : ''}
            error={apiError?.fieldError('costPrice')}
          />
        </div>

        <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5">
          <input
            type="checkbox"
            checked={trackStock}
            onChange={(event) => setTrackStock(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span>
            <span className="block text-sm font-medium">Controlar estoque</span>
            <span className="block text-[0.8125rem] text-[var(--color-text-muted)]">
              Vendas baixam o saldo e o sistema avisa quando chegar ao mínimo.
            </span>
          </span>
        </label>

        {trackStock ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Estoque mínimo"
              name="minStock"
              inputMode="decimal"
              defaultValue={product ? String(product.minStock).replace('.', ',') : '0'}
              error={apiError?.fieldError('minStock')}
            />
            {!isEditing ? (
              <TextField
                label="Saldo inicial"
                name="initialStock"
                inputMode="decimal"
                defaultValue="0"
                hint="Registrado como entrada no histórico."
                error={apiError?.fieldError('initialStock')}
              />
            ) : null}
          </div>
        ) : null}

        {localError ? (
          <p role="alert" className="text-[0.8125rem] text-[var(--color-danger)]">
            {localError}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? 'Salvar' : 'Cadastrar produto'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
