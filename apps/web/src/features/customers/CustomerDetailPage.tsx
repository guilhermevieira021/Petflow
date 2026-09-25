import type { AppointmentDetailDto, CustomerWithSummaryDto, PetWithCustomerDto, Paginated } from '@petflow/contracts';
import { APPOINTMENT_STATUS_LABELS, PET_SPECIES_LABELS, Permission } from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Dog,
  Mail,
  MessageCircle,
  PawPrint,
  Pencil,
  Phone,
  Power,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InfoItem,
  Skeleton,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { APPOINTMENT_STATUS_TONES } from '@/features/appointments/status';
import { PetFormDrawer } from '@/features/pets/PetFormDrawer';
import { ApiError, api } from '@/lib/api';
import { formatCalendarDate, formatDate, formatDateTime, formatMoney, formatPhone, formatRelative, whatsappLink } from '@/lib/format';
import { CustomerFormDrawer } from './CustomerFormDrawer';

/** Historico de atendimentos do cliente -- filtro `customerId` da propria API. */
function CustomerHistory({ customerId, timeZone }: { customerId: string; timeZone: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['appointments', 'byCustomer', customerId, page],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        customerId,
        page,
        pageSize: 8,
        sort: 'startsAt',
        order: 'desc',
      }),
    placeholderData: (previous) => previous,
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Histórico de atendimentos" icon={<CalendarDays className="size-4" />} />
      {query.isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy="true">
          <span className="sr-only">Carregando histórico</span>
          {Array.from({ length: 3 }, (_, index) => (
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
        <EmptyState compact icon={<CalendarDays className="size-5" />} title="Nenhum atendimento registrado" />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <>
          <ol className="divide-y divide-[var(--color-border)]">
            {query.data.data.map((appointment) => (
              <li key={appointment.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {appointment.serviceName}
                    <span className="font-normal text-[var(--color-text-muted)]"> · {appointment.petName}</span>
                  </p>
                  <p className="tabular mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">
                    {formatDateTime(appointment.startsAt, timeZone)} · {formatMoney(appointment.price)}
                  </p>
                </div>
                <Badge dot tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                  {APPOINTMENT_STATUS_LABELS[appointment.status]}
                </Badge>
              </li>
            ))}
          </ol>
          <Pagination pagination={query.data.pagination} onPageChange={setPage} />
        </>
      ) : null}
    </Card>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can, session } = useSession();
  const timeZone = session?.tenant.timezone;

  const [editOpen, setEditOpen] = useState(false);
  const [petDrawerOpen, setPetDrawerOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canWrite = can(Permission.CUSTOMERS_WRITE);
  const canDelete = can(Permission.CUSTOMERS_DELETE);
  const canSeeAppointments = can(Permission.APPOINTMENTS_READ);
  const canSchedule = can(Permission.APPOINTMENTS_WRITE);

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
        <span className="sr-only">Carregando cliente</span>
        <Skeleton className="h-44 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
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
  const phone = customer.whatsapp ?? customer.phone;
  const link = whatsappLink(phone);

  const stats = [
    { label: 'Pets', value: String(customer.petsCount) },
    { label: 'Atendimentos', value: String(customer.appointmentsCount) },
    { label: 'Total gasto', value: formatMoney(customer.totalSpent) },
    { label: 'Última visita', value: customer.lastVisitAt ? formatRelative(customer.lastVisitAt) : '--' },
  ];

  return (
    <>
      <Link
        to="/clientes"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft aria-hidden className="size-4" /> Clientes
      </Link>

      {/* Cabecalho de perfil */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={customer.name} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{customer.name}</h1>
                <Badge dot tone={customer.active ? 'success' : 'neutral'}>
                  {customer.active ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <Phone aria-hidden className="size-3.5" /> {formatPhone(phone)}
                </span>
                {customer.email ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Mail aria-hidden className="size-3.5 shrink-0" /> <span className="truncate">{customer.email}</span>
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer noopener" className={buttonClasses('secondary', 'md')}>
                <MessageCircle aria-hidden className="size-4 text-[var(--color-success)]" /> WhatsApp
              </a>
            ) : null}
            {canSchedule ? (
              <Link to={`/agenda?customerId=${customer.id}`} className={buttonClasses('primary', 'md')}>
                <CalendarPlus aria-hidden className="size-4" /> Agendar
              </Link>
            ) : null}
            {canWrite ? (
              <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)} className="col-span-2 sm:col-span-1">
                Editar
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 sm:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={
                index % 2 === 1
                  ? 'border-l border-[var(--color-border)] px-5 py-3.5'
                  : index > 0
                    ? 'border-t border-[var(--color-border)] px-5 py-3.5 sm:border-t-0 sm:border-l'
                    : 'px-5 py-3.5'
              }
            >
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{stat.label}</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold tracking-tight">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Pets */}
          <Card>
            <CardHeader
              title="Pets"
              icon={<PawPrint className="size-4" />}
              action={
                canWrite ? (
                  <Button variant="secondary" size="sm" icon={<PawPrint className="size-4" />} onClick={() => setPetDrawerOpen(true)}>
                    Adicionar
                  </Button>
                ) : null
              }
            />
            {petsQuery.isLoading ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2" aria-busy="true">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : null}
            {petsQuery.data && petsQuery.data.data.length === 0 ? (
              <EmptyState
                compact
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
              <ul className="grid gap-2.5 p-4 sm:grid-cols-2">
                {petsQuery.data.data.map((pet) => (
                  <li key={pet.id}>
                    <Link
                      to={`/pets/${pet.id}`}
                      className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 transition-colors hover:border-[var(--color-brand-border)] hover:bg-[var(--color-brand-subtle)]"
                    >
                      <Avatar name={pet.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{pet.name}</p>
                        <p className="truncate text-[0.75rem] text-[var(--color-text-muted)]">
                          {PET_SPECIES_LABELS[pet.species]}
                          {pet.breed ? ` · ${pet.breed}` : ''}
                        </p>
                      </div>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {canSeeAppointments ? <CustomerHistory customerId={customer.id} timeZone={timeZone ?? 'America/Sao_Paulo'} /> : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Dados do cliente" />
            <dl className="grid grid-cols-2 gap-4 p-5">
              <InfoItem label="WhatsApp" value={customer.whatsapp ? formatPhone(customer.whatsapp) : 'Não informado'} muted={!customer.whatsapp} />
              <InfoItem label="Telefone" value={formatPhone(customer.phone)} />
              <InfoItem label="E-mail" value={customer.email ?? 'Não informado'} muted={!customer.email} className="col-span-2" />
              <InfoItem label="Nascimento" value={customer.birthDate ? formatCalendarDate(customer.birthDate) : 'Não informado'} muted={!customer.birthDate} />
              <InfoItem label="Cliente desde" value={formatDate(customer.createdAt)} />
              <InfoItem label="Próximo atendimento" value={formatDate(customer.nextAppointmentAt)} className="col-span-2" />
              {customer.notes ? (
                <InfoItem label="Observações" value={<span className="whitespace-pre-line">{customer.notes}</span>} className="col-span-2" />
              ) : null}
            </dl>
          </Card>

          {canDelete && customer.active ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Desativar cliente</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                Sai das listas ativas. O histórico e os agendamentos existentes são mantidos.
              </p>
              <Button
                variant="secondary"
                className="mt-4 w-full text-[var(--color-danger)]"
                icon={<Power className="size-4" />}
                onClick={() => setConfirmDeactivate(true)}
              >
                Desativar cliente
              </Button>
            </Card>
          ) : null}
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
        description="O cliente deixa de aparecer nas listas ativas. Os agendamentos já existentes não são afetados."
        confirmLabel="Desativar"
        destructive
        loading={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
