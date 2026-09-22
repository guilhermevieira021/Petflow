import {
  APPOINTMENT_STATUS_LABELS,
  Permission,
  type AppointmentDetailDto,
  type AppointmentStatus,
} from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';

/**
 * Proxima acao "positiva" sugerida para cada status -- a que move o
 * atendimento adiante. Cancelar e faltar ficam num menu separado porque sao
 * o caminho de saida, nao o caminho esperado.
 */
const PRIMARY_NEXT: Partial<Record<AppointmentStatus, AppointmentStatus>> = {
  SCHEDULED: 'CONFIRMED',
  CONFIRMED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
};

export function AppointmentStatusActions({ appointment }: { appointment: AppointmentDetailDto }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: { status: AppointmentStatus; reason?: string }) =>
      api.patch<AppointmentDetailDto>(`/appointments/${appointment.id}/status`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Agendamento atualizado.');
      setConfirmCancel(false);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel atualizar.');
      setConfirmCancel(false);
    },
  });

  if (!can(Permission.APPOINTMENTS_WRITE)) return null;

  const primaryNext = PRIMARY_NEXT[appointment.status];
  const canCancelOrNoShow = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status);
  const canMarkNoShow = ['SCHEDULED', 'CONFIRMED'].includes(appointment.status);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {primaryNext ? (
        <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate({ status: primaryNext })}>
          {primaryNext === 'CONFIRMED' && 'Confirmar'}
          {primaryNext === 'IN_PROGRESS' && 'Iniciar'}
          {primaryNext === 'COMPLETED' && 'Concluir'}
        </Button>
      ) : null}

      {canMarkNoShow ? (
        <Button
          size="sm"
          variant="secondary"
          loading={mutation.isPending}
          onClick={() => mutation.mutate({ status: 'NO_SHOW' })}
        >
          {APPOINTMENT_STATUS_LABELS.NO_SHOW}
        </Button>
      ) : null}

      {canCancelOrNoShow && can(Permission.APPOINTMENTS_CANCEL) ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
          Cancelar
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar agendamento?"
        description={`O horario de ${appointment.petName} com ${appointment.customerName} sera liberado.`}
        confirmLabel="Cancelar agendamento"
        destructive
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ status: 'CANCELLED', reason: 'Cancelado pelo pet shop.' })}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
