import {
  APPOINTMENT_STATUS_LABELS,
  PET_SEX_LABELS,
  PET_SPECIES_LABELS,
  Permission,
  type AppointmentDetailDto,
  type Paginated,
  type PetWithCustomerDto,
} from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  HeartPulse,
  Pencil,
  Pill,
  Power,
  Repeat,
  Syringe,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { Badge, Card, CardHeader, EmptyState, ErrorState, InfoItem, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { APPOINTMENT_STATUS_TONES } from '@/features/appointments/status';
import { ApiError, api } from '@/lib/api';
import { formatAge, formatCalendarDate, formatDate, formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import { PetAvatar } from './PetAvatar';
import { PetFormDrawer } from './PetFormDrawer';

/** Historico de servicos do pet -- filtro `petId` da propria API. */
function PetHistory({ petId, timeZone }: { petId: string; timeZone: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['appointments', 'byPet', petId, page],
    queryFn: () =>
      api.get<Paginated<AppointmentDetailDto>>('/appointments', {
        petId,
        page,
        pageSize: 8,
        sort: 'startsAt',
        order: 'desc',
      }),
    placeholderData: (previous) => previous,
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Histórico de serviços" icon={<ClipboardList className="size-4" />} />
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
        <EmptyState compact icon={<CalendarDays className="size-5" />} title="Nenhum serviço registrado ainda" />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <>
          <ol className="relative px-5 py-2">
            {query.data.data.map((appointment, index, list) => (
              <li key={appointment.id} className="relative flex gap-3 py-3">
                {index < list.length - 1 ? (
                  <span aria-hidden className="absolute top-8 bottom-0 left-[5px] w-px bg-[var(--color-border)]" />
                ) : null}
                <span aria-hidden className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand)] ring-1 ring-[var(--color-brand-border)]" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{appointment.serviceName}</p>
                    <p className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
                      {formatDateTime(appointment.startsAt, timeZone)} · {formatMoney(appointment.price)}
                      {appointment.professionalName ? ` · ${appointment.professionalName}` : ''}
                    </p>
                  </div>
                  <Badge dot tone={APPOINTMENT_STATUS_TONES[appointment.status]} className="self-start sm:self-auto">
                    {APPOINTMENT_STATUS_LABELS[appointment.status]}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
          <Pagination pagination={query.data.pagination} onPageChange={setPage} />
        </>
      ) : null}
    </Card>
  );
}

/**
 * Espaco reservado para a ficha de saude. NADA disso existe no backend ainda
 * -- os cartoes deixam isso explicito ("Em breve") em vez de simular dados.
 */
const HEALTH_PLACEHOLDERS = [
  { icon: Syringe, title: 'Vacinas' },
  { icon: Pill, title: 'Vermífugos' },
  { icon: Repeat, title: 'Retornos' },
  { icon: HeartPulse, title: 'Histórico clínico' },
];

export function PetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can, session } = useSession();
  const timeZone = session?.tenant.timezone ?? 'America/Sao_Paulo';

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canWrite = can(Permission.PETS_WRITE);
  const canDelete = can(Permission.PETS_DELETE);
  const canSeeAppointments = can(Permission.APPOINTMENTS_READ);
  const canSchedule = can(Permission.APPOINTMENTS_WRITE);

  const petQuery = useQuery({
    queryKey: ['pets', 'detail', id],
    queryFn: () => api.get<PetWithCustomerDto>(`/pets/${id}`),
    enabled: Boolean(id),
  });

  async function handleDeactivate(): Promise<void> {
    if (!id) return;
    setDeactivating(true);
    try {
      await api.patch(`/pets/${id}`, { active: false });
      await queryClient.invalidateQueries({ queryKey: ['pets'] });
      toast.success('Pet desativado.');
      setConfirmDeactivate(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel desativar.');
    } finally {
      setDeactivating(false);
    }
  }

  if (petQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando pet</span>
        <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  if (petQuery.isError || !petQuery.data) {
    return (
      <Card>
        <ErrorState
          message={petQuery.error instanceof ApiError ? petQuery.error.message : 'Nao foi possivel carregar este pet.'}
          onRetry={() => void petQuery.refetch()}
        />
      </Card>
    );
  }

  const pet = petQuery.data;
  const age = formatAge(pet.birthDate);

  const facts = [
    { label: 'Idade', value: age ?? 'Não informada', muted: !age },
    { label: 'Peso', value: pet.weightKg ? `${pet.weightKg} kg` : 'Não informado', muted: !pet.weightKg },
    { label: 'Sexo', value: PET_SEX_LABELS[pet.sex], muted: pet.sex === 'UNKNOWN' },
    { label: 'Cor', value: pet.color ?? 'Não informada', muted: !pet.color },
  ];

  return (
    <>
      <Link
        to="/pets"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft aria-hidden className="size-4" /> Pets
      </Link>

      {/* Perfil */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <PetAvatar species={pet.species} name={pet.name} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{pet.name}</h1>
                {!pet.active ? <Badge>Inativo</Badge> : null}
              </div>
              <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                {PET_SPECIES_LABELS[pet.species]}
                {pet.breed ? ` · ${pet.breed}` : ''}
              </p>
              <Link
                to={`/clientes/${pet.customerId}`}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-[0.8125rem] font-medium hover:bg-[var(--color-border)]"
              >
                <UserRound aria-hidden className="size-3.5" /> Tutor: {pet.customerName}
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {canSchedule ? (
              <Link to={`/agenda?customerId=${pet.customerId}&petId=${pet.id}`} className={buttonClasses('primary', 'md')}>
                <CalendarPlus aria-hidden className="size-4" /> Agendar
              </Link>
            ) : null}
            {canWrite ? (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                Editar ficha
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 sm:grid-cols-4">
          {facts.map((fact, index) => (
            <div
              key={fact.label}
              className={
                index % 2 === 1
                  ? 'border-l border-[var(--color-border)] px-5 py-3.5'
                  : index > 0
                    ? 'border-t border-[var(--color-border)] px-5 py-3.5 sm:border-t-0 sm:border-l'
                    : 'px-5 py-3.5'
              }
            >
              <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{fact.label}</dt>
              <dd
                className={
                  fact.muted
                    ? 'mt-0.5 text-sm text-[var(--color-text-subtle)]'
                    : 'mt-0.5 text-lg font-semibold tracking-tight'
                }
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {canSeeAppointments ? <PetHistory petId={pet.id} timeZone={timeZone} /> : null}

          <Card>
            <CardHeader title="Saúde" description="Controle de vacinas, vermífugos e retornos." icon={<HeartPulse className="size-4" />} />
            <ul className="grid grid-cols-2 gap-2.5 p-4 lg:grid-cols-4">
              {HEALTH_PLACEHOLDERS.map((item) => (
                <li
                  key={item.title}
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] p-3.5"
                >
                  <item.icon aria-hidden className="size-4 text-[var(--color-text-subtle)]" />
                  <span className="text-[0.8125rem] font-medium">{item.title}</span>
                  <span className="text-[0.6875rem] font-medium tracking-wide text-[var(--color-text-subtle)] uppercase">
                    Em breve
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Ficha" />
            <dl className="grid grid-cols-2 gap-4 p-5">
              <InfoItem label="Nascimento" value={pet.birthDate ? formatCalendarDate(pet.birthDate) : 'Não informado'} muted={!pet.birthDate} />
              <InfoItem label="Último atendimento" value={pet.lastVisitAt ? formatRelative(pet.lastVisitAt) : '--'} />
              <InfoItem label="Cadastrado em" value={formatDate(pet.createdAt, timeZone)} className="col-span-2" />
              <InfoItem
                label="Observações"
                value={pet.notes ? <span className="whitespace-pre-line">{pet.notes}</span> : 'Nenhuma observação'}
                muted={!pet.notes}
                className="col-span-2"
              />
            </dl>
          </Card>

          {canDelete && pet.active ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Desativar pet</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                Sai das listas ativas. O histórico de atendimentos é mantido.
              </p>
              <Button
                variant="secondary"
                className="mt-4 w-full text-[var(--color-danger)]"
                icon={<Power className="size-4" />}
                onClick={() => setConfirmDeactivate(true)}
              >
                Desativar pet
              </Button>
            </Card>
          ) : null}
        </div>
      </div>

      <PetFormDrawer open={editOpen} pet={pet} onClose={() => setEditOpen(false)} />

      <ConfirmDialog
        open={confirmDeactivate}
        title="Desativar pet?"
        description="O pet deixa de aparecer nas listas ativas. O histórico de atendimentos é mantido."
        confirmLabel="Desativar"
        destructive
        loading={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
