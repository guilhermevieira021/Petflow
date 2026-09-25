import { AlertCircle } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const CONTROL_BASE = cn(
  'w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3.5',
  // text-base (16px) no mobile: abaixo disso o iOS Safari da zoom automatico
  // ao focar o campo, e o zoom fica preso -- sm: volta para o tamanho normal
  // no desktop, onde isso nao acontece. So a fonte muda, nada mais no visual.
  'text-base sm:text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]',
  'shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-150',
  'hover:border-[var(--color-text-subtle)]',
  'focus-visible:border-[var(--color-brand)] focus-visible:shadow-[0_0_0_3px_var(--color-brand-subtle)] focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-sunken)] disabled:text-[var(--color-text-subtle)]',
);

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

/**
 * Casca compartilhada por todos os controles de formulario.
 *
 * Garante o que a acessibilidade exige e que e facil esquecer: `label`
 * conectado por id, `aria-invalid` quando ha erro, e a mensagem de erro
 * anunciada por `aria-describedby` com role="alert".
 */
function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-[var(--color-text)]">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-[var(--color-danger)]">
            *
          </span>
        ) : null}
      </label>

      {children}

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-[0.8125rem] text-[var(--color-danger)]"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-[var(--color-text-subtle)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, required, ...props },
  ref,
) {
  const generatedId = useId();
  const id = props.name ? `field-${props.name}` : generatedId;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          CONTROL_BASE,
          'h-11 sm:h-10',
          error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
          className,
        )}
        {...props}
      />
    </FieldShell>
  );
});

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, hint, error, className, required, ...props }, ref) {
    const generatedId = useId();
    const id = props.name ? `field-${props.name}` : generatedId;

    return (
      <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
        <textarea
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(
            CONTROL_BASE,
            'min-h-20 resize-y py-2 leading-relaxed',
            error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
            className,
          )}
          {...props}
        />
      </FieldShell>
    );
  },
);

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, options, className, required, ...props },
  ref,
) {
  const generatedId = useId();
  const id = props.name ? `field-${props.name}` : generatedId;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          CONTROL_BASE,
          'h-11 sm:h-10 appearance-none bg-no-repeat pr-9',
          error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235c6472'%3E%3Cpath fill-rule='evenodd' d='M5.2 7.4a1 1 0 011.4 0L10 10.8l3.4-3.4a1 1 0 111.4 1.4l-4.1 4.1a1 1 0 01-1.4 0L5.2 8.8a1 1 0 010-1.4z' clip-rule='evenodd'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.625rem center',
          backgroundSize: '1.125rem',
        }}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});
