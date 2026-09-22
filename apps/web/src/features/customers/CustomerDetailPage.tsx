import type { CustomerWithSummaryDto, PetWithCustomerDto, Paginated } from '@petflow/contracts';
import { Permission } from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  Dog,
  MessageCircle,
  PawPrint,
  Pencil,
  Power,
  Receipt,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Avatar,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { PetFormDrawer } from '@/features/pets/PetFormDrawer';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatMoney, formatPhone, whatsappLink } from '@/lib/format';
import { CustomerFormDrawer } from './CustomerFormDrawer';

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5">
      <p className="text-[0.75rem] text-[var(--color-text-muted)]">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useSession();

  const [editOpen, setEditOpen] = useState(false);
  const [petDrawerOpen, setPetDrawerOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canWrite = can(Permission.CUSTOMERS_WRITE);
  const canDelete = can(Permission.CUSTOMERS_DELETE);

  const customerQuery = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => api.get<CustomerWithSummaryDto>(`/customers/${id}`),
    enabled: Boolean(id),
  });

  const petsQuery = useQuery({
    queryKey: ['pets', 'byCustomer', id],
    queryFn: () => api.get<Paginated<PetWithCustomerDto>>('/pets', { customerId: id, pageSize: 50 }),
    enabled: Boolean(id),
  });

  async function handleDeactivate(): Promise<void> {
    if (!id) return;
    setDeactivating(true);
    try {
      await api.patch(`/customers/${id}`, { active: false });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Cliente desativado.');
      setConfirmDeactivate(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel desativar.');
    } finally {
      setDeactivating(false);
    }
  }

  if (customerQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (customerQuery.isError || !customerQuery.data) {
    return (
      <Card>
        <ErrorState
          message={
            customerQuery.error instanceof ApiError
              ? customerQuery.error.message
              : 'Nao foi possivel carregar este cliente.'
          }
          onRetry={() => void customerQuery.refetch()}
        />
      </Card>
    );
  }

  const customer = customerQuery.data;
  const link = whatsappLink(customer.whatsapp ?? customer.phone);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={formatPhone(customer.whatsapp ?? customer.phone)}
        action={
          <div className="flex gap-2">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer noopener">
                <Button variant="secondary" icon={<MessageCircle className="size-4" />}>
                  WhatsApp
                </Button>
              </a>
            ) : null}
            <Link to={`/agenda?customerId=${customer.id}`}>
              <Button icon={<CalendarPlus className="size-4" />}>Agendar</Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Resumo"
              action={
                canWrite ? (
                  <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                    Editar
                  </Button>
                ) : null
              }
            />
            <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Pets" value={String(customer.petsCount)} />
              <StatTile label="Atendimentos" value={String(customer.appointmentsCount)} />
              <StatTile label="Total gasto" value={formatMoney(customer.totalSpent)} />
              <StatTile label="Status" value={customer.active ? 'Ativo' : 'Inativo'} />
            </CardBody>
            <CardBody className="grid gap-3 border-t border-[var(--color-border)] sm:grid-cols-2">
              <div>
                <p className="text-[0.75rem] text-[var(--color-text-muted)]">Ultimo atendimento</p>
                <p className="text-sm font-medium">{formatDate(customer.lastVisitAt)}</p>
              </div>
              <div>
                <p className="text-[0.75rem] text-[var(--color-text-muted)]">Proximo atendimento</p>
                <p className="text-sm font-medium">{formatDate(customer.nextAppointmentAt)}</p>
              </div>
              {customer.email ? (
                <div>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)]">Email</p>
                  <p className="text-sm font-medium">{customer.email}</p>
                </div>
              ) : null}
              {customer.notes ? (
                <div className="sm:col-span-2">
                  <p className="text-[0.75rem] text-[var(--color-text-muted)]">Observacoes</p>
                  <p className="text-sm">{customer.notes}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Pets"
              action={
                canWrite ? (
                  <Button variant="ghost" size="sm" icon={<PawPrint className="size-4" />} onClick={() => setPetDrawerOpen(true)}>
                    Adicionar pet
                  </Button>
                ) : null
              }
            />
            {petsQuery.data && petsQuery.data.data.length === 0 ? (
              <EmptyState
                icon={<Dog className="size-5" />}
                title="Nenhum pet cadastrado"
                description="Adicione o primeiro pet deste cliente."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setPetDrawerOpen(true)}>
                      Adicionar pet
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {petsQuery.data && petsQuery.data.data.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {petsQuery.data.data.map((pet) => (
                  <li key={pet.id}>
                    <Link
                      to={`/pets/${pet.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-hover)]"
                    >
                      <Avatar name={pet.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{pet.name}</p>
                        <p className="truncate text-[0.75rem] text-[var(--color-text-muted)]">
                          {pet.breed ?? 'Sem raca informada'}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Acoes" />
            <CardBody className="flex flex-col gap-2">
              <Link to={`/agenda?customerId=${customer.id}`}>
                <Button variant="secondary" className="w-full justify-start" icon={<Receipt className="size-4" />}>
                  Ver agendamentos
                </Button>
              </Link>
              {canDelete && customer.active ? (
                <Button
                  variant="danger"
                  className="w-full justify-start"
                  icon={<Power className="size-4" />}
                  onClick={() => setConfirmDeactivate(true)}
                >
                  Desativar cliente
                </Button>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <CustomerFormDrawer open={editOpen} customer={customer} onClose={() => setEditOpen(false)} />

      <PetFormDrawer
        open={petDrawerOpen}
        customerId={customer.id}
        onClose={() => setPetDrawerOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeactivate}
        title="Desativar cliente?"
        description="O cliente deixa de aparecer nas listas ativas. Os agendamentos ja existentes nao sao afetados."
        confirmLabel="Desativar"
        destructive
        loading={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
