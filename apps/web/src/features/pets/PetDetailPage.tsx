import { PET_SEX_LABELS, PET_SPECIES_LABELS, Permission, type PetWithCustomerDto } from '@petflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Power, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PetFormDrawer } from './PetFormDrawer';

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.75rem] text-[var(--color-text-muted)]">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export function PetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useSession();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canWrite = can(Permission.PETS_WRITE);
  const canDelete = can(Permission.PETS_DELETE);

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
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
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

  return (
    <>
      <PageHeader
        title={pet.name}
        description={`${PET_SPECIES_LABELS[pet.species]}${pet.breed ? ` · ${pet.breed}` : ''}`}
        action={
          <div className="flex gap-2">
            <Link to={`/clientes/${pet.customerId}`}>
              <Button variant="secondary" icon={<User className="size-4" />}>
                Ver tutor
              </Button>
            </Link>
            <Link to={`/agenda?customerId=${pet.customerId}&petId=${pet.id}`}>
              <Button icon={<CalendarPlus className="size-4" />}>Agendar</Button>
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Ficha do pet"
          action={
            canWrite ? (
              <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                Editar
              </Button>
            ) : null
          }
        />
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <InfoField label="Tutor" value={pet.customerName} />
          <InfoField label="Sexo" value={PET_SEX_LABELS[pet.sex]} />
          <InfoField label="Cor" value={pet.color ?? 'Nao informado'} />
          <InfoField label="Peso" value={pet.weightKg ? `${pet.weightKg} kg` : 'Nao informado'} />
          <InfoField label="Nascimento" value={formatDate(pet.birthDate)} />
          <InfoField label="Ultimo atendimento" value={formatDate(pet.lastVisitAt)} />
        </CardBody>
        {pet.notes ? (
          <CardBody className="border-t border-[var(--color-border)]">
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">Observacoes</p>
            <p className="mt-0.5 text-sm">{pet.notes}</p>
          </CardBody>
        ) : null}
        {canDelete && pet.active ? (
          <CardBody className="border-t border-[var(--color-border)]">
            <Button variant="danger" icon={<Power className="size-4" />} onClick={() => setConfirmDeactivate(true)}>
              Desativar pet
            </Button>
          </CardBody>
        ) : null}
      </Card>

      <PetFormDrawer open={editOpen} pet={pet} onClose={() => setEditOpen(false)} />

      <ConfirmDialog
        open={confirmDeactivate}
        title="Desativar pet?"
        description="O pet deixa de aparecer nas listas ativas. O historico de atendimentos e mantido."
        confirmLabel="Desativar"
        destructive
        loading={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
