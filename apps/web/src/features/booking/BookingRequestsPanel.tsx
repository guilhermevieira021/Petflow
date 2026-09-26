import { PET_SPECIES_LABELS, Permission, type BookingRequestDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ReasonDialog } from '@/components/ui/ReasonDialog';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDateLong, formatPhone, formatTime } from '@/lib/format';

/**
 * Solicitacoes do link publico aguardando resposta. Aceitar cria cliente/pet
 * (quando novos) e o agendamento pelo fluxo normal -- com checagem de
 * conflito; recusar guarda o motivo. Some da tela quando nao ha pendencias.
 */
export function BookingRequestsPanel() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<BookingRequestDto | null>(null);
  const timeZone = session.tenant.timezone;
  const canWrite = can(Permission.APPOINTMENTS_WRITE);

  const query = useQuery({
    queryKey: ['booking-requests', 'PENDING'],
    queryFn: () => api.get<BookingRequestDto[]>('/booking-requests'),
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['booking-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/booking-requests/${id}/accept`),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Solicitação aceita. O atendimento entrou na agenda.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível aceitar.'),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/booking-requests/${id}/reject`, { reason: reason || null }),
    onSuccess: async () => {
      setRejecting(null);
      await refresh();
      toast.success('Solicitação recusada.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível recusar.'),
  });

  const items = query.data ?? [];
  if (items.length === 0) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Pedidos do agendamento online"
        description="Ainda não estão na agenda. Aceite para confirmar ou recuse. Avise o tutor pelo WhatsApp."
        icon={<Inbox className="size-4" />}
        action={<Badge tone="warning">{items.length}</Badge>}
      />
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm font-semibold">
                {formatDateLong(item.startsAt, timeZone)} · {formatTime(item.startsAt, timeZone)}
              </p>
              <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                {item.serviceName} · {item.petName} ({PET_SPECIES_LABELS[item.petSpecies]})
              </p>
              <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                {item.customerName} · {formatPhone(item.customerPhone)}
                {item.matchedCustomerName ? (
                  <span className="text-[var(--color-success)]"> · já é cliente ({item.matchedCustomerName})</span>
                ) : (
                  <span> · cliente novo</span>
                )}
              </p>
              {item.notes ? <p className="mt-1 text-[0.8125rem] whitespace-pre-line">“{item.notes}”</p> : null}
            </div>
            {canWrite ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<X className="size-4" />}
                  onClick={() => setRejecting(item)}
                  disabled={accept.isPending}
                >
                  Recusar
                </Button>
                <Button
                  size="sm"
                  icon={<Check className="size-4" />}
                  loading={accept.isPending && accept.variables === item.id}
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(item.id)}
                >
                  Aceitar
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ReasonDialog
        open={Boolean(rejecting)}
        title="Recusar solicitação?"
        description="O pedido sai da lista. O tutor não é avisado automaticamente."
        label="Motivo (opcional)"
        confirmLabel="Recusar"
        required={false}
        loading={reject.isPending}
        onConfirm={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })}
        onCancel={() => setRejecting(null)}
      />
    </Card>
  );
}
