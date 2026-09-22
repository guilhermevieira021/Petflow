import { RETENTION_WINDOW_OPTIONS, type Paginated, type RetentionEntryDto } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { MessageComposerDrawer } from '@/features/messages/MessageComposerDrawer';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';

export function RetentionPage() {
  const [days, setDays] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [composer, setComposer] = useState<RetentionEntryDto | null>(null);

  const query = useQuery({
    queryKey: ['retention', { days, page }],
    queryFn: () => api.get<Paginated<RetentionEntryDto>>('/retention', { days, page, pageSize: 20 }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Recuperacao de clientes"
        description="Quem ja foi atendido, nao tem agendamento marcado e pode estar pronto para voltar."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setDays(undefined);
            setPage(1);
          }}
          className={
            days === undefined
              ? 'rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[0.8125rem] font-medium text-white'
              : 'rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }
        >
          Padrao do pet shop
        </button>
        {RETENTION_WINDOW_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setDays(option);
              setPage(1);
            }}
            className={
              days === option
                ? 'rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[0.8125rem] font-medium text-white'
                : 'rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }
          >
            {option} dias
          </button>
        ))}
      </div>

      <Card>
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando lista de recuperacao</span>
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
            icon={<UserRoundCheck className="size-5" />}
            title="Nenhum cliente para recuperar por agora"
            description="Otimo sinal -- ninguem esta sumido dentro do periodo selecionado."
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {query.data.data.map((entry) => (
                <li key={entry.customerId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.customerName}</p>
                    <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                      {entry.petNames.join(', ') || 'Sem pets cadastrados'} &middot; ultimo atendimento em{' '}
                      {formatDate(entry.lastVisitAt)}
                    </p>
                  </div>
                  <span className="tabular shrink-0 rounded-[var(--radius-xs)] bg-[var(--color-warning-subtle)] px-2 py-0.5 text-[0.75rem] font-medium text-[var(--color-warning)]">
                    {entry.daysSinceLastVisit} dias sem vir
                  </span>
                  <button
                    type="button"
                    onClick={() => setComposer(entry)}
                    className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-success)] px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:opacity-90"
                  >
                    <MessageCircle aria-hidden className="size-3.5" />
                    Enviar mensagem
                  </button>
                </li>
              ))}
            </ul>
            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      {composer ? (
        <MessageComposerDrawer
          open={Boolean(composer)}
          customerId={composer.customerId}
          customerName={composer.customerName}
          customerWhatsapp={composer.customerWhatsapp}
          type="WINBACK"
          suggestedText={`Oi, ${composer.customerName.split(' ')[0]}! Tudo bem? ${
            composer.petNames[0] ?? 'Seu pet'
          } ja esta chegando na epoca do proximo atendimento. Quer que eu veja um horario?`}
          onClose={() => setComposer(null)}
        />
      ) : null}
    </>
  );
}
