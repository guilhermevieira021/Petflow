import { ChevronRight, Info, MessageCircle, PawPrint } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { AppointmentCard } from '@/features/appointments/AppointmentCard';
import { DashboardContent } from '@/features/dashboard/DashboardPage';
import { LostPanel, TodayFinancePanel, UpcomingList, WeekSummary } from '@/features/dashboard/DashboardPanels';
import { PetAvatar } from '@/features/pets/PetAvatar';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { DEMO_AGENDA, DEMO_CUSTOMER, DEMO_DASHBOARD, DEMO_TIMEZONE } from './demoData';

/* ---------------------------------------------------------------------------
   Revelacao discreta ao rolar -- so opacidade/translate, sem biblioteca.
--------------------------------------------------------------------------- */

export function useRevealOnScroll(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('reveal-ready');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);
}

/* ---------------------------------------------------------------------------
   Moldura de produto -- toda tela de demonstracao passa por aqui e recebe o
   selo "Demonstracao". `inert`: nada dentro recebe foco ou clique.
--------------------------------------------------------------------------- */

export function ProductFrame({
  children,
  label,
  className,
  contentClassName,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_40px_80px_-32px_rgb(13_17_23/0.35),0_0_0_1px_rgb(13_17_23/0.02)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--color-border-strong)]" />
          <span className="size-2.5 rounded-full bg-[var(--color-border-strong)]" />
          <span className="size-2.5 rounded-full bg-[var(--color-border-strong)]" />
        </span>
        <figcaption className="truncate rounded-full bg-[var(--color-surface-sunken)] px-3 py-0.5 text-[0.6875rem] font-medium text-[var(--color-text-muted)]">
          {label} · Demonstração com dados fictícios
        </figcaption>
      </div>
      <div inert className={cn('bg-[var(--color-canvas)] p-3 text-left sm:p-5', contentClassName)}>
        {children}
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------------------
   Composicao do hero
--------------------------------------------------------------------------- */

export function HeroProduct() {
  return (
    <ProductFrame label="Início" contentClassName="max-h-[34rem] overflow-hidden sm:max-h-[40rem] relative">
      <div className="grid gap-3 lg:grid-cols-12 sm:gap-4">
        <div className="lg:col-span-7">
          <TodayFinancePanel today={DEMO_DASHBOARD.today} referenceDate={DEMO_DASHBOARD.referenceDate} />
        </div>
        <div className="lg:col-span-5">
          <LostPanel today={DEMO_DASHBOARD.today} week={DEMO_DASHBOARD.week} />
        </div>
        <div className="lg:col-span-12">
          <WeekSummary week={DEMO_DASHBOARD.week} />
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--color-canvas)] to-transparent" />
    </ProductFrame>
  );
}

/* ---------------------------------------------------------------------------
   Vitrines das telas
--------------------------------------------------------------------------- */

export function AgendaShowcase() {
  return (
    <ProductFrame label="Agenda">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="text-sm font-semibold">Hoje</p>
        <Badge dot tone="brand">
          {DEMO_AGENDA.length} atendimentos
        </Badge>
      </div>
      <ul className="flex flex-col gap-2.5">
        {DEMO_AGENDA.map((appointment) => (
          <li key={appointment.id}>
            <AppointmentCard appointment={appointment} timeZone={DEMO_TIMEZONE} interactive={false} />
          </li>
        ))}
      </ul>
    </ProductFrame>
  );
}

export function CustomerShowcase() {
  return (
    <ProductFrame label="Clientes">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <Avatar name={DEMO_CUSTOMER.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold tracking-tight">{DEMO_CUSTOMER.name}</span>
              <Badge dot tone="success">
                Ativo
              </Badge>
            </p>
            <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
              {DEMO_CUSTOMER.phone} · {DEMO_CUSTOMER.since}
            </p>
          </div>
          <span className="hidden size-10 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-success)] sm:flex">
            <MessageCircle aria-hidden className="size-4" />
          </span>
        </div>
        <dl className="grid grid-cols-3 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60">
          {DEMO_CUSTOMER.stats.map((stat, index) => (
            <div key={stat.label} className={cn('px-4 py-3', index > 0 && 'border-l border-[var(--color-border)]')}>
              <dt className="text-[0.6875rem] text-[var(--color-text-muted)]">{stat.label}</dt>
              <dd className="tabular text-[0.9375rem] font-semibold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {DEMO_CUSTOMER.pets.map((pet) => (
          <div key={pet.name} className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
            <PetAvatar species={pet.species} name={pet.name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{pet.name}</p>
              <p className="truncate text-[0.75rem] text-[var(--color-text-muted)]">{pet.detail}</p>
            </div>
            <ChevronRight aria-hidden className="size-4 text-[var(--color-text-subtle)]" />
          </div>
        ))}
      </div>

      <Card className="mt-3">
        <p className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">Histórico de atendimentos</p>
        <ul className="divide-y divide-[var(--color-border)]">
          {DEMO_CUSTOMER.history.map((item) => (
            <li key={`${item.service}-${item.when}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[0.8125rem]">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{item.service}</span>
                <span className="text-[var(--color-text-muted)]"> · {item.pet} · {item.when}</span>
              </span>
              <span className="tabular shrink-0 font-medium">{item.price}</span>
            </li>
          ))}
        </ul>
      </Card>
    </ProductFrame>
  );
}

type ShowcaseTab = 'dashboard' | 'agenda' | 'clientes';

export function ProductShowcase() {
  const [tab, setTab] = useState<ShowcaseTab>('dashboard');
  const panelId = useId();

  return (
    <div>
      <div className="mb-6 flex justify-center">
        <SegmentedControl
          label="Telas do Petflow"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'dashboard', label: 'Início' },
            { value: 'agenda', label: 'Agenda' },
            { value: 'clientes', label: 'Clientes e pets' },
          ]}
        />
      </div>
      <div id={panelId} role="tabpanel" aria-label="Demonstração da tela selecionada" className="mx-auto max-w-5xl">
        {tab === 'dashboard' ? (
          <ProductFrame label="Início" contentClassName="max-h-[46rem] overflow-hidden relative">
            <DashboardContent data={DEMO_DASHBOARD} interactive={false} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--color-canvas)] to-transparent" />
          </ProductFrame>
        ) : null}
        {tab === 'agenda' ? <AgendaShowcase /> : null}
        {tab === 'clientes' ? <CustomerShowcase /> : null}
      </div>
    </div>
  );
}

export function UpcomingShowcase() {
  return (
    <ProductFrame label="Próximos atendimentos">
      <Card>
        <UpcomingList items={DEMO_DASHBOARD.upcoming} timeZone={DEMO_TIMEZONE} interactive={false} />
      </Card>
    </ProductFrame>
  );
}

/* ---------------------------------------------------------------------------
   Simulacao ilustrativa de perda -- o visitante ajusta com os proprios
   numeros. Deixa explicito que e um exemplo, nao resultado prometido.
--------------------------------------------------------------------------- */

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.875rem] text-[var(--color-ink-muted)]">
          {label}
        </label>
        <span className="tabular text-lg font-semibold text-[var(--color-ink-text)]">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-2 w-full cursor-pointer accent-[var(--color-brand)]"
      />
    </div>
  );
}

export function LossCalculator() {
  const [slots, setSlots] = useState(5);
  const [ticket, setTicket] = useState(80);
  const perWeek = slots * ticket;
  const perMonth = perWeek * 4;
  const perYear = perWeek * 52;

  return (
    <div className="overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--color-ink)] text-[var(--color-ink-text)] shadow-[var(--shadow-lg)]">
      <div className="grid lg:grid-cols-2">
        <div className="flex flex-col gap-7 p-6 sm:p-9">
          <p className="eyebrow text-[var(--color-brand-on-ink)]">Simulação ilustrativa</p>
          <RangeField
            label="Horários vazios ou faltas por semana"
            value={slots}
            min={1}
            max={20}
            step={1}
            onChange={setSlots}
            display={String(slots)}
          />
          <RangeField
            label="Ticket médio por atendimento"
            value={ticket}
            min={30}
            max={300}
            step={5}
            onChange={setTicket}
            display={formatMoney(ticket)}
          />
          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[var(--color-ink-muted)]">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            Exemplo ilustrativo com os valores acima. Não é uma estimativa do seu negócio nem um resultado garantido.
          </p>
        </div>

        <div className="flex flex-col justify-center border-t border-[var(--color-ink-border)] bg-white/[0.03] p-6 sm:p-9 lg:border-t-0 lg:border-l" aria-live="polite">
          <p className="tabular text-[0.9375rem] text-[var(--color-ink-muted)]">
            {slots} × {formatMoney(ticket)} = <span className="font-semibold text-[var(--color-ink-text)]">{formatMoney(perWeek)}</span> por semana
          </p>
          <p className="mt-6 text-[0.875rem] text-[var(--color-ink-muted)]">Aproximadamente</p>
          <p className="tabular text-5xl leading-none font-semibold tracking-tight text-[var(--color-danger-on-ink)] sm:text-6xl">
            {formatMoney(perMonth)}
          </p>
          <p className="mt-2 text-[0.9375rem] text-[var(--color-ink-muted)]">por mês que deixam de entrar</p>
          <div className="mt-7 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-ink-border)] px-4 py-3">
            <PawPrint aria-hidden className="size-4 shrink-0 text-[var(--color-brand-on-ink)]" />
            <p className="text-[0.875rem] text-[var(--color-ink-muted)]">
              Em um ano: <span className="tabular font-semibold text-[var(--color-ink-text)]">{formatMoney(perYear)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
