import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-brand)] text-[var(--color-text-inverse)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-surface-hover)]',
  ghost: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-text-inverse)] shadow-[var(--shadow-xs)] hover:opacity-90',
  link: 'text-[var(--color-brand-text)] underline-offset-4 hover:underline',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[0.9375rem] gap-2',
  icon: 'h-9 w-9 p-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Icone a esquerda do rotulo. Decorativo: fica escondido de leitores. */
  icon?: ReactNode;
}

/**
 * Botao base do produto.
 *
 * Detalhes que importam: enquanto `loading`, o botao fica desabilitado (evita
 * envio duplicado), anuncia `aria-busy` e MANTEM a largura do rotulo, para o
 * layout nao pular no meio de um clique.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-md)] font-medium',
        'transition-colors duration-150 select-none whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : icon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
