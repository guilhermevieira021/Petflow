import type { MessageDto, MessageType } from '@petflow/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { whatsappLink } from '@/lib/format';

/**
 * Composer de mensagem manual.
 *
 * Enquanto WHATSAPP_PROVIDER=link (o unico modo disponivel hoje no backend),
 * "enviar" significa: abrir o WhatsApp com o texto pronto para a PESSOA
 * confirmar o envio, e registrar aqui que isso aconteceu. Nada e enviado pelo
 * sistema sozinho -- ver apps/api/src/modules/messages.
 */
export function MessageComposerDrawer({
  open,
  customerId,
  customerName,
  customerWhatsapp,
  petId,
  type,
  suggestedText,
  onClose,
}: {
  open: boolean;
  customerId: string;
  customerName: string;
  customerWhatsapp: string | null;
  petId?: string | null;
  type: MessageType;
  suggestedText: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (content: string) =>
      api.post<MessageDto>('/messages', { customerId, petId: petId ?? null, type, content }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast.success('Mensagem registrada.');
      onClose();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel registrar a mensagem.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const content = String(data.get('content') ?? '');
    const link = whatsappLink(customerWhatsapp, content);

    if (link) {
      window.open(link, '_blank', 'noopener,noreferrer');
    }
    mutation.mutate(content);
  }

  return (
    <Drawer open={open} onClose={onClose} title={`Mensagem para ${customerName}`} description="Revise o texto antes de enviar pelo WhatsApp.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextAreaField label="Mensagem" name="content" defaultValue={suggestedText} rows={5} required />

        {!customerWhatsapp ? (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/25 bg-[var(--color-warning-subtle)] px-3.5 py-2.5 text-[0.8125rem] text-[var(--color-warning)]">
            Este cliente nao tem WhatsApp cadastrado. A mensagem sera registrada, mas nenhum link sera aberto.
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Abrir WhatsApp e registrar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
