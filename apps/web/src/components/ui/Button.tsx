import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'ink' | 'on-ink';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-brand)] text-[var(--color-text-inverse)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-text-subtle)]',
  ghost: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-text-inverse)] shadow-[var(--shadow-xs)] hover:opacity-90',
  link: 'text-[var(--color-brand-text)] underline-offset-4 hover:underline',
  /** Botao escuro -- CTA neutro em superficies claras (landing, paywall). */
  ink: 'bg-[var(--color-ink)] text-[var(--color-ink-text)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-ink-hover)]',
  /** Botao secundario para usar SOBRE superficies ink. */
  'on-ink':
    'border border-[var(--color-ink-border)] bg-white/5 text-[var(--color-ink-text)] hover:bg-white/10',
};

// Alturas pensadas para toque: md (40px) e lg (48px) atendem o alvo minimo
// de 44px no mobile sem ficarem desproporcionais no desktop.
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]',
  lg: 'h-12 px-5 text-[0.9375rem] gap-2 rounded-[var(--radius-md)]',
  xl: 'h-14 px-7 text-base gap-2.5 rounded-[var(--radius-lg)]',
  icon: 'h-10 w-10 p-0 rounded-[var(--radius-md)]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Icone a esquerda do rotulo. Decorativo: fica escondido de leitores. */
  icon?: ReactNode;
}

/** Mesmas classes do Button, para links (<Link>/<a>) que precisam parecer botao. */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string): string {
  return cn(
    'inline-flex items-center justify-center font-medium',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 select-none whitespace-nowrap',
    'disabled:pointer-events-none disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
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
      className={buttonClasses(variant, size, className)}
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
