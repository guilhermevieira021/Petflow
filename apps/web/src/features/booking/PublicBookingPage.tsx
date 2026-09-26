import {
  PET_SPECIES_LABELS,
  type PetSpecies,
  type PublicAvailabilityDto,
  type PublicBookingProfileDto,
  type PublicBookingRequestResultDto,
} from '@petflow/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck2, CheckCircle2, Clock } from 'lucide-react';
import { type CSSProperties, type FormEvent, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateLong, formatMoney, formatTime } from '@/lib/format';
import { shiftDate, todayInTimeZone } from '@/lib/timezone';

/**
 * /agendar/:slug -- pagina publica, sem login. O tutor escolhe servico, dia e
 * horario LIVRE (calculado pelo servidor) e envia uma solicitacao. Nada aqui
 * vira agendamento sozinho: o pet shop aceita ou recusa na agenda.
 */

const REASON_TEXT: Record<PublicAvailabilityDto['reason'], string> = {
  OPEN: '',
  CLOSED_DAY: 'O pet shop não atende neste dia.',
  OUT_OF_RANGE: 'Esta data está fora do período aberto para agendamento.',
  FULL: 'Não há horários livres neste dia. Tente outra data.',
};

function dayLabel(date: string): { weekday: string; day: string } {
  const instant = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(instant).replace('.', ''),
    day: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(instant),
  };
}

function StepTitle({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-brand-subtle)] text-xs text-[var(--color-brand-text)]">
        {step}
      </span>
      {title}
    </h2>
  );
}

function RequestForm({
  slug,
  profile,
  serviceId,
  startsAt,
  onBack,
  onDone,
}: {
  slug: string;
  profile: PublicBookingProfileDto;
  serviceId: string;
  startsAt: string;
  onBack: () => void;
  onDone: (result: PublicBookingRequestResultDto) => void;
}) {
  const service = profile.services.find((item) => item.id === serviceId);
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<PublicBookingRequestResultDto>(`/public/booking/${slug}/requests`, payload),
    onSuccess: onDone,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const website = String(data.get('website') ?? '');
    mutation.mutate({
      serviceId,
      startsAt,
      customerName: String(data.get('customerName') ?? ''),
      customerPhone: String(data.get('customerPhone') ?? ''),
      petName: String(data.get('petName') ?? ''),
      petSpecies: String(data.get('petSpecies') ?? 'DOG'),
      notes: String(data.get('notes') ?? '') || null,
      ...(website ? { website } : {}),
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--color-brand-subtle)] p-3.5">
        <CalendarCheck2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-text)]" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{service?.name}</p>
          <p className="text-[var(--color-text-muted)]">
            {formatDateLong(startsAt, profile.timezone)} às {formatTime(startsAt, profile.timezone)}
          </p>
        </div>
        <button type="button" onClick={onBack} className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline">
          Trocar
        </button>
      </div>

      <TextField label="Seu nome" name="customerName" autoComplete="name" required error={apiError?.fieldError('customerName')} />
      <TextField
        label="WhatsApp / telefone"
        name="customerPhone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(11) 98888-7777"
        required
        error={apiError?.fieldError('customerPhone')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nome do pet" name="petName" required error={apiError?.fieldError('petName')} />
        <SelectField
          label="Espécie"
          name="petSpecies"
          defaultValue="DOG"
          options={(Object.keys(PET_SPECIES_LABELS) as PetSpecies[]).map((species) => ({
            value: species,
            label: PET_SPECIES_LABELS[species],
          }))}
        />
      </div>
      <TextAreaField label="Observações (opcional)" name="notes" rows={3} error={apiError?.fieldError('notes')} />

      {/* Honeypot: invisivel para pessoas, preenchido por robos. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Site
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {apiError && apiError.fields.length === 0 ? (
        <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-danger-subtle)] p-3 text-[0.8125rem] text-[var(--color-danger)]">
          {apiError.message}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
          Voltar
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Enviar solicitação
        </Button>
      </div>
      <p className="text-center text-[0.75rem] text-[var(--color-text-subtle)]">
        Seus dados são enviados somente para {profile.name}, para confirmar o atendimento.
      </p>
    </form>
  );
}

export function PublicBookingPage() {
  const { slug = '' } = useParams();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [result, setResult] = useState<PublicBookingRequestResultDto | null>(null);

  const profileQuery = useQuery({
    queryKey: ['public-booking', slug],
    queryFn: () => api.get<PublicBookingProfileDto>(`/public/booking/${slug}`),
    retry: false,
  });
  const profile = profileQuery.data;

  const days = useMemo(() => {
    if (!profile) return [];
    const today = todayInTimeZone(profile.timezone);
    return Array.from({ length: Math.min(profile.maxDaysAhead + 1, 21) }, (_, index) => shiftDate(today, index));
  }, [profile]);
  const selectedDate = date ?? days[0] ?? null;

  const availabilityQuery = useQuery({
    queryKey: ['public-booking', slug, 'availability', serviceId, selectedDate],
    queryFn: () =>
      api.get<PublicAvailabilityDto>(`/public/booking/${slug}/availability`, { serviceId: serviceId ?? '', date: selectedDate ?? '' }),
    enabled: Boolean(profile && serviceId && selectedDate),
  });

  // Os tokens derivados sao calculados no :root; redeclara aqui para a cor do
  // pet shop valer so nesta pagina, sem mexer no tema do app.
  const brandStyle = profile
    ? ({
        '--color-brand': profile.primaryColor,
        '--color-brand-hover': 'color-mix(in oklab, var(--color-brand) 88%, #000)',
        '--color-brand-active': 'color-mix(in oklab, var(--color-brand) 78%, #000)',
        '--color-brand-subtle': 'color-mix(in oklab, var(--color-brand) 9%, #fff)',
        '--color-brand-border': 'color-mix(in oklab, var(--color-brand) 28%, #fff)',
        '--color-brand-text': 'color-mix(in oklab, var(--color-brand) 82%, #000)',
      } as CSSProperties)
    : undefined;
  const notFound = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;

  return (
    <div style={brandStyle} className="min-h-dvh bg-[var(--color-canvas)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {profile?.logoUrl ? (
            <img src={profile.logoUrl} alt="" className="size-10 rounded-[var(--radius-md)] object-cover" />
          ) : profile ? (
            <span className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand)] text-base font-semibold text-white">
              {profile.name.charAt(0)}
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{profile?.name ?? 'Agendamento online'}</p>
            {profile ? <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Agende um horário</p> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {profileQuery.isLoading ? (
          <Card className="flex flex-col gap-3 p-5" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </Card>
        ) : null}

        {notFound ? (
          <Card>
            <EmptyState
              icon={<CalendarCheck2 className="size-5" />}
              title="Agendamento indisponível"
              description="Este link não existe ou o pet shop não está recebendo pedidos online agora. Fale diretamente com o pet shop."
            />
          </Card>
        ) : profileQuery.isError ? (
          <Card>
            <ErrorState message="Não foi possível carregar a página." onRetry={() => void profileQuery.refetch()} />
          </Card>
        ) : null}

        {profile && result ? (
          <Card className="p-6 text-center">
            <CheckCircle2 aria-hidden className="mx-auto size-10 text-[var(--color-success)]" />
            <h1 className="mt-3 text-lg font-semibold">Solicitação enviada</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {result.serviceName} · {formatDateLong(result.startsAt, profile.timezone)} às {formatTime(result.startsAt, profile.timezone)}
            </p>
            <p className="mt-4 text-sm">
              O horário ainda <strong>não está confirmado</strong>. {profile.name} vai analisar o pedido e
              entrar em contato com você.
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => {
                setResult(null);
                setStartsAt(null);
                setServiceId(null);
              }}
            >
              Fazer outro pedido
            </Button>
          </Card>
        ) : null}

        {profile && !result ? (
          <Card className="flex flex-col gap-6 p-5">
            {startsAt && serviceId ? (
              <RequestForm
                slug={slug}
                profile={profile}
                serviceId={serviceId}
                startsAt={startsAt}
                onBack={() => setStartsAt(null)}
                onDone={setResult}
              />
            ) : (
              <>
                <section>
                  <StepTitle step={1} title="Escolha o serviço" />
                  {profile.services.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">Nenhum serviço disponível para agendamento online.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {profile.services.map((service) => (
                        <li key={service.id}>
                          <button
                            type="button"
                            aria-pressed={serviceId === service.id}
                            onClick={() => setServiceId(service.id)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-[var(--radius-md)] border p-3.5 text-left transition-colors',
                              serviceId === service.id
                                ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
                                : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold">{service.name}</span>
                              <span className="mt-0.5 flex items-center gap-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                                <Clock aria-hidden className="size-3.5" />
                                {service.durationMinutes} min
                                {service.description ? ` · ${service.description}` : ''}
                              </span>
                            </span>
                            <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(service.price)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {serviceId ? (
                  <section>
                    <StepTitle step={2} title="Escolha o dia" />
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Dias">
                      {days.map((day) => {
                        const label = dayLabel(day);
                        const active = day === selectedDate;
                        return (
                          <button
                            key={day}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => setDate(day)}
                            className={cn(
                              'flex w-14 shrink-0 flex-col items-center rounded-[var(--radius-md)] border py-2 text-center transition-colors',
                              active
                                ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                                : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]',
                            )}
                          >
                            <span className="text-[0.6875rem] uppercase opacity-80">{label.weekday}</span>
                            <span className="tabular text-sm font-semibold">{label.day}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {serviceId && selectedDate ? (
                  <section>
                    <StepTitle step={3} title="Escolha o horário" />
                    {availabilityQuery.isLoading ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-busy="true">
                        {Array.from({ length: 5 }, (_, index) => (
                          <Skeleton key={index} className="h-10" />
                        ))}
                      </div>
                    ) : availabilityQuery.isError ? (
                      <ErrorState message="Não foi possível carregar os horários." onRetry={() => void availabilityQuery.refetch()} />
                    ) : availabilityQuery.data && availabilityQuery.data.slots.length === 0 ? (
                      <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-3.5 text-sm text-[var(--color-text-muted)]">
                        {REASON_TEXT[availabilityQuery.data.reason] || REASON_TEXT.FULL}
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {availabilityQuery.data?.slots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setStartsAt(slot)}
                            className="tabular rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 text-sm font-medium transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-subtle)]"
                          >
                            {formatTime(slot, profile.timezone)}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <p className="mt-8 flex items-center justify-center gap-1.5 text-[0.75rem] text-[var(--color-text-subtle)]">
          Agendamento por <span className="font-semibold text-[var(--color-text-muted)]">Petflow</span>
        </p>
      </main>
    </div>
  );
}
