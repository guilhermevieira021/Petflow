import {
  PRODUCT_CATEGORY_SUGGESTIONS,
  PRODUCT_UNIT_LABELS,
  type ProductCategoryDto,
  type ProductDto,
  type ProductUnit,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanBarcode } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { parseDecimal } from '@/lib/decimal';
import { BrandSelect } from './BrandSelect';
import { PricingAssistant } from './PricingAssistant';
import { SupplierSelect } from './SupplierSelect';

function decimalOrUndefined(value: FormDataEntryValue | string | null): number | undefined {
  const text = String(value ?? '').trim();
  return text ? parseDecimal(text) : undefined;
}

function toInput(value: number | null | undefined): string {
  return value == null ? '' : value.toFixed(2).replace('.', ',');
}

/**
 * Cadastro/edicao de produto. Com `scannedCode`, e o cadastro de um produto
 * desconhecido bipado: o codigo vem preenchido e a quantidade recebida entra
 * no estoque na MESMA transacao do cadastro.
 *
 * Ordem pensada para "a gente faz por voce": o custo vem antes do preco, e o
 * assistente sugere o preco de venda a partir dele.
 */
export function ProductFormDrawer({
  open,
  product,
  scannedCode,
  onClose,
  onSaved,
}: {
  open: boolean;
  product?: ProductDto;
  scannedCode?: string;
  onClose: () => void;
  onSaved?: (product: ProductDto) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(product);
  const fromScanner = !isEditing && Boolean(scannedCode);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [brandId, setBrandId] = useState<string | null>(product?.brandId ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(product?.supplierId ?? null);
  const [category, setCategory] = useState(product?.category ?? '');
  const [costText, setCostText] = useState(toInput(product?.costPrice));
  const [priceText, setPriceText] = useState(product ? toInput(product.salePrice) : '');
  const [localError, setLocalError] = useState<string | null>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const categoriesListId = useId();

  const categories = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: () => api.get<ProductCategoryDto[]>('/inventory/categories'),
    staleTime: 60_000,
  });
  const categorySuggestions = [
    ...new Set([...(categories.data ?? []).map((item) => item.name), ...PRODUCT_CATEGORY_SUGGESTIONS]),
  ];

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing ? api.patch<ProductDto>(`/products/${product!.id}`, payload) : api.post<ProductDto>('/products', payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(
        isEditing ? 'Produto atualizado.' : fromScanner ? 'Produto cadastrado e entrada registrada.' : 'Produto cadastrado.',
      );
      onSaved?.(result);
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });

  const cost = decimalOrUndefined(costText);
  const price = decimalOrUndefined(priceText);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setLocalError(null);
    const data = new FormData(event.currentTarget);
    const minStock = decimalOrUndefined(data.get('minStock'));
    const initialStock = decimalOrUndefined(data.get('initialStock'));

    if ([price, cost, minStock, initialStock].some((value) => value !== undefined && Number.isNaN(value))) {
      setLocalError('Confira os valores numéricos (use vírgula para decimais).');
      return;
    }

    const payload: Record<string, unknown> = {
      name: String(data.get('name') ?? ''),
      sku: String(data.get('sku') ?? '').trim() || null,
      barcode: String(data.get('barcode') ?? '').trim() || null,
      brandId,
      supplierId,
      description: String(data.get('description') ?? '').trim() || null,
      category: category.trim() || null,
      unit: String(data.get('unit') ?? 'UN') as ProductUnit,
      salePrice: price,
      costPrice: cost ?? null,
      minStock: minStock ?? 0,
      trackStock,
    };
    if (!isEditing) {
      payload.initialStock = trackStock ? (initialStock ?? 0) : 0;
      if (fromScanner) payload.entrySource = 'BARCODE';
    }
    mutation.mutate(payload);
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer
      open={open}
      title={isEditing ? 'Editar produto' : fromScanner ? 'Cadastrar produto' : 'Novo produto'}
      description={
        isEditing
          ? 'O saldo muda somente por movimentação de estoque.'
          : fromScanner
            ? 'O código lido já está preenchido. Ao salvar, o produto é criado e o estoque recebido entra de uma vez.'
            : 'Cadastre o produto e, se quiser, o estoque inicial.'
      }
      onClose={onClose}
    >
      <form key={product?.id ?? scannedCode ?? 'new'} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {fromScanner ? (
          <p className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] px-3.5 py-2.5 text-[0.8125rem]">
            <ScanBarcode aria-hidden className="size-4 shrink-0 text-[var(--color-brand-text)]" />
            <span>
              Código lido: <strong className="tabular">{scannedCode}</strong>. O código só identifica o produto; nome, marca e
              preço vêm do seu cadastro.
            </span>
          </p>
        ) : null}

        <TextField
          label="Código de barras (EAN)"
          name="barcode"
          defaultValue={product?.barcode ?? scannedCode ?? ''}
          readOnly={fromScanner}
          hint={fromScanner ? undefined : 'Pode ser lido pelo leitor de código de barras.'}
          error={apiError?.fieldError('barcode')}
        />
        <BrandSelect value={brandId} onChange={setBrandId} error={apiError?.fieldError('brandId')} />
        <TextField
          label="Produto"
          name="name"
          required
          autoFocus={fromScanner}
          placeholder="Ex.: Golden Adultos 15kg"
          defaultValue={product?.name}
          error={apiError?.fieldError('name')}
        />
        <TextField
          label="Categoria"
          name="category"
          list={categoriesListId}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Ex.: Ração Premium, Petiscos, Higiene"
          hint="Escolha uma sugestão ou digite uma categoria nova."
          error={apiError?.fieldError('category')}
        />
        <datalist id={categoriesListId}>
          {categorySuggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Custo de compra (R$)"
            name="costPrice"
            inputMode="decimal"
            value={costText}
            onChange={(event) => setCostText(event.target.value)}
            placeholder="Quanto você pagou?"
            error={apiError?.fieldError('costPrice')}
          />
          <TextField
            ref={priceRef}
            label="Preço de venda (R$)"
            name="salePrice"
            inputMode="decimal"
            required
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            error={apiError?.fieldError('salePrice')}
          />
        </div>
        <PricingAssistant
          cost={cost !== undefined && Number.isFinite(cost) ? cost : null}
          price={price !== undefined && Number.isFinite(price) ? price : null}
          category={category}
          excludeProductId={product?.id}
          onUsePrice={(value) => setPriceText(toInput(value))}
          onAdjust={() => priceRef.current?.focus()}
        />

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
            {!isEditing ? (
              <TextField
                label={fromScanner ? 'Estoque recebido' : 'Estoque inicial'}
                name="initialStock"
                inputMode="decimal"
                defaultValue={fromScanner ? '1' : '0'}
                hint="Registrado como entrada no histórico."
                error={apiError?.fieldError('initialStock')}
              />
            ) : null}
            <TextField
              label="Estoque mínimo"
              name="minStock"
              inputMode="decimal"
              defaultValue={product ? String(product.minStock).replace('.', ',') : '0'}
              hint="Abaixo disso, alerta de estoque baixo."
              error={apiError?.fieldError('minStock')}
            />
          </div>
        ) : null}

        <SupplierSelect value={supplierId} onChange={setSupplierId} error={apiError?.fieldError('supplierId')} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="SKU (código interno)" name="sku" defaultValue={product?.sku ?? ''} error={apiError?.fieldError('sku')} />
          <SelectField
            label="Unidade"
            name="unit"
            defaultValue={product?.unit ?? 'UN'}
            options={(Object.keys(PRODUCT_UNIT_LABELS) as ProductUnit[]).map((unit) => ({ value: unit, label: PRODUCT_UNIT_LABELS[unit] }))}
          />
        </div>

        <TextAreaField
          label="Descrição"
          name="description"
          rows={2}
          placeholder="Opcional. Ex.: peso, sabor, indicação."
          defaultValue={product?.description ?? ''}
          error={apiError?.fieldError('description')}
        />

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
            {isEditing ? 'Salvar' : fromScanner ? 'Cadastrar e dar entrada' : 'Cadastrar produto'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
