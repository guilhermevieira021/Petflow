import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Painel lateral para formularios (criar/editar cliente, pet, agendamento...).
 *
 * Construido sobre <dialog> nativo pelo mesmo motivo do ConfirmDialog: foco
 * preso, fechamento por Esc e semantica de modal ja vem do navegador. No
 * mobile ocupa a tela quase inteira; no desktop e um painel a direita.
 */
export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  widthClassName = 'sm:max-w-lg',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
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

  return (
    <dialog
      ref={ref}
      aria-labelledby="drawer-title"
      className={cn(
        'm-0 ml-auto h-dvh max-h-dvh w-full overflow-y-auto',
        'border-l border-[var(--color-border)] bg-[var(--color-surface)] p-0',
        'text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-black/40',
        widthClassName,
      )}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div className="min-w-0">
          <h2 id="drawer-title" className="text-[0.9375rem] font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="-m-1 shrink-0 rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="p-5">{children}</div>
    </dialog>
  );
}
