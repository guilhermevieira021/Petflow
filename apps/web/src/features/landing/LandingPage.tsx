import {
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  MessageCircle,
  PawPrint,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

/**
 * Landing publica. Objetivo unico: converter visitante em trial.
 *
 * Nenhum numero de cliente, depoimento ou logo de empresa aparece aqui -- o
 * produto e novo e nao temos prova social real ainda. Inventar isso seria
 * mentir para quem esta decidindo confiar o negocio a um sistema novo.
 */

function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 lg:py-20 ${className ?? ''}`}>
      {children}
    </section>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.8125rem] font-semibold tracking-wide text-[var(--color-brand-text)] uppercase">
      {children}
    </p>
  );
}

const PROBLEMS = [
  {
    icon: CalendarDays,
    title: 'Agenda desorganizada',
    description: 'Caderno, WhatsApp e memoria disputando o mesmo horario -- e sempre alguem esquecido.',
  },
  {
    icon: UserRoundCheck,
    title: 'Clientes que somem',
    description: 'Sem um jeito de ver quem parou de vir, o retorno depende de sorte.',
  },
  {
    icon: PawPrint,
    title: 'Historico dos pets perdido',
    description: 'Cada atendimento fica na cabeca de quem atendeu, nao no sistema.',
  },
  {
    icon: ClipboardList,
    title: 'Sem visao da operacao',
    description: 'Quanto entrou, quantos atendimentos, quem faltou -- dificil saber sem contar na mao.',
  },
];

const HOW_IT_WORKS = [
  { step: '1', title: 'Cadastre seu pet shop', description: 'Nome, servicos e horario de funcionamento. Leva menos de 2 minutos.' },
  { step: '2', title: 'Organize clientes e pets', description: 'Cada cliente com seus pets, telefone e historico num lugar so.' },
  { step: '3', title: 'Controle sua agenda', description: 'Veja o dia, confirme, atenda e conclua sem se perder.' },
  { step: '4', title: 'Recupere clientes', description: 'O sistema aponta quem sumiu, para voce chamar de volta.' },
];

const FEATURES = [
  { icon: CalendarCheck, title: 'Agenda sem conflito', description: 'O sistema nao deixa marcar dois atendimentos no mesmo horario.' },
  { icon: Users, title: 'Clientes e pets', description: 'Ficha completa, historico de atendimentos e total gasto.' },
  { icon: UserRoundCheck, title: 'Recuperacao de clientes', description: 'Lista de quem nao volta ha 30, 45, 60 ou 90 dias.' },
  { icon: MessageCircle, title: 'WhatsApp com um clique', description: 'Mensagem pronta, voce so confirma o envio.' },
  { icon: ClipboardList, title: 'Relatorios', description: 'Faturamento, atendimentos e servicos mais usados.' },
  { icon: ShieldCheck, title: 'Seus dados isolados', description: 'Cada pet shop enxerga so os seus proprios dados.' },
];

const FAQ = [
  {
    question: 'Preciso colocar cartao de credito para testar?',
    answer: 'Nao. O teste gratuito de 48 horas comeca assim que voce cria a conta, sem pedir pagamento.',
  },
  {
    question: 'O que acontece quando o teste termina?',
    answer:
      'Seus dados continuam salvos. Para continuar usando o sistema, e preciso assinar o plano PRO.',
  },
  {
    question: 'Da para usar no celular?',
    answer: 'Sim. O sistema funciona no navegador do celular, tablet ou computador, sem instalar nada.',
  },
  {
    question: 'Quantas pessoas da equipe podem usar?',
    answer: 'O teste gratuito permite 2 usuarios. O plano PRO aumenta esse limite -- veja em Planos.',
  },
];

export function LandingPage() {
  return (
    <div className="bg-[var(--color-surface)] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <PawPrint aria-hidden className="size-5 text-[var(--color-brand)]" />
            <span className="font-semibold tracking-tight">PetFlow</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-[var(--color-text-muted)] sm:flex">
            <a href="#como-funciona" className="hover:text-[var(--color-text)]">Como funciona</a>
            <a href="#funcionalidades" className="hover:text-[var(--color-text)]">Funcionalidades</a>
            <Link to="/planos" className="hover:text-[var(--color-text)]">Planos</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/entrar"
              className="hidden text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:block"
            >
              Entrar
            </Link>
            <Link to="/criar-conta">
              <Button size="sm">Comecar gratis</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <Section className="text-center">
        <SectionEyebrow>Gestao para pet shops</SectionEyebrow>
        <h1 className="mx-auto mt-3 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl lg:text-5xl">
          Organize os atendimentos do seu pet shop e faca seus clientes voltarem.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--color-text-muted)] sm:text-lg">
          Agenda sem conflito, ficha completa de clientes e pets, e um jeito simples de lembrar quem
          precisa voltar. Tudo num sistema pensado para o dia a dia do balcao.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/criar-conta">
            <Button size="lg">Comecar gratuitamente</Button>
          </Link>
          <Link to="/planos">
            <Button size="lg" variant="secondary">Ver planos</Button>
          </Link>
        </div>
        <p className="mt-4 text-[0.8125rem] text-[var(--color-text-subtle)]">
          48 horas para experimentar. Sem cartao de credito.
        </p>
      </Section>

      {/* PROBLEMAS */}
      <Section className="border-t border-[var(--color-border)]">
        <SectionEyebrow>O problema</SectionEyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          O dia a dia de um pet shop tem atrito demais
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {PROBLEMS.map((item) => (
            <div key={item.title} className="flex gap-3.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
              <item.icon aria-hidden className="size-5 shrink-0 text-[var(--color-danger)]" />
              <div>
                <h3 className="text-[0.9375rem] font-semibold">{item.title}</h3>
                <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--color-text-muted)]">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* COMO FUNCIONA */}
      <Section id="como-funciona" className="border-t border-[var(--color-border)]">
        <SectionEyebrow>Como funciona</SectionEyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Do cadastro ao primeiro atendimento em minutos
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step}>
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--color-brand)] text-sm font-semibold text-white">
                {item.step}
              </span>
              <h3 className="mt-3 text-[0.9375rem] font-semibold">{item.title}</h3>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--color-text-muted)]">
                {item.description}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* FUNCIONALIDADES */}
      <Section id="funcionalidades" className="border-t border-[var(--color-border)]">
        <SectionEyebrow>Funcionalidades</SectionEyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Tudo o que o balcao precisa, nada que atrapalha
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((item) => (
            <div key={item.title} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
              <item.icon aria-hidden className="size-5 text-[var(--color-brand)]" />
              <h3 className="mt-3 text-[0.9375rem] font-semibold">{item.title}</h3>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--color-text-muted)]">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-[var(--color-border)]">
        <SectionEyebrow>Perguntas frequentes</SectionEyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Duvidas comuns</h2>
        <div className="mt-8 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="cursor-pointer list-none text-[0.9375rem] font-medium marker:content-none">
                {item.question}
              </summary>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--color-text-muted)]">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA FINAL */}
      <Section className="border-t border-[var(--color-border)] text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Pronto para organizar o seu pet shop?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[0.9375rem] text-[var(--color-text-muted)]">
          Comece agora. O teste e gratuito por 48 horas, sem cartao de credito.
        </p>
        <div className="mt-6">
          <Link to="/criar-conta">
            <Button size="lg">Criar minha conta</Button>
          </Link>
        </div>
      </Section>

      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 text-[0.8125rem] text-[var(--color-text-subtle)] sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <PawPrint aria-hidden className="size-4" />
            <span>PetFlow</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {/* Sem conteudo juridico definido ainda -- marcado explicitamente
                como placeholder, para nao passar por texto legal de verdade. */}
            <span className="cursor-default" title="Texto a definir">
              Termos (em breve)
            </span>
            <span className="cursor-default" title="Texto a definir">
              Privacidade (em breve)
            </span>
            <Link to="/entrar" className="hover:text-[var(--color-text)]">
              Entrar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
