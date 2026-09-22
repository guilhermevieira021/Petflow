import { MESSAGE_STATUS_LABELS, MESSAGE_TYPE_LABELS, type MessageDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATUS_TONES: Record<MessageDto['status'], BadgeTone> = {
  DRAFT: 'neutral',
  QUEUED: 'info',
  SENT: 'brand',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'danger',
  OPENED_EXTERNALLY: 'success',
};

export function MessagesPage() {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['messages', 'list', page],
    queryFn: () => api.get<Paginated<MessageDto>>('/messages', { page, pageSize: 20 }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Mensagens"
        description="Historico de mensagens preparadas e enviadas pelo WhatsApp."
      />

      <Card>
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando mensagens</span>
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          </div>
        ) : null}

        {query.isError ? (
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {query.data && query.data.data.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="Nenhuma mensagem ainda"
            description="Mensagens enviadas pela recuperacao de clientes ou pelos perfis de cliente aparecem aqui."
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {query.data.data.map((message) => (
                <li key={message.id} className="flex flex-col gap-1.5 px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{message.customerName}</p>
                    {message.petName ? (
                      <span className="text-[0.8125rem] text-[var(--color-text-muted)]">para {message.petName}</span>
                    ) : null}
                    <Badge tone="neutral">{MESSAGE_TYPE_LABELS[message.type]}</Badge>
                    <Badge tone={STATUS_TONES[message.status]}>{MESSAGE_STATUS_LABELS[message.status]}</Badge>
                    <span className="ml-auto text-[0.75rem] text-[var(--color-text-subtle)]">
                      {formatDateTime(message.createdAt)}
                    </span>
                  </div>
                  <p className="text-[0.8125rem] text-[var(--color-text-muted)]">{message.content}</p>
                </li>
              ))}
            </ul>
            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
