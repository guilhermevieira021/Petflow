import { LIMIT_KEY_LABELS, PET_SPECIES_LABELS, Permission, type PetWithCustomerDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dog, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/SearchInput';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatAge, formatRelative } from '@/lib/format';
import { PetAvatar } from './PetAvatar';
import { PetFormDrawer } from './PetFormDrawer';

export function PetsListPage() {
  const { can, session } = useSession();
  const canWrite = can(Permission.PETS_WRITE);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ['pets', 'list', { search, page }],
    queryFn: () =>
      api.get<Paginated<PetWithCustomerDto>>('/pets', { search: search || undefined, page, pageSize: 24 }),
    placeholderData: (previous) => previous,
  });

  const usage = session?.billing.usage.pets;
  const total = query.data?.pagination.total;

  return (
    <>
      <PageHeader
        title="Pets"
        description={
          total !== undefined
            ? `${total} ${total === 1 ? 'pet cadastrado' : 'pets cadastrados'}, cada um com a sua ficha.`
            : 'Cada pet com a sua ficha e o seu histórico.'
        }
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo pet
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.pets} entry={usage} /> : null}

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Buscar pelo nome do pet ou do tutor"
        label="Buscar pets"
        className="mb-4"
      />

      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <span className="sr-only">Carregando pets</span>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <Card>
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : null}

      {query.data && query.data.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Dog className="size-5" />}
            title={search ? 'Nenhum pet encontrado' : 'Nenhum pet cadastrado'}
            description={search ? 'Tente outro termo de busca.' : 'Adicione o primeiro pet de um cliente.'}
            action={
              !search && canWrite ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
                  Adicionar pet
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      {query.data && query.data.data.length > 0 ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {query.data.data.map((pet) => {
              const age = formatAge(pet.birthDate);
              return (
                <li key={pet.id}>
                  <Link
                    to={`/pets/${pet.id}`}
                    className="flex h-full items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] hover:border-[var(--color-brand-border)] hover:shadow-[var(--shadow-sm)]"
                  >
                    <PetAvatar species={pet.species} name={pet.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-semibold">{pet.name}</p>
                      <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                        {PET_SPECIES_LABELS[pet.species]}
                        {pet.breed ? ` · ${pet.breed}` : ''}
                        {age ? ` · ${age}` : ''}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 truncate text-[0.75rem] text-[var(--color-text-subtle)]">
                        <UserRound aria-hidden className="size-3.5 shrink-0" />
                        <span className="truncate">{pet.customerName}</span>
                        {pet.lastVisitAt ? <span className="shrink-0">· {formatRelative(pet.lastVisitAt)}</span> : null}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {query.data.pagination.totalPages > 1 ? (
            <Card className="mt-4">
              <Pagination pagination={query.data.pagination} onPageChange={setPage} />
            </Card>
          ) : null}
        </>
      ) : null}

      <PetFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
