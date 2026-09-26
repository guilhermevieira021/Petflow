import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';

/**
 * Confirmacao de acao destrutiva que exige um MOTIVO (cancelar venda, recusar
 * solicitacao). Mesmo <dialog> nativo do ConfirmDialog: foco preso e Esc de
 * graca.
 */
export function ReasonDialog({
  open,
  title,
  description,
  label = 'Motivo',
  placeholder,
  confirmLabel = 'Confirmar',
  required = true,
  destructive = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  required?: boolean;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason('');
      setTouched(false);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      if (!loading) onCancel();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [loading, onCancel]);

  const invalid = required && reason.trim().length < 3;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!invalid) onConfirm(reason.trim());
        }}
      >
        <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold">
          {title}
        </h2>
        <p id={`${id}-description`} className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>

        <label htmlFor={`${id}-reason`} className="mt-4 block text-[0.8125rem] font-medium">
          {label}
          {required ? <span aria-hidden className="ml-0.5 text-[var(--color-danger)]">*</span> : null}
        </label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
          maxLength={500}
          aria-invalid={touched && invalid ? true : undefined}
          className="mt-1.5 min-h-20 w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-base focus-visible:border-[var(--color-brand)] focus-visible:shadow-[0_0_0_3px_var(--color-brand-subtle)] focus-visible:outline-none sm:text-sm"
        />
        {touched && invalid ? (
          <p role="alert" className="mt-1 text-[0.8125rem] text-[var(--color-danger)]">
            Escreva ao menos 3 caracteres.
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Voltar
          </Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
