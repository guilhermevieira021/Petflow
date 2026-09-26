import type { ProductDto } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { parseDecimal } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

type ManualType = 'IN' | 'OUT' | 'ADJUSTMENT';

const COPY: Record<ManualType, { quantityLabel: string; help: string }> = {
  IN: { quantityLabel: 'Quantidade que entrou', help: 'Compra, reposição ou devolução de fornecedor.' },
  OUT: { quantityLabel: 'Quantidade que saiu', help: 'Avaria, vencimento, uso interno. Vendas baixam o estoque sozinhas.' },
  ADJUSTMENT: { quantityLabel: 'Saldo contado', help: 'Informe o saldo real contado na prateleira. O sistema registra a diferença.' },
};

/** Entrada / saida / ajuste manual. Tudo vira linha no historico (append-only). */
export function StockMovementDialog({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: ProductDto;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ManualType>('IN');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setType('IN');
      setQuantity('');
      setUnitCost('');
      setReason('');
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<ProductDto>(`/products/${product.id}/movements`, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`Estoque atualizado. Saldo: ${formatQuantity(updated.stockQuantity)}.`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível registrar.'),
  });

  function submit(): void {
    setError(null);
    const value = parseDecimal(quantity);
    if (Number.isNaN(value) || value < 0 || (type !== 'ADJUSTMENT' && value === 0)) {
      setError('Informe uma quantidade válida.');
      return;
    }
    const cost = unitCost.trim() ? parseDecimal(unitCost) : null;
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      setError('Custo inválido.');
      return;
    }
    mutation.mutate({ type, quantity: value, unitCost: type === 'IN' ? cost : null, reason: reason.trim() || null });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div>
          <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold">
            Movimentar estoque
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {product.name} · saldo atual <span className="tabular font-semibold text-[var(--color-text)]">{formatQuantity(product.stockQuantity)}</span>
          </p>
        </div>

        <SegmentedControl
          label="Tipo de movimentação"
          value={type}
          onChange={setType}
          className="w-full"
          options={[
            { value: 'IN', label: 'Entrada' },
            { value: 'OUT', label: 'Saída' },
            { value: 'ADJUSTMENT', label: 'Ajuste' },
          ]}
        />
        <p className="-mt-2 text-[0.8125rem] text-[var(--color-text-muted)]">{COPY[type].help}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="text-[0.8125rem] font-medium">{COPY[type].quantityLabel}</span>
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              autoFocus
              className="tabular mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3.5 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:h-10 sm:text-sm"
            />
          </label>
          {type === 'IN' ? (
            <label>
              <span className="text-[0.8125rem] font-medium">Custo unitário (R$)</span>
              <input
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                inputMode="decimal"
                placeholder="Opcional"
                className="tabular mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3.5 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:h-10 sm:text-sm"
              />
            </label>
          ) : null}
        </div>

        <label>
          <span className="text-[0.8125rem] font-medium">Motivo / observação</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder={type === 'IN' ? 'Ex.: NF 1234, fornecedor X' : 'Ex.: embalagem avariada'}
            className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3.5 text-base focus-visible:border-[var(--color-brand)] focus-visible:outline-none sm:h-10 sm:text-sm"
          />
        </label>

        {error ? (
          <p role="alert" className="text-[0.8125rem] font-medium text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Registrar
          </Button>
        </div>
      </form>
    </dialog>
  );
}
