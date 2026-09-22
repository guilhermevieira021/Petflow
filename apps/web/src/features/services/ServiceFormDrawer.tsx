import type { ServiceDto } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';

export function ServiceFormDrawer({
  open,
  service,
  onClose,
}: {
  open: boolean;
  service?: ServiceDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(service);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<ServiceDto>(`/services/${service!.id}`, payload)
        : api.post<ServiceDto>('/services', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(isEditing ? 'Servico atualizado.' : 'Servico cadastrado.');
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
    mutation.mutate({
      name: String(data.get('name') ?? ''),
      description: String(data.get('description') ?? '') || null,
      durationMinutes: Number(data.get('durationMinutes') ?? 60),
      price: Number(data.get('price') ?? 0),
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer open={open} onClose={onClose} title={isEditing ? 'Editar servico' : 'Novo servico'}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Nome"
          name="name"
          defaultValue={service?.name}
          placeholder="Banho e Tosa"
          required
          autoFocus
          error={apiError?.fieldError('name')}
        />
        <TextAreaField label="Descricao" name="description" defaultValue={service?.description ?? ''} error={apiError?.fieldError('description')} />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Duracao (min)"
            name="durationMinutes"
            type="number"
            min={5}
            max={600}
            defaultValue={service?.durationMinutes ?? 60}
            required
            error={apiError?.fieldError('durationMinutes')}
          />
          <TextField
            label="Preco (R$)"
            name="price"
            type="number"
            min={0}
            step="0.01"
            defaultValue={service?.price ?? 0}
            required
            error={apiError?.fieldError('price')}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? 'Salvar alteracoes' : 'Cadastrar servico'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
