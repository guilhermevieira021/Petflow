import type { PlanDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  CalendarX2,
  Check,
  ClipboardList,
  Clock,
  Dog,
  FileSpreadsheet,
  Menu,
  MessageCircle,
  NotebookPen,
  Smartphone,
  TrendingDown,
  UserRoundCheck,
  UserRoundX,
  Users,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { buttonClasses } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTrialPeriod } from '@/lib/format';
import { LostPanel, TodayFinancePanel, WeekSummary } from '@/features/dashboard/DashboardPanels';
import { DEMO_DASHBOARD } from './demoData';
import {
  AgendaShowcase,
  CustomerShowcase,
  HeroProduct,
  LossCalculator,
  ProductFrame,
  ProductShowcase,
  useRevealOnScroll,
} from './LandingParts';

/**
 * Landing publica. Objetivo unico: levar o visitante ao TESTE GRATIS.
 *
 * Regras de honestidade que esta pagina segue:
 *   - Nenhum numero de cliente, depoimento ou logo de empresa -- o produto nao
 *     tem prova social real ainda, e inventar seria mentir.
 *   - Telas mostradas sao os componentes REAIS do app com dados de
 *     demonstracao, sempre com o selo "Demonstracao com dados ficticios".
 *   - Duracao do teste e limites vem da API (/plans), nunca escritos aqui.
 *   - So aparecem recursos que ja existem no produto.
 */

const SIGNUP = '/criar-conta';

const NAV_LINKS = [
  { href: '#produto', label: 'Produto' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#teste-gratis', label: 'Teste grátis' },
];

function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => api.get<{ data: PlanDto[] }>('/plans'),
    staleTime: 5 * 60_000,
  });
}

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', className)}>{children}</div>;
}

function Eyebrow({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'muted' | 'on-ink' }) {
  return (
    <p
      className={cn(
        'eyebrow',
        tone === 'brand' && 'text-[var(--color-brand-text)]',
        tone === 'muted' && 'text-[var(--color-text-subtle)]',
        tone === 'on-ink' && 'text-[var(--color-brand-on-ink)]',
      )}
    >
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  tone = 'light',
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  tone?: 'light' | 'ink';
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')} data-reveal>
      <Eyebrow tone={tone === 'ink' ? 'on-ink' : 'brand'}>{eyebrow}</Eyebrow>
      <h2
        className={cn(
          'mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl',
          tone === 'ink' && 'text-[var(--color-ink-text)]',
        )}
      >
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            'mt-4 text-[1.0625rem] leading-relaxed text-pretty sm:text-lg',
            tone === 'ink' ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-text-muted)]',
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function PrimaryCta({ children = 'Começar teste grátis', size = 'lg', className }: { children?: ReactNode; size?: 'lg' | 'xl'; className?: string }) {
  return (
    <Link to={SIGNUP} className={buttonClasses('primary', size, cn('group', className))}>
      {children}
      <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   Header
--------------------------------------------------------------------------- */

function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-200',
        scrolled || open
          ? 'border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link to="/" aria-label="Petflow, página inicial">
          <Logo />
        </Link>

        <nav aria-label="Seções da página" className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/entrar" className="hidden px-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:block">
            Entrar
          </Link>
          <Link to={SIGNUP} className={buttonClasses('primary', 'md', 'max-[360px]:px-3 max-[360px]:text-[0.8125rem]')}>
            Começar teste grátis
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="menu-landing"
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            className="flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)] md:hidden"
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </Container>

      {open ? (
        <nav id="menu-landing" aria-label="Menu" className="animate-fade-in border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden">
          <Container className="flex flex-col py-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-md)] px-2 py-3 text-base font-medium hover:bg-[var(--color-surface-sunken)]"
              >
                {link.label}
              </a>
            ))}
            <Link to="/entrar" className="rounded-[var(--radius-md)] px-2 py-3 text-base font-medium text-[var(--color-text-muted)]">
              Entrar
            </Link>
          </Container>
        </nav>
      ) : null}
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Conteudo das secoes
--------------------------------------------------------------------------- */

const PROBLEMS = [
  { icon: CalendarX2, title: 'Horários vazios', text: 'Faltas e cancelamentos que ninguém percebe a tempo de reaproveitar o horário.' },
  { icon: UserRoundX, title: 'Clientes que não voltam', text: 'Sem saber quem sumiu, o retorno depende de sorte, não de gestão.' },
  { icon: NotebookPen, title: 'Informações espalhadas', text: 'WhatsApp, caderno e memória disputando a mesma agenda e o mesmo histórico.' },
  { icon: Wallet, title: 'Falta de controle financeiro', text: 'Quanto entrou, quanto estava previsto e quanto se perdeu — só contando na mão.' },
  { icon: Clock, title: 'Excesso de tarefas manuais', text: 'Horas por semana procurando telefone, confirmando horário e refazendo anotações.' },
];

const BEFORE = [
  { icon: MessageCircle, label: 'WhatsApp', className: 'rotate-[-4deg]' },
  { icon: BookOpen, label: 'Agenda de papel', className: 'rotate-[3deg] sm:translate-x-6' },
  { icon: NotebookPen, label: 'Anotações soltas', className: 'rotate-[-2deg] sm:-translate-x-3' },
  { icon: FileSpreadsheet, label: 'Planilha', className: 'rotate-[5deg] sm:translate-x-10' },
  { icon: ClipboardList, label: 'Memória de quem atendeu', className: 'rotate-[-3deg]' },
];

const FLOW = [
  { icon: Users, title: 'Cliente', text: 'Cadastro com WhatsApp e histórico.' },
  { icon: Dog, title: 'Pet', text: 'Ficha com raça, peso e observações.' },
  { icon: CalendarCheck2, title: 'Agendamento', text: 'Horário sem conflito, status do dia.' },
  { icon: ClipboardList, title: 'Histórico', text: 'Cada serviço registrado no pet e no cliente.' },
  { icon: BarChart3, title: 'Controle', text: 'Recebido, previsto e perdido no painel.' },
];

const FEATURES = [
  { icon: CalendarDays, title: 'Agenda por dia, semana e mês', text: 'Status de cada atendimento e bloqueio de horário duplicado.' },
  { icon: Users, title: 'Clientes', text: 'Ficha com WhatsApp, pets, histórico e total gasto.' },
  { icon: Dog, title: 'Pets', text: 'Raça, idade, peso, tutor, observações e serviços realizados.' },
  { icon: BarChart3, title: 'Painel financeiro', text: 'Recebido, previsto e perdido — hoje e na semana.' },
  { icon: TrendingDown, title: 'Dinheiro perdido', text: 'Cancelamentos e faltas transformados em valor, para você agir.' },
  { icon: UserRoundCheck, title: 'Recuperação de clientes', text: 'Quem não volta há 30, 45, 60 ou 90 dias.' },
  { icon: MessageCircle, title: 'WhatsApp com um toque', text: 'Conversa aberta com a mensagem pronta; você só envia.' },
  { icon: ClipboardList, title: 'Relatórios', text: 'Faturamento, atendimentos e serviços mais usados.' },
  { icon: UsersRound, title: 'Equipe com permissões', text: 'Cada pessoa vê e faz só o que precisa.' },
  { icon: Smartphone, title: 'Funciona no celular', text: 'No navegador do celular, tablet ou computador. Sem instalar nada.' },
];

const BENEFITS = [
  { title: 'Menos tempo no operacional', text: 'Agenda, ficha e histórico no mesmo lugar: menos procurar, mais atender.' },
  { title: 'Perdas à vista', text: 'Faltas e cancelamentos aparecem em reais, no dia em que acontecem.' },
  { title: 'Clientes voltando', text: 'Você sabe quem precisa de retorno antes que ele vá para o concorrente.' },
  { title: 'Decisões com números', text: 'O resultado da semana está no painel — sem planilha no fim do mês.' },
];

/* ---------------------------------------------------------------------------
   Pagina
--------------------------------------------------------------------------- */

export function LandingPage() {
  useRevealOnScroll();
  const plans = usePlans();
  const trialPlan = plans.data?.data.find((plan) => plan.code === 'TRIAL');
  const trialPeriod = formatTrialPeriod(trialPlan?.trialHours);
  const trialUsers = trialPlan?.limits.users ?? null;

  const faq = [
    {
      question: 'Eu nunca usei um sistema assim. Vou conseguir?',
      answer: 'Sim. O Petflow foi desenhado para o balcão: poucas telas, botões grandes e o que importa sempre visível. Se você usa WhatsApp, consegue usar o Petflow.',
    },
    {
      question: 'Vai dar trabalho cadastrar tudo?',
      answer: 'Não precisa cadastrar tudo de uma vez. Comece pelos serviços e pelos clientes do dia; a base cresce naturalmente conforme você atende.',
    },
    {
      question: 'Preciso entender de tecnologia?',
      answer: 'Não. Funciona no navegador do celular ou do computador, sem instalar nada e sem configuração técnica.',
    },
    {
      question: 'Posso testar antes de pagar?',
      answer: trialPeriod
        ? `Sim. O teste grátis dura ${trialPeriod} e não pede cartão de crédito. Você só decide depois de ver funcionando.`
        : 'Sim. O teste é gratuito e não pede cartão de crédito. Você só decide depois de ver funcionando.',
    },
    {
      question: 'O que acontece quando o teste termina?',
      answer: 'Seus dados continuam salvos. Para continuar usando, basta escolher o plano dentro do sistema.',
    },
    {
      question: 'Minha equipe pode usar?',
      answer:
        trialUsers !== null
          ? `Sim. O teste permite ${trialUsers} ${trialUsers === 1 ? 'usuário' : 'usuários'}, cada um com permissões próprias; o plano pago amplia esse limite.`
          : 'Sim. Cada pessoa da equipe tem o próprio acesso, com permissões de acordo com a função.',
    },
  ];

  const trialNote = ['Sem cartão de crédito', trialPeriod ? `${trialPeriod} grátis` : null, 'Comece em poucos minutos'].filter(Boolean);

  return (
    <div className="min-h-dvh bg-[var(--color-surface)] text-[var(--color-text)]">
      <a
        href="#conteudo-landing"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-md)]"
      >
        Pular para o conteúdo
      </a>

      <div className="relative overflow-hidden bg-[var(--color-canvas)]">
        {/* Grade sutil de fundo, desbotando para as bordas */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
        />
        <LandingHeader />

        {/* 1. HERO */}
        <main id="conteudo-landing">
          <section className="relative pt-12 pb-16 sm:pt-20 sm:pb-24" aria-labelledby="hero-title">
            <Container>
              <div className="mx-auto max-w-4xl text-center">
                <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] shadow-[var(--shadow-xs)]">
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-success)]" />
                  Mais tempo para atender. Menos dinheiro perdido.
                </p>
                <h1
                  id="hero-title"
                  className="mt-6 text-[2.375rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl"
                >
                  Pare de perder tempo e dinheiro tentando organizar seu pet shop.
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-pretty text-[var(--color-text-muted)] sm:text-xl">
                  O Petflow reúne agenda, clientes, pets e resultados em um só lugar — para você gastar menos tempo no
                  operacional e ter mais controle sobre o dinheiro que entra e o que está sendo perdido.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <PrimaryCta size="xl" className="w-full sm:w-auto" />
                  <a href="#produto" className={buttonClasses('secondary', 'xl', 'w-full sm:w-auto')}>
                    Ver o Petflow por dentro
                  </a>
                </div>
                <p className="mt-5 text-[0.875rem] text-[var(--color-text-subtle)]">{trialNote.join(' • ')}</p>
              </div>

              <div className="relative mx-auto mt-14 max-w-5xl sm:mt-20" data-reveal>
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-x-10 -top-10 bottom-10 rounded-full bg-[var(--color-brand)] opacity-[0.12] blur-3xl"
                />
                <HeroProduct />
              </div>
            </Container>
          </section>
        </main>
      </div>

      {/* 2. PROBLEMA */}
      <section className="border-t border-[var(--color-border)] py-20 sm:py-28" aria-labelledby="problema-title">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start" data-reveal>
            <Eyebrow>O problema</Eyebrow>
            <h2 id="problema-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              Seu pet shop pode estar perdendo dinheiro sem você perceber.
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-[var(--color-text-muted)]">
              Não é um grande prejuízo de uma vez. São pequenas perdas, todos os dias, escondidas na rotina — e
              somadas no fim do mês.
            </p>
          </div>
          <ol className="relative flex flex-col" data-reveal>
            {PROBLEMS.map((problem, index) => (
              <li key={problem.title} className="group relative flex gap-5 border-t border-[var(--color-border)] py-6 first:border-t-0 first:pt-0">
                <span className="tabular w-8 shrink-0 pt-1 text-sm font-semibold text-[var(--color-text-subtle)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-danger-subtle)] text-[var(--color-danger)]">
                  <problem.icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{problem.title}</h3>
                  <p className="mt-1 leading-relaxed text-[var(--color-text-muted)]">{problem.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* 3. COMO ECONOMIZA TEMPO E DINHEIRO */}
      <section id="como-funciona" className="scroll-mt-16 bg-[var(--color-canvas)] py-20 sm:py-28" aria-labelledby="tempo-title">
        <Container>
          <div data-reveal>
            <Eyebrow>Economia de tempo</Eyebrow>
            <h2 id="tempo-title" className="mt-3 max-w-3xl text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              Menos tarefas manuais. Mais tempo para cuidar do negócio.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-2" data-reveal>
            <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-9">
              <p className="eyebrow text-[var(--color-text-subtle)]">Antes</p>
              <p className="mt-2 text-xl font-semibold tracking-tight">Cinco lugares para lembrar de tudo</p>
              <ul className="mt-8 flex flex-col items-start gap-3">
                {BEFORE.map((item) => (
                  <li
                    key={item.label}
                    className={cn(
                      'inline-flex items-center gap-2.5 rounded-full border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-sunken)] px-4 py-2.5 text-[0.9375rem] text-[var(--color-text-muted)]',
                      item.className,
                    )}
                  >
                    <item.icon aria-hidden className="size-4" />
                    {item.label}
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-[0.9375rem] text-[var(--color-text-muted)]">
                Informação duplicada, horário esquecido e nenhuma visão do dinheiro.
              </p>
            </div>

            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-ink)] p-6 text-[var(--color-ink-text)] sm:p-9">
              <p className="eyebrow text-[var(--color-brand-on-ink)]">Com o Petflow</p>
              <p className="mt-2 text-xl font-semibold tracking-tight">Um fluxo só, do cliente ao resultado</p>
              <ol className="mt-8 flex flex-col">
                {FLOW.map((step, index) => (
                  <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
                    {index < FLOW.length - 1 ? (
                      <span aria-hidden className="absolute top-10 bottom-0 left-5 w-px bg-[var(--color-ink-border)]" />
                    ) : null}
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[var(--color-brand-on-ink)]">
                      <step.icon className="size-[1.1rem]" />
                    </span>
                    <div className="pt-1.5">
                      <p className="font-semibold">{step.title}</p>
                      <p className="text-[0.9375rem] text-[var(--color-ink-muted)]">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Economia de dinheiro */}
          <div className="mt-24 sm:mt-32" data-reveal>
            <SectionHeading
              eyebrow="Economia de dinheiro"
              title="Quanto dinheiro seu pet shop está deixando escapar?"
              description="Pequenas perdas operacionais podem virar milhares de reais ao longo do ano. Ajuste com os seus números:"
            />
          </div>
          <div className="mt-10" data-reveal>
            <LossCalculator />
          </div>
        </Container>
      </section>

      {/* 4. DEMONSTRACAO VISUAL */}
      <section id="produto" className="scroll-mt-16 py-20 sm:py-28" aria-labelledby="produto-title">
        <Container>
          <div className="mx-auto max-w-3xl text-center" data-reveal>
            <Eyebrow>O Petflow por dentro</Eyebrow>
            <h2 id="produto-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              De uma operação difícil de acompanhar para um pet shop sob controle.
            </h2>
            <p className="mt-4 text-[1.0625rem] text-[var(--color-text-muted)] sm:text-lg">
              Estas são as telas reais do sistema. Troque entre elas:
            </p>
          </div>
          <div className="mt-10" data-reveal>
            <ProductShowcase />
          </div>
        </Container>
      </section>

      {/* 5. DASHBOARD */}
      <section className="bg-[var(--color-ink)] py-20 text-[var(--color-ink-text)] sm:py-28" aria-labelledby="dashboard-title">
        <Container className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div data-reveal>
            <Eyebrow tone="on-ink">Controle</Eyebrow>
            <h2 id="dashboard-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-[var(--color-ink-text)] sm:text-5xl">
              Você não precisa adivinhar como está seu pet shop. O Petflow mostra.
            </h2>
            <ul className="mt-8 flex flex-col gap-3">
              {['Recebido hoje', 'Previsto hoje', 'Perdido hoje', 'Previsto na semana', 'Perdido na semana'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-[1.0625rem]">
                  <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-white/[0.08] text-[var(--color-brand-on-ink)]">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
              Os números saem da própria agenda e dos pagamentos registrados — sem planilha paralela.
            </p>
          </div>
          <div data-reveal>
            <ProductFrame label="Início" className="border-[var(--color-ink-border)]">
              <div className="grid gap-3 sm:gap-4">
                <TodayFinancePanel today={DEMO_DASHBOARD.today} referenceDate={DEMO_DASHBOARD.referenceDate} />
                <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                  <LostPanel today={DEMO_DASHBOARD.today} week={DEMO_DASHBOARD.week} />
                  <div className="hidden sm:block">
                    <WeekSummary week={DEMO_DASHBOARD.week} />
                  </div>
                </div>
              </div>
            </ProductFrame>
          </div>
        </Container>
      </section>

      {/* 6. AGENDA */}
      <section className="py-20 sm:py-28" aria-labelledby="agenda-title">
        <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="lg:order-2" data-reveal>
            <Eyebrow>Agenda</Eyebrow>
            <h2 id="agenda-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              O dia inteiro em uma tela, do primeiro banho ao último horário.
            </h2>
            <ul className="mt-8 flex flex-col gap-4 text-[1.0625rem] text-[var(--color-text-muted)]">
              {[
                'Horário, cliente, pet, serviço e status sempre visíveis.',
                'Confirmar, iniciar e concluir com um toque.',
                'Visão por dia, semana e mês — e o sistema não deixa marcar dois atendimentos no mesmo horário.',
                'WhatsApp do cliente com a mensagem de confirmação pronta.',
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <Check aria-hidden className="mt-1 size-5 shrink-0 text-[var(--color-success)]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:order-1" data-reveal>
            <AgendaShowcase />
          </div>
        </Container>
      </section>

      {/* 7. CLIENTES E PETS */}
      <section className="bg-[var(--color-canvas)] py-20 sm:py-28" aria-labelledby="clientes-title">
        <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div data-reveal>
            <Eyebrow>Clientes e pets</Eyebrow>
            <h2 id="clientes-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              Cada cliente e cada pet com a história completa.
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-[var(--color-text-muted)] sm:text-lg">
              WhatsApp, pets, histórico de serviços, total gasto e última visita. Quem atende sabe com quem está
              falando — mesmo que seja o primeiro dia na equipe.
            </p>
          </div>
          <div data-reveal>
            <CustomerShowcase />
          </div>
        </Container>
      </section>

      {/* 8. RECURSOS */}
      <section id="recursos" className="scroll-mt-16 py-20 sm:py-28" aria-labelledby="recursos-title">
        <Container>
          <div data-reveal>
            <Eyebrow>Recursos</Eyebrow>
            <h2 id="recursos-title" className="mt-3 max-w-3xl text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              Tudo o que o balcão precisa. Nada que atrapalhe.
            </h2>
          </div>
          <ul className="mt-12 grid gap-x-12 sm:grid-cols-2" data-reveal>
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex gap-4 border-t border-[var(--color-border)] py-6">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] text-[var(--color-brand-text)]">
                  <feature.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-0.5 leading-relaxed text-[var(--color-text-muted)]">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 9. BENEFICIOS OPERACIONAIS */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-canvas)] py-16 sm:py-20" aria-label="Benefícios">
        <Container>
          <ul className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8" data-reveal>
            {BENEFITS.map((benefit, index) => (
              <li key={benefit.title}>
                <span className="tabular text-sm font-semibold text-[var(--color-brand-text)]">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">{benefit.title}</h3>
                <p className="mt-2 leading-relaxed text-[var(--color-text-muted)]">{benefit.text}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 10. TESTE GRATIS */}
      <section id="teste-gratis" className="scroll-mt-16 py-20 sm:py-28" aria-labelledby="teste-title">
        <Container>
          <div className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-brand-border)] bg-[var(--color-brand-subtle)] px-6 py-14 text-center sm:px-12 sm:py-20" data-reveal>
            <h2 id="teste-title" className="mx-auto max-w-3xl text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
              Veja na prática se o Petflow serve para o seu negócio.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[1.0625rem] text-[var(--color-text-muted)] sm:text-lg">
              Crie sua conta gratuitamente e conheça o Petflow antes de decidir.
            </p>
            <div className="mt-9 flex justify-center">
              <PrimaryCta size="xl" className="w-full sm:w-auto">
                Começar meu teste grátis
              </PrimaryCta>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.875rem] text-[var(--color-text-muted)]">
              {trialNote.map((note) => (
                <li key={note} className="inline-flex items-center gap-1.5">
                  <Check aria-hidden className="size-4 text-[var(--color-success)]" /> {note}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* 11. FAQ / OBJECOES */}
      <section className="pb-20 sm:pb-28" aria-labelledby="faq-title">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
          <div data-reveal>
            <Eyebrow>Dúvidas</Eyebrow>
            <h2 id="faq-title" className="mt-3 text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-4xl">
              Perguntas frequentes
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]" data-reveal>
            {faq.map((item) => (
              <details key={item.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[1.0625rem] font-semibold [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-5 leading-relaxed text-[var(--color-text-muted)]">{item.answer}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* 12. CTA FINAL */}
      <section className="relative overflow-hidden bg-[var(--color-ink)] py-20 text-[var(--color-ink-text)] sm:py-28" aria-labelledby="final-title">
        <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-[var(--color-brand)] opacity-20 blur-3xl" />
        <Container className="relative text-center">
          <h2 id="final-title" className="mx-auto max-w-3xl text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-[var(--color-ink-text)] sm:text-6xl">
            Seu pet shop pode funcionar de forma mais simples.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--color-ink-muted)] sm:text-lg">
            Tenha mais controle da operação, economize tempo e enxergue onde seu negócio está perdendo dinheiro.
          </p>
          <div className="mt-10 flex justify-center">
            <PrimaryCta size="xl" className="w-full sm:w-auto" />
          </div>
          <p className="mt-5 text-[0.875rem] text-[var(--color-ink-muted)]">{trialNote.join(' • ')}</p>
        </Container>
      </section>

      <footer className="bg-[var(--color-ink)] text-[var(--color-ink-muted)]">
        <Container className="flex flex-col items-center justify-between gap-5 border-t border-[var(--color-ink-border)] py-8 text-[0.8125rem] sm:flex-row">
          <Logo tone="light" />
          <nav aria-label="Rodapé" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#produto" className="hover:text-[var(--color-ink-text)]">Produto</a>
            <a href="#recursos" className="hover:text-[var(--color-ink-text)]">Recursos</a>
            <Link to="/planos" className="hover:text-[var(--color-ink-text)]">Planos</Link>
            <Link to="/entrar" className="hover:text-[var(--color-ink-text)]">Entrar</Link>
            {/* Sem conteudo juridico definido ainda -- marcado explicitamente. */}
            <span title="Texto a definir">Termos (em breve)</span>
            <span title="Texto a definir">Privacidade (em breve)</span>
          </nav>
        </Container>
      </footer>
    </div>
  );
}
