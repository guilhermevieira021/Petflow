import { CalendarCheck2, TrendingDown, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';

const BENEFITS = [
  { icon: CalendarCheck2, text: 'Agenda do dia organizada, sem conflito de horário.' },
  { icon: Users, text: 'Clientes e pets com histórico completo, a um toque.' },
  { icon: TrendingDown, text: 'Veja o que entrou e o que foi perdido na operação.' },
];

/**
 * Moldura das telas publicas (login, cadastro, recuperacao).
 *
 * Desktop: painel escuro com a promessa do produto + formulario. Mobile: so o
 * formulario, sem nada empurrando os campos para baixo da dobra.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-[var(--color-surface)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-[var(--color-ink)] p-12 text-[var(--color-ink-text)] lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-32 size-[34rem] rounded-full bg-[var(--color-brand)] opacity-20 blur-3xl"
        />
        <Link to="/" className="relative w-fit">
          <Logo tone="light" />
        </Link>

        <div className="relative max-w-md">
          <p className="text-[2rem] leading-[1.15] font-semibold tracking-tight text-balance">
            Mais tempo para atender. Menos dinheiro perdido na operação.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit.text} className="flex items-start gap-3 text-[0.9375rem] text-[var(--color-ink-muted)]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-white/[0.07] text-[var(--color-brand-on-ink)]">
                  <benefit.icon aria-hidden className="size-4" />
                </span>
                <span className="pt-1">{benefit.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[0.8125rem] text-[var(--color-ink-muted)]">
          Seus dados ficam isolados dos demais pet shops da plataforma.
        </p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Link to="/" className="inline-flex">
            <Logo />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[25rem]">
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-2 text-[0.9375rem] text-[var(--color-text-muted)]">{subtitle}</p> : null}

            <div className="mt-8">{children}</div>

            {footer ? <div className="mt-8 border-t border-[var(--color-border)] pt-6 text-sm">{footer}</div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Alerta de erro do formulario inteiro (credencial invalida, conflito...). */
export function FormAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-1 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-subtle)] px-4 py-3 text-[0.8125rem] font-medium text-[var(--color-danger)]"
    >
      {message}
    </div>
  );
}
