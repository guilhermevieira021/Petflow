import { APPOINTMENT_STATUS_LABELS, type AppointmentDetailDto } from '@petflow/contracts';
import { MessageCircle, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, formatTime, formatWeekdayShort, whatsappLink } from '@/lib/format';
import { APPOINTMENT_STATUS_ACCENTS, APPOINTMENT_STATUS_TONES } from './status';

type CardAppointment = Pick<
  AppointmentDetailDto,
  'id' | 'startsAt' | 'endsAt' | 'status' | 'price' | 'customerName' | 'customerWhatsapp' | 'petName' | 'serviceName' | 'professionalName'
>;

/**
 * Cartao de um atendimento. Apresentacao pura -- as acoes de status entram
 * pelo slot `actions`, entao a landing pode reaproveitar o mesmo cartao sem
 * mutacoes nem sessao.
 *
 * Hierarquia fixa: horario > pet > cliente > servico/valor > status. O
 * horario tem coluna propria e nunca encosta no nome (bug antigo da agenda).
 */
export function AppointmentCard({
  appointment,
  timeZone,
  showDate = false,
  actions,
  interactive = true,
}: {
  appointment: CardAppointment;
  timeZone: string;
  showDate?: boolean;
  actions?: ReactNode;
  interactive?: boolean;
}) {
  const link = interactive
    ? whatsappLink(
        appointment.customerWhatsapp,
        `Ola, ${appointment.customerName.split(' ')[0]}! Confirmando o atendimento do ${appointment.petName} as ${formatTime(appointment.startsAt, timeZone)}.`,
      )
    : null;
  const inactive = appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW';

  return (
    <article
      className={cn(
        'relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] py-4 pr-4 pl-5 shadow-[var(--shadow-xs)]',
        'lg:flex-row lg:items-center lg:gap-5',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: APPOINTMENT_STATUS_ACCENTS[appointment.status] }}
      />

      <div className="flex items-start justify-between gap-3 lg:w-24 lg:shrink-0 lg:flex-col lg:justify-center lg:gap-0.5">
        <div>
          {showDate ? (
            <p className="text-[0.75rem] font-medium whitespace-nowrap text-[var(--color-text-muted)] capitalize">
              {formatWeekdayShort(appointment.startsAt, timeZone)}, {formatDate(appointment.startsAt, timeZone)}
            </p>
          ) : null}
          <p className="tabular text-lg leading-tight font-semibold whitespace-nowrap">
            {formatTime(appointment.startsAt, timeZone)}
          </p>
          <p className="tabular text-[0.75rem] whitespace-nowrap text-[var(--color-text-subtle)]">
            até {formatTime(appointment.endsAt, timeZone)}
          </p>
        </div>
        <Badge dot tone={APPOINTMENT_STATUS_TONES[appointment.status]} className="lg:hidden">
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </Badge>
      </div>

      <div className={cn('min-w-0 flex-1', inactive && 'opacity-70')}>
        <p className="truncate text-[0.9375rem] font-semibold">
          {appointment.petName}
          <span className="font-normal text-[var(--color-text-muted)]"> · {appointment.customerName}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">
          <span className="truncate">{appointment.serviceName}</span>
          <span aria-hidden>·</span>
          <span className="tabular font-medium text-[var(--color-text)]">{formatMoney(appointment.price)}</span>
          {appointment.professionalName ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <UserRound aria-hidden className="size-3.5" />
                {appointment.professionalName}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
        <Badge dot tone={APPOINTMENT_STATUS_TONES[appointment.status]} className="max-lg:hidden">
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </Badge>
        {actions}
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`WhatsApp de ${appointment.customerName}`}
            title="Abrir conversa no WhatsApp"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-success)] hover:bg-[var(--color-success-subtle)] hover:text-[var(--color-success)] max-lg:ml-auto"
          >
            <MessageCircle aria-hidden className="size-4" />
          </a>
        ) : null}
      </div>
    </article>
  );
}
