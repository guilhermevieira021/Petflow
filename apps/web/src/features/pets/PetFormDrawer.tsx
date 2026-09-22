import { PET_SEX_LABELS, PET_SPECIES_LABELS, type PetDto } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { CustomerPicker } from './CustomerPicker';

const SPECIES_OPTIONS = Object.entries(PET_SPECIES_LABELS).map(([value, label]) => ({ value, label }));
const SEX_OPTIONS = Object.entries(PET_SEX_LABELS).map(([value, label]) => ({ value, label }));

export function PetFormDrawer({
  open,
  pet,
  customerId,
  onClose,
}: {
  open: boolean;
  /** Presente = edicao. */
  pet?: PetDto;
  /** Cliente pre-selecionado (ex.: aberto a partir do perfil do cliente). */
  customerId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(pet);
  const [selectedCustomerId, setSelectedCustomerId] = useState(customerId ?? '');

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<PetDto>(`/pets/${pet!.id}`, payload)
        : api.post<PetDto>('/pets', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pets'] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(isEditing ? 'Pet atualizado.' : 'Pet cadastrado.');
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const weight = String(data.get('weightKg') ?? '').trim();
    const birthDate = String(data.get('birthDate') ?? '').trim();

    const payload: Record<string, unknown> = {
      name: String(data.get('name') ?? ''),
      species: String(data.get('species') ?? 'DOG'),
      sex: String(data.get('sex') ?? 'UNKNOWN'),
      breed: String(data.get('breed') ?? '') || null,
      color: String(data.get('color') ?? '') || null,
      weightKg: weight ? Number(weight) : null,
      birthDate: birthDate || null,
      notes: String(data.get('notes') ?? '') || null,
    };
    if (!isEditing) payload.customerId = selectedCustomerId;

    mutation.mutate(payload);
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer open={open} onClose={onClose} title={isEditing ? 'Editar pet' : 'Novo pet'}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {!isEditing && !customerId ? (
          <CustomerPicker
            value={selectedCustomerId}
            onChange={setSelectedCustomerId}
            error={apiError?.fieldError('customerId')}
          />
        ) : null}

        <TextField label="Nome" name="name" defaultValue={pet?.name} required autoFocus error={apiError?.fieldError('name')} />

        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Especie" name="species" defaultValue={pet?.species ?? 'DOG'} options={SPECIES_OPTIONS} error={apiError?.fieldError('species')} />
          <SelectField label="Sexo" name="sex" defaultValue={pet?.sex ?? 'UNKNOWN'} options={SEX_OPTIONS} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField label="Raca" name="breed" defaultValue={pet?.breed ?? ''} />
          <TextField label="Cor" name="color" defaultValue={pet?.color ?? ''} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField label="Peso (kg)" name="weightKg" type="number" min={0} step="0.1" defaultValue={pet?.weightKg ?? ''} />
          <TextField label="Nascimento" name="birthDate" type="date" defaultValue={pet?.birthDate ?? ''} />
        </div>

        <TextAreaField label="Observacoes" name="notes" defaultValue={pet?.notes ?? ''} />

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!isEditing && !selectedCustomerId}>
            {isEditing ? 'Salvar alteracoes' : 'Cadastrar pet'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
