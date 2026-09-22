import type {
  AppointmentDetailDto,
  Paginated,
  PetWithCustomerDto,
  ServiceDto,
  UserDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { CustomerPicker } from '@/features/pets/CustomerPicker';
import { ApiError, api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

function toLocalDateInput(iso: string): string {
  return iso.slice(0, 10);
}
function toLocalTimeInput(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 5);
}

export function AppointmentFormDrawer({
  open,
  appointment,
  defaultCustomerId,
  defaultDate,
  onClose,
}: {
  open: boolean;
  /** Presente = edicao. */
  appointment?: AppointmentDetailDto;
  /** Cliente pre-selecionado (ex.: vindo do perfil do cliente ou pet). */
  defaultCustomerId?: string;
  /** Data pre-selecionada (ex.: vindo do dia da agenda selecionado). */
  defaultDate?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(appointment);

  const [customerId, setCustomerId] = useState(appointment?.customerId ?? defaultCustomerId ?? '');
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCustomerId(appointment?.customerId ?? defaultCustomerId ?? '');
      setConflictNotice(null);
    }
  }, [open, appointment?.customerId, defaultCustomerId]);

  const petsQuery = useQuery({
    queryKey: ['pets', 'byCustomer', customerId],
    queryFn: () => api.get<Paginated<PetWithCustomerDto>>('/pets', { customerId, pageSize: 50 }),
    enabled: Boolean(customerId),
  });

  const servicesQuery = useQuery({
    queryKey: ['services', 'active'],
    queryFn: () => api.get<Paginated<ServiceDto>>('/services', { active: true, pageSize: 100 }),
  });

  const teamQuery = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => api.get<Paginated<UserDto>>('/users', { active: true, pageSize: 100 }),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<AppointmentDetailDto>(`/appointments/${appointment!.id}`, payload)
        : api.post<AppointmentDetailDto>('/appointments', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(isEditing ? 'Agendamento atualizado.' : 'Agendamento criado.');
      onClose();
    },
    onError: (error) => {
      setConflictNotice(null);
      if (error instanceof ApiError && error.code === 'TIME_SLOT_TAKEN') {
        // Erro de negocio esperado (§30): mensagem amigavel, permanece no
        // formulario para a pessoa escolher outro horario -- nunca fingimos
        // que o horario ficou livre so porque o frontend nao percebeu.
        setConflictNotice('Esse horario ja esta ocupado. Escolha outro horario.');
        return;
      }
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setConflictNotice(null);
    const data = new FormData(event.currentTarget);
    const date = String(data.get('date') ?? '');
    const time = String(data.get('time') ?? '');
    const professionalId = String(data.get('professionalId') ?? '');

    const payload: Record<string, unknown> = {
      petId: String(data.get('petId') ?? ''),
      serviceId: String(data.get('serviceId') ?? ''),
      professionalId: professionalId || null,
      startsAt: new Date(`${date}T${time}:00`).toISOString(),
      notes: String(data.get('notes') ?? '') || null,
    };
    if (!isEditing) payload.customerId = customerId;

    mutation.mutate(payload);
  }

  const apiError = mutation.error instanceof ApiError && mutation.error.code !== 'TIME_SLOT_TAKEN' ? mutation.error : null;
  const selectedService = servicesQuery.data?.data.find(
    (service) => service.id === appointment?.serviceId,
  );

  return (
    <Drawer open={open} onClose={onClose} title={isEditing ? 'Editar agendamento' : 'Novo agendamento'}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {!isEditing ? (
          <CustomerPicker value={customerId} onChange={setCustomerId} error={apiError?.fieldError('customerId')} />
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-[0.8125rem]">
            <span className="text-[var(--color-text-muted)]">Cliente: </span>
            <span className="font-medium">{appointment!.customerName}</span>
          </div>
        )}

        <SelectField
          label="Pet"
          name="petId"
          defaultValue={appointment?.petId}
          disabled={!customerId || petsQuery.isLoading}
          required
          error={apiError?.fieldError('petId')}
          options={[
            { value: '', label: petsQuery.isLoading ? 'Carregando...' : 'Selecione o pet' },
            ...(petsQuery.data?.data.map((pet) => ({ value: pet.id, label: pet.name })) ?? []),
          ]}
        />

        <SelectField
          label="Servico"
          name="serviceId"
          defaultValue={appointment?.serviceId}
          required
          error={apiError?.fieldError('serviceId')}
          hint={selectedService ? `${selectedService.durationMinutes} min · ${formatMoney(selectedService.price)}` : undefined}
          options={[
            { value: '', label: 'Selecione o servico' },
            ...(servicesQuery.data?.data.map((service) => ({
              value: service.id,
              label: `${service.name} (${service.durationMinutes} min · ${formatMoney(service.price)})`,
            })) ?? []),
          ]}
        />

        <SelectField
          label="Profissional (opcional)"
          name="professionalId"
          defaultValue={appointment?.professionalId ?? ''}
          options={[
            { value: '', label: 'Sem profissional especifico' },
            ...(teamQuery.data?.data.map((user) => ({ value: user.id, label: user.name })) ?? []),
          ]}
        />

        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Data"
            name="date"
            type="date"
            defaultValue={appointment ? toLocalDateInput(appointment.startsAt) : (defaultDate ?? '')}
            required
            error={apiError?.fieldError('startsAt')}
          />
          <TextField
            label="Hora"
            name="time"
            type="time"
            defaultValue={appointment ? toLocalTimeInput(appointment.startsAt) : '09:00'}
            required
          />
        </div>

        <TextAreaField label="Observacoes" name="notes" defaultValue={appointment?.notes ?? ''} />

        {conflictNotice ? (
          <p role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/25 bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-danger)]">
            {conflictNotice}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!isEditing && !customerId}>
            {isEditing ? 'Salvar alteracoes' : 'Criar agendamento'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
