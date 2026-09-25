import { LIMIT_KEY_LABELS, Permission, type CustomerWithSummaryDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageCircle, PawPrint, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { FilterChip, SearchInput } from '@/components/ui/SearchInput';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatMoney, formatPhone, formatRelative, whatsappLink } from '@/lib/format';
import { CustomerFormDrawer } from './CustomerFormDrawer';

type ActiveFilter = 'all' | 'true' | 'false';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'true', label: 'Ativos' },
  { value: 'false', label: 'Inativos' },
];

function WhatsAppButton({ phone, name }: { phone: string | null; name: string }) {
  const link = whatsappLink(phone);
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`WhatsApp de ${name}`}
      onClick={(event) => event.stopPropagation()}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-success)] hover:bg-[var(--color-success-subtle)] hover:text-[var(--color-success)]"
    >
      <MessageCircle aria-hidden className="size-4" />
    </a>
  );
}

export function CustomersListPage() {
  const { can, session } = useSession();
  const navigate = useNavigate();
  const canWrite = can(Permission.CUSTOMERS_WRITE);

  const [search, setSearch] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ['customers', 'list', { search, page, active }],
    queryFn: () =>
      api.get<Paginated<CustomerWithSummaryDto>>('/customers', {
        search: search || undefined,
        active: active === 'all' ? undefined : active,
        page,
        pageSize: 20,
      }),
    placeholderData: (previous) => previous,
  });

  const usage = session?.billing.usage.customers;
  const total = query.data?.pagination.total;

  return (
    <>
      <PageHeader
        title="Clientes"
        description={
          total !== undefined
            ? `${total} ${total === 1 ? 'tutor na sua base' : 'tutores na sua base'}, com o histórico de cada um.`
            : 'Sua base de tutores e o histórico de atendimentos.'
        }
        action={
          canWrite ? (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo cliente
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.customers} entry={usage} /> : null}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por nome, telefone ou e-mail"
          label="Buscar clientes"
          className="flex-1"
        />
        <div className="flex gap-2" role="group" aria-label="Filtrar clientes por status">
          {FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={active === filter.value}
              onClick={() => {
                setActive(filter.value);
                setPage(1);
              }}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando clientes</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
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
            icon={<Users className="size-5" />}
            title={search || active !== 'all' ? 'Nenhum cliente encontrado' : 'Você ainda não cadastrou clientes'}
            description={
              search || active !== 'all' ? 'Tente outro termo ou filtro.' : 'Cadastre o primeiro cliente para começar.'
            }
            action={
              !search && active === 'all' && canWrite ? (
                <Button icon={<UserPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
                  Cadastrar cliente
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            {/* Desktop: tabela. Mobile: cartoes -- a mesma informacao, layout adequado ao toque. */}
            <div className="hidden md:block">
              <table className="w-full text-[0.8125rem]">
                <caption className="sr-only">Lista de clientes</caption>
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-left text-[var(--color-text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Cliente</th>
                    <th scope="col" className="px-4 py-3 font-medium">Pets</th>
                    <th scope="col" className="px-4 py-3 font-medium">Último atendimento</th>
                    <th scope="col" className="px-4 py-3 font-medium">Próximo</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total gasto</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">WhatsApp</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {query.data.data.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() => navigate(`/clientes/${customer.id}`)}
                      className="cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={customer.name} size="sm" />
                          <div className="min-w-0">
                            <Link
                              to={`/clientes/${customer.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="block truncate text-sm font-semibold hover:underline"
                            >
                              {customer.name}
                            </Link>
                            <span className="block truncate text-[0.75rem] text-[var(--color-text-muted)]">
                              {formatPhone(customer.whatsapp ?? customer.phone)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="tabular px-4 py-3">{customer.petsCount}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {customer.lastVisitAt ? formatRelative(customer.lastVisitAt) : '--'}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{formatDate(customer.nextAppointmentAt)}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(customer.totalSpent)}</td>
                      <td className="px-4 py-3">
                        <Badge dot tone={customer.active ? 'success' : 'neutral'}>
                          {customer.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <WhatsAppButton phone={customer.whatsapp ?? customer.phone} name={customer.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-[var(--color-border)] md:hidden">
              {query.data.data.map((customer) => (
                <li key={customer.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Link to={`/clientes/${customer.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={customer.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-[0.9375rem] font-semibold">{customer.name}</span>
                        {!customer.active ? <Badge>Inativo</Badge> : null}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                        <PawPrint aria-hidden className="size-3.5 shrink-0" />
                        <span className="tabular">{customer.petsCount}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">
                          {customer.lastVisitAt ? `Visita ${formatRelative(customer.lastVisitAt)}` : 'Sem visitas'}
                        </span>
                      </p>
                    </div>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                  </Link>
                  <WhatsAppButton phone={customer.whatsapp ?? customer.phone} name={customer.name} />
                </li>
              ))}
            </ul>

            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <CustomerFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
