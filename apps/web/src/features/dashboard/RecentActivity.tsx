import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus, type AuditLogDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarPlus, CreditCard, Dog, RefreshCcw, UserPlus, type LucideIcon } from 'lucide-react';
import { Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';

/**
 * Atividades recentes, a partir do log de auditoria real (/audit-logs).
 * So aparece para quem tem AUDIT_READ -- o proprio DashboardPage decide.
 * Eventos de login/sessao ficam de fora: sao seguranca, nao operacao.
 */

interface Described {
  icon: LucideIcon;
  text: string;
}

function metaString(log: AuditLogDto, key: string): string | null {
  const value = log.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function describe(log: AuditLogDto): Described | null {
  switch (log.action) {
    case 'customer.created': {
      const name = metaString(log, 'name');
      return { icon: UserPlus, text: name ? `Novo cliente: ${name}` : 'Novo cliente cadastrado' };
    }
    case 'pet.created': {
      const name = metaString(log, 'name');
      return { icon: Dog, text: name ? `Novo pet: ${name}` : 'Novo pet cadastrado' };
    }
    case 'appointment.created':
      return { icon: CalendarPlus, text: 'Novo agendamento criado' };
    case 'appointment.status_changed': {
      const to = metaString(log, 'to') as AppointmentStatus | null;
      const label = to && to in APPOINTMENT_STATUS_LABELS ? APPOINTMENT_STATUS_LABELS[to] : null;
      return { icon: RefreshCcw, text: label ? `Atendimento marcado como "${label}"` : 'Status de atendimento alterado' };
    }
    case 'appointment.cancelled':
      return { icon: RefreshCcw, text: 'Agendamento cancelado' };
    case 'payment.recorded':
      return { icon: CreditCard, text: 'Pagamento registrado' };
    case 'customer.updated':
      return { icon: Activity, text: 'Dados de cliente atualizados' };
    case 'pet.updated':
      return { icon: Activity, text: 'Ficha de pet atualizada' };
    default:
      return null;
  }
}

export function RecentActivity() {
  const query = useQuery({
    queryKey: ['audit-logs', 'recent'],
    queryFn: () => api.get<Paginated<AuditLogDto>>('/audit-logs', { pageSize: 30 }),
    staleTime: 30_000,
  });

  const items = (query.data?.data ?? [])
    .map((log) => ({ log, described: describe(log) }))
    .filter((item): item is { log: AuditLogDto; described: Described } => item.described !== null)
    .slice(0, 6);

  return (
    <Card className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-semibold">Atividades recentes</h2>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-3 p-5" aria-busy="true">
          <span className="sr-only">Carregando atividades</span>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">Não foi possível carregar as atividades agora.</p>
      ) : null}

      {query.data && items.length === 0 ? (
        <EmptyState compact icon={<Activity className="size-5" />} title="Nenhuma atividade ainda" />
      ) : null}

      {items.length > 0 ? (
        <ol className="flex flex-col px-5 py-2">
          {items.map(({ log, described }, index) => {
            const Icon = described.icon;
            return (
              <li key={log.id} className="relative flex gap-3 py-2.5">
                {index < items.length - 1 ? (
                  <span aria-hidden className="absolute top-10 bottom-0 left-[15px] w-px bg-[var(--color-border)]" />
                ) : null}
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm leading-snug break-words">{described.text}</p>
                  <p className="mt-0.5 text-[0.75rem] text-[var(--color-text-subtle)]">
                    {log.userName ? `${log.userName} · ` : ''}
                    {formatRelative(log.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </Card>
  );
}
