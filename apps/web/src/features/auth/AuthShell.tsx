import { PawPrint } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Moldura das telas publicas (login, cadastro, recuperacao).
 *
 * Duas colunas no desktop, uma no mobile. A coluna da direita carrega a
 * promessa comercial do produto -- e o primeiro contato de um dono de pet shop
 * com o sistema, e ele precisa entender em cinco segundos para que serve.
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
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,32rem)]">
      {/* Painel de marca: escondido no mobile para nao empurrar o formulario
          para baixo da dobra. */}
      <aside className="relative hidden flex-col justify-between bg-[var(--color-brand)] p-10 text-[var(--color-text-inverse)] lg:flex">
        <div className="flex items-center gap-2.5">
          <PawPrint aria-hidden className="size-6" />
          <span className="text-lg font-semibold tracking-tight">PetFlow</span>
        </div>

        <div className="max-w-md">
          <p className="text-2xl leading-snug font-semibold tracking-tight">
            Organize os atendimentos do seu pet shop e faca seus clientes voltarem.
          </p>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-white/80">
            Agenda, ficha dos pets, historico de atendimentos e lembretes de retorno. Tudo em um
            lugar so, do jeito que o balcao precisa.
          </p>
        </div>

        <p className="text-[0.8125rem] text-white/60">
          Seus dados ficam isolados dos demais pet shops da plataforma.
        </p>
      </aside>

      <main className="flex items-center justify-center bg-[var(--color-surface)] px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <PawPrint aria-hidden className="size-5 text-[var(--color-brand)]" />
            <span className="font-semibold tracking-tight">PetFlow</span>
          </div>

          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
          ) : null}

          <div className="mt-7">{children}</div>

          {footer ? <div className="mt-6 text-sm">{footer}</div> : null}
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
      className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/25 bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-danger)]"
    >
      {message}
    </div>
  );
}
