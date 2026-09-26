import {
  PET_HEALTH_TYPE_LABELS,
  Permission,
  type HealthDueStatus,
  type PetHealthRecordDto,
  type PetHealthType,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Pill, Plus, Stethoscope, Syringe, Trash2, type LucideIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format';
import { todayInTimeZone } from '@/lib/timezone';

const TYPE_ICONS: Record<PetHealthType, LucideIcon> = {
  VACCINE: Syringe,
  DEWORMER: Pill,
  MEDICATION: Pill,
  CLINICAL_NOTE: Stethoscope,
};

const DUE_BADGE: Partial<Record<HealthDueStatus, { tone: BadgeTone; label: (date: string) => string }>> = {
  OVERDUE: { tone: 'danger', label: (date) => `Vencida em ${date}` },
  DUE_SOON: { tone: 'warning', label: (date) => `Vence em ${date}` },
  OK: { tone: 'success', label: (date) => `Próxima: ${date}` },
};

function HealthRecordDrawer({ petId, open, onClose }: { petId: string; open: boolean; onClose: () => void }) {
  const session = useCurrentSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = todayInTimeZone(session.tenant.timezone);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<PetHealthRecordDto>(`/pets/${petId}/health`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pets', 'health', petId] });
      await queryClient.invalidateQueries({ queryKey: ['health'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Registro adicionado ao histórico.');
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      type: String(data.get('type')),
      title: String(data.get('title') ?? ''),
      occurredOn: String(data.get('occurredOn') ?? ''),
      nextDueOn: String(data.get('nextDueOn') ?? '') || null,
      notes: String(data.get('notes') ?? '') || null,
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer open={open} onClose={onClose} title="Novo registro de saúde" description="Vacina, vermífugo, medicamento ou observação clínica.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <SelectField
          label="Tipo"
          name="type"
          defaultValue="VACCINE"
          options={(Object.keys(PET_HEALTH_TYPE_LABELS) as PetHealthType[]).map((type) => ({ value: type, label: PET_HEALTH_TYPE_LABELS[type] }))}
        />
        <TextField label="Nome" name="title" placeholder="Ex.: V10, Antirrábica, Drontal" required error={apiError?.fieldError('title')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Data" name="occurredOn" type="date" defaultValue={today} required error={apiError?.fieldError('occurredOn')} />
          <TextField
            label="Próxima dose / retorno"
            name="nextDueOn"
            type="date"
            hint="Gera alerta de vencimento."
            error={apiError?.fieldError('nextDueOn')}
          />
        </div>
        <TextAreaField label="Observações" name="notes" rows={3} error={apiError?.fieldError('notes')} />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Salvar registro
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function PetHealthSection({ petId }: { petId: string }) {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PetHealthRecordDto | null>(null);

  const query = useQuery({
    queryKey: ['pets', 'health', petId],
    queryFn: () => api.get<PetHealthRecordDto[]>(`/pets/${petId}/health`),
  });

  const remove = useMutation({
    mutationFn: (recordId: string) => api.delete(`/pets/${petId}/health/${recordId}`),
    onSuccess: async () => {
      setToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['pets', 'health', petId] });
      await queryClient.invalidateQueries({ queryKey: ['health'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Registro removido do histórico.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível remover.'),
  });

  const records = query.data ?? [];
  const alerts = records.filter((record) => record.dueStatus === 'OVERDUE' || record.dueStatus === 'DUE_SOON');

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Saúde"
        description="Vacinas, vermífugos, medicamentos e observações clínicas."
        icon={<HeartPulse className="size-4" />}
        action={
          can(Permission.PETS_WRITE) ? (
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Registrar
            </Button>
          ) : null
        }
      />

      {alerts.length > 0 ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-warning-subtle)] px-5 py-3 text-[0.8125rem] text-[var(--color-warning)]" role="status">
          {alerts.length === 1 ? '1 item precisa de atenção' : `${alerts.length} itens precisam de atenção`}:{' '}
          {alerts.map((record) => record.title).join(', ')}.
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
      {query.isError ? (
        <ErrorState message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data && records.length === 0 ? (
        <EmptyState
          compact
          icon={<Syringe className="size-5" />}
          title="Nenhum registro de saúde"
          description="Registre vacinas e vermífugos para receber alertas de vencimento."
        />
      ) : null}

      {records.length > 0 ? (
        <ol className="px-5 py-2">
          {records.map((record, index) => {
            const Icon = TYPE_ICONS[record.type];
            const due = record.nextDueOn ? DUE_BADGE[record.dueStatus] : undefined;
            return (
              <li key={record.id} className="relative flex gap-3 py-3">
                {index < records.length - 1 ? (
                  <span aria-hidden className="absolute top-12 bottom-0 left-[17px] w-px bg-[var(--color-border)]" />
                ) : null}
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand-text)]"
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{record.title}</p>
                    <Badge tone="neutral">{PET_HEALTH_TYPE_LABELS[record.type]}</Badge>
                    {due && record.nextDueOn ? (
                      <Badge dot tone={due.tone}>
                        {due.label(formatCalendarDate(record.nextDueOn))}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">
                    {formatCalendarDate(record.occurredOn)}
                    {record.createdByName ? ` · ${record.createdByName}` : ''}
                  </p>
                  {record.notes ? <p className="mt-1 text-[0.8125rem] whitespace-pre-line">{record.notes}</p> : null}
                </div>
                {can(Permission.PETS_DELETE) ? (
                  <button
                    type="button"
                    onClick={() => setToDelete(record)}
                    aria-label={`Remover ${record.title}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-subtle)] hover:text-[var(--color-danger)]"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {drawerOpen ? <HealthRecordDrawer petId={petId} open onClose={() => setDrawerOpen(false)} /> : null}
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Remover registro?"
        description={`"${toDelete?.title ?? ''}" sai do histórico do pet.`}
        confirmLabel="Remover"
        destructive
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  );
}
