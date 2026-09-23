import { LIMIT_KEY_LABELS, Permission, type CustomerWithSummaryDto, type Paginated } from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LimitBanner } from '@/components/billing/LimitBanner';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatPhone, formatMoney, whatsappLink } from '@/lib/format';
import { CustomerFormDrawer } from './CustomerFormDrawer';

export function CustomersListPage() {
  const { can, session } = useSession();
  const canWrite = can(Permission.CUSTOMERS_WRITE);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = useQuery({
    queryKey: ['customers', 'list', { search, page }],
    queryFn: () =>
      api.get<Paginated<CustomerWithSummaryDto>>('/customers', {
        search: search || undefined,
        page,
        pageSize: 20,
      }),
    placeholderData: (previous) => previous,
  });

  const usage = session?.billing.usage.customers;

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Sua base de tutores e o historico de atendimentos deles."
        action={
          canWrite ? (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setDrawerOpen(true)}>
              Novo cliente
            </Button>
          ) : null
        }
      />

      {usage ? <LimitBanner label={LIMIT_KEY_LABELS.customers} entry={usage} /> : null}

      <Card>
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome, telefone ou email"
              aria-label="Buscar clientes"
              className="h-9.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] pr-3 pl-9 text-base sm:text-sm"
            />
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <span className="sr-only">Carregando clientes</span>
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
            icon={<Users className="size-5" />}
            title={search ? 'Nenhum cliente encontrado' : 'Voce ainda nao cadastrou clientes'}
            description={search ? 'Tente outro termo de busca.' : 'Cadastre o primeiro cliente para comecar.'}
            action={
              !search && canWrite ? (
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
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-[0.8125rem]">
                <thead className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Nome</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">WhatsApp</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Pets</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Ultimo atendimento</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Proximo</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {query.data.data.map((customer) => (
                    <tr key={customer.id} className="hover:bg-[var(--color-surface-hover)]">
                      <td className="px-5 py-3">
                        <Link to={`/clientes/${customer.id}`} className="font-medium hover:underline">
                          {customer.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-[var(--color-text-muted)]">
                        {formatPhone(customer.whatsapp ?? customer.phone)}
                      </td>
                      <td className="tabular px-5 py-3">{customer.petsCount}</td>
                      <td className="px-5 py-3 text-[var(--color-text-muted)]">{formatDate(customer.lastVisitAt)}</td>
                      <td className="px-5 py-3 text-[var(--color-text-muted)]">{formatDate(customer.nextAppointmentAt)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={customer.active ? 'success' : 'neutral'}>
                          {customer.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-[var(--color-border)] sm:hidden">
              {query.data.data.map((customer) => {
                const link = whatsappLink(customer.whatsapp ?? customer.phone);
                return (
                  <li key={customer.id} className="flex items-center gap-3 p-4">
                    <Link to={`/clientes/${customer.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{customer.name}</p>
                      <p className="mt-0.5 truncate text-[0.75rem] text-[var(--color-text-muted)]">
                        {customer.petsCount} pet(s) &middot; {formatMoney(customer.totalSpent)} gastos
                      </p>
                    </Link>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`WhatsApp de ${customer.name}`}
                        className="shrink-0 rounded-[var(--radius-md)] p-2 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-success)]"
                      >
                        <MessageCircle aria-hidden className="size-4" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <CustomerFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
