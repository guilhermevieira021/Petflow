import {
  PAYMENT_METHOD_LABELS,
  Permission,
  SALE_STATUS_LABELS,
  type Paginated,
  type SaleDto,
  type SalesSummaryDto,
  type SaleStatus,
} from '@petflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { FilterChip, SearchInput } from '@/components/ui/SearchInput';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatMoney } from '@/lib/format';
import { localDayWindow, todayInTimeZone } from '@/lib/timezone';

export const SALE_STATUS_TONES: Record<SaleStatus, BadgeTone> = {
  OPEN: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
};

const FILTERS: { value: SaleStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PAID', label: 'Pagas' },
  { value: 'OPEN', label: 'A receber' },
  { value: 'CANCELLED', label: 'Canceladas' },
];

function TodaySummary() {
  const session = useCurrentSession();
  const timeZone = session.tenant.timezone;
  const window = useMemo(() => localDayWindow(todayInTimeZone(timeZone), timeZone), [timeZone]);
  const query = useQuery({
    queryKey: ['sales', 'summary', window.from],
    queryFn: () => api.get<SalesSummaryDto>('/sales/summary', { from: window.from, to: window.to }),
  });

  if (query.isLoading) return <Skeleton className="mb-4 h-24 w-full rounded-[var(--radius-lg)]" />;
  if (!query.data) return null;
  const data = query.data;

  const cells = [
    { label: 'Vendido hoje', value: formatMoney(data.totalSold) },
    { label: 'Recebido hoje (vendas)', value: formatMoney(data.totalReceived), tone: 'success' as const },
    { label: 'A receber', value: formatMoney(data.totalOpen), tone: data.totalOpen > 0 ? ('warning' as const) : undefined },
    { label: 'Ticket médio', value: data.averageTicket === null ? '--' : formatMoney(data.averageTicket) },
  ];

  return (
    <Card className="mb-4 @container">
      <dl className="grid grid-cols-2 @2xl:grid-cols-4">
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={cn(
              'min-w-0 px-5 py-4',
              index % 2 === 1 && 'border-l border-[var(--color-border)]',
              index >= 2 && 'border-t border-[var(--color-border)] @2xl:border-t-0',
              index === 2 && '@2xl:border-l',
            )}
          >
            <dt className="text-[0.75rem] text-[var(--color-text-muted)]">{cell.label}</dt>
            <dd
              className={cn(
                'tabular mt-1 truncate text-lg font-semibold tracking-tight',
                cell.tone === 'success' && 'text-[var(--color-success)]',
                cell.tone === 'warning' && 'text-[var(--color-warning)]',
              )}
            >
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>
      {data.byMethod.length > 0 ? (
        <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-[0.75rem] text-[var(--color-text-muted)]">
          {data.byMethod.map((row) => `${PAYMENT_METHOD_LABELS[row.method]} ${formatMoney(row.amount)}`).join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}

export function SalesPage() {
  const { can } = useSession();
  const session = useCurrentSession();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SaleStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['sales', 'list', { status, search, page }],
    queryFn: () =>
      api.get<Paginated<SaleDto>>('/sales', {
        status: status === 'ALL' ? undefined : status,
        search: search || undefined,
        page,
        pageSize: 20,
      }),
    placeholderData: (previous) => previous,
  });

  const newSale = can(Permission.SALES_WRITE) ? (
    <Link to="/vendas/nova" className={buttonClasses('primary', 'md')}>
      <Plus aria-hidden className="size-4" /> Nova venda
    </Link>
  ) : null;

  return (
    <>
      <PageHeader title="Vendas" description="Tudo o que o pet shop vendeu e recebeu dos clientes." action={newSale} />

      <TodaySummary />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por número da venda ou cliente"
          label="Buscar vendas"
          className="flex-1"
        />
        <div className="scroll-x -mx-4 flex gap-2 px-4 md:mx-0 md:px-0" role="group" aria-label="Filtrar por situação">
          {FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
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
            <span className="sr-only">Carregando vendas</span>
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
            icon={<Receipt className="size-5" />}
            title={search || status !== 'ALL' ? 'Nenhuma venda encontrada' : 'Nenhuma venda registrada ainda'}
            description={
              search || status !== 'ALL'
                ? 'Tente outro termo ou filtro.'
                : 'Registre a primeira venda para ela aparecer aqui e no "Recebido" do painel.'
            }
            action={!search && status === 'ALL' ? newSale ?? undefined : undefined}
          />
        ) : null}

        {query.data && query.data.data.length > 0 ? (
          <>
            <div className="hidden md:block">
              <table className="w-full text-[0.8125rem]">
                <caption className="sr-only">Lista de vendas</caption>
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-left text-[var(--color-text-muted)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Venda</th>
                    <th scope="col" className="px-4 py-3 font-medium">Data</th>
                    <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                    <th scope="col" className="px-4 py-3 font-medium">Pagamento</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {query.data.data.map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => navigate(`/vendas/${sale.id}`)}
                      className="cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`/vendas/${sale.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="tabular font-semibold hover:underline"
                        >
                          #{sale.number}
                        </Link>
                        <span className="ml-2 text-[var(--color-text-muted)]">
                          {sale.itemsCount} {sale.itemsCount === 1 ? 'item' : 'itens'}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-[var(--color-text-muted)]">
                        {formatDateTime(sale.soldAt, session.tenant.timezone)}
                      </td>
                      <td className="px-4 py-3">{sale.customerName ?? <span className="text-[var(--color-text-subtle)]">Balcão</span>}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod] : '--'}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(sale.total)}</td>
                      <td className="px-4 py-3">
                        <Badge dot tone={SALE_STATUS_TONES[sale.status]}>
                          {SALE_STATUS_LABELS[sale.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-[var(--color-border)] md:hidden">
              {query.data.data.map((sale) => (
                <li key={sale.id}>
                  <Link to={`/vendas/${sale.id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="tabular text-[0.9375rem] font-semibold">#{sale.number}</span>
                        <Badge dot tone={SALE_STATUS_TONES[sale.status]}>
                          {SALE_STATUS_LABELS[sale.status]}
                        </Badge>
                      </p>
                      <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                        {sale.customerName ?? 'Balcão'} · {formatDateTime(sale.soldAt, session.tenant.timezone)}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[0.9375rem] font-semibold">{formatMoney(sale.total)}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination pagination={query.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
