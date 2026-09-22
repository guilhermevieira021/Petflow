import { LIMIT_KEY_LABELS, Permission, type Paginated, type ServiceDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Scissors } from 'lucide-react';
import { useState } from 'react';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { ServiceFormDrawer } from './ServiceFormDrawer';

export function ServicesPage() {
  const { can, session } = useSession();
  const canWrite = can(Permission.SERVICES_WRITE);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [drawerService, setDrawerService] = useState<ServiceDto | null | undefined>(undefined);

  const query = useQuery({
    queryKey: ['services', 'list'],
    queryFn: () => api.get<Paginated<ServiceDto>>('/services', { pageSize: 100 }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<ServiceDto>(`/services/${id}`, { active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Servico atualizado.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel atualizar.');
    },
  });

  const usage = session?.billing.usage.services;

  return (
    <>
      <PageHeader
        title="Servicos"
        description="O que voce oferece, quanto dura e quanto custa."
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setDrawerService(null)}>
              Novo servico
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.services} entry={usage} /> : null}

      <Card>
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando servicos</span>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
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
            icon={<Scissors className="size-5" />}
            title="Nenhum servico cadastrado"
            description="Cadastre os servicos que o seu pet shop oferece."
            action={
              canWrite ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setDrawerService(null)}>
                  Cadastrar servico
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {query.data.data.map((service) => (
              <li key={service.id} className="flex items-center gap-3 px-5 py-3.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: service.color ?? 'var(--color-border-strong)' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{service.name}</p>
                  <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                    {service.durationMinutes} min &middot; {formatMoney(service.price)}
                  </p>
                </div>
                <Badge tone={service.active ? 'success' : 'neutral'}>
                  {service.active ? 'Ativo' : 'Inativo'}
                </Badge>
                {canWrite ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setDrawerService(service)}
                      aria-label={`Editar ${service.name}`}
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ id: service.id, active: !service.active })}
                      className="rounded-[var(--radius-md)] px-2 py-1 text-[0.75rem] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                    >
                      {service.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <ServiceFormDrawer
        open={drawerService !== undefined}
        service={drawerService ?? undefined}
        onClose={() => setDrawerService(undefined)}
      />
    </>
  );
}
