import { LIMIT_KEY_LABELS, PET_SPECIES_LABELS, Permission, type PetWithCustomerDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dog, PawPrint, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
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
      api.get<Paginated<PetWithCustomerDto>>('/pets', { search: search || undefined, page, pageSize: 20 }),
    placeholderData: (previous) => previous,
  });

  const usage = session?.billing.usage.pets;

  return (
    <>
      <PageHeader
        title="Pets"
        description="Cada pet com a sua ficha e o seu historico de atendimentos."
        action={
          canWrite ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo pet
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.pets} entry={usage} /> : null}

      <Card>
        <div className="border-b border-[var(--color-border)] p-4">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome do pet ou do tutor"
              aria-label="Buscar pets"
              className="h-9.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] pr-3 pl-9 text-sm"
            />
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando pets</span>
            {Array.from({ length: 5 }, (_, index) => (
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
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {query.data.data.map((pet) => (
                <li key={pet.id}>
                  <Link
                    to={`/pets/${pet.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--color-surface-hover)]"
                  >
                    <Avatar name={pet.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{pet.name}</p>
                      <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                        {PET_SPECIES_LABELS[pet.species]}
                        {pet.breed ? ` · ${pet.breed}` : ''} &middot; Tutor: {pet.customerName}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right text-[0.75rem] text-[var(--color-text-subtle)] sm:block">
                      <PawPrint aria-hidden className="mb-0.5 ml-auto size-3.5" />
                      {formatDate(pet.lastVisitAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <PetFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
