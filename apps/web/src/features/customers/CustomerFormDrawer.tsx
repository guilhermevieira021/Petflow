import type { CustomerDto } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { Drawer } from '@/components/ui/Drawer';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';

export function CustomerFormDrawer({
  open,
  customer,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Presente = edicao; ausente = criacao. */
  customer?: CustomerDto;
  onClose: () => void;
  onCreated?: (customer: CustomerDto) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEditing = Boolean(customer);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<CustomerDto>(`/customers/${customer!.id}`, payload)
        : api.post<CustomerDto>('/customers', payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(isEditing ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onCreated?.(result);
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
    const email = String(data.get('email') ?? '').trim();
    mutation.mutate({
      name: String(data.get('name') ?? ''),
      phone: String(data.get('phone') ?? ''),
      whatsapp: String(data.get('whatsapp') ?? '') || undefined,
      email: email || null,
      notes: String(data.get('notes') ?? '') || null,
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? 'Editar cliente' : 'Novo cliente'}
      description={isEditing ? undefined : 'Nome e telefone bastam para comecar.'}
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Nome"
          name="name"
          defaultValue={customer?.name}
          required
          autoFocus
          error={apiError?.fieldError('name')}
        />
        <TextField
          label="Telefone"
          name="phone"
          type="tel"
          placeholder="(11) 98888-7777"
          defaultValue={customer?.phone}
          required
          error={apiError?.fieldError('phone')}
        />
        <TextField
          label="WhatsApp"
          name="whatsapp"
          type="tel"
          placeholder="Se diferente do telefone"
          defaultValue={customer?.whatsapp ?? ''}
          error={apiError?.fieldError('whatsapp')}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          defaultValue={customer?.email ?? ''}
          error={apiError?.fieldError('email')}
        />
        <TextAreaField
          label="Observacoes"
          name="notes"
          defaultValue={customer?.notes ?? ''}
          error={apiError?.fieldError('notes')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? 'Salvar alteracoes' : 'Cadastrar cliente'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
