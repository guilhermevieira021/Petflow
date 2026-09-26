import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  Permission,
  SALE_STATUS_LABELS,
  type PaymentMethod,
  type SaleDetailDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CircleDollarSign, PawPrint, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ReasonDialog } from '@/components/ui/ReasonDialog';
import { SelectField } from '@/components/ui/Field';
import { Badge, Card, CardHeader, ErrorState, InfoItem, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { SALE_STATUS_TONES } from './SalesPage';

const PAYMENT_TONES: Record<string, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  REFUNDED: 'danger',
  CANCELLED: 'neutral',
};

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveMethod, setReceiveMethod] = useState<PaymentMethod | ''>('');

  const query = useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => api.get<SaleDetailDto>(`/sales/${id}`),
    enabled: Boolean(id),
  });

  async function refreshAll(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  }

  const receive = useMutation({
    mutationFn: () => api.post<SaleDetailDto>(`/sales/${id}/receive`, receiveMethod ? { method: receiveMethod } : {}),
    onSuccess: async () => {
      await refreshAll();
      toast.success('Recebimento registrado.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível registrar o recebimento.'),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<SaleDetailDto>(`/sales/${id}/cancel`, { reason }),
    onSuccess: async () => {
      setCancelOpen(false);
      await refreshAll();
      toast.success('Venda cancelada. Estoque e recebimento foram revertidos.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível cancelar.'),
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando venda</span>
        <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar esta venda.'}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  const sale = query.data;
  const timeZone = session.tenant.timezone;

  return (
    <>
      <Link
        to="/vendas"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft aria-hidden className="size-4" /> Vendas
      </Link>

      <Card className="mb-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tabular text-2xl font-semibold tracking-tight">Venda #{sale.number}</h1>
              <Badge dot tone={SALE_STATUS_TONES[sale.status]}>
                {SALE_STATUS_LABELS[sale.status]}
              </Badge>
            </div>
            <p className="tabular mt-1 text-sm text-[var(--color-text-muted)]">
              {formatDateTime(sale.soldAt, timeZone)}
              {sale.createdByName ? ` · por ${sale.createdByName}` : ''}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">Total</p>
            <p className="tabular text-3xl font-semibold tracking-tight">{formatMoney(sale.total)}</p>
          </div>
        </div>

        {sale.status === 'CANCELLED' ? (
          <p className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
            Cancelada em {formatDateTime(sale.cancelledAt, timeZone)}. Motivo: {sale.cancellationReason}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader title="Itens" />
            <ul className="divide-y divide-[var(--color-border)]">
              {sale.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.description}</p>
                    <p className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
                      {formatQuantity(item.quantity)} × {formatMoney(item.unitPrice)}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(item.total)}</span>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Subtotal</dt>
                <dd className="tabular">{formatMoney(sale.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Desconto</dt>
                <dd className="tabular">− {formatMoney(sale.discount)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(sale.total)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Recebimentos" icon={<CircleDollarSign className="size-4" />} />
            {sale.payments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-[var(--color-text-muted)]">Venda sem valor a receber (total zerado).</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {sale.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{PAYMENT_METHOD_LABELS[payment.method]}</p>
                      <p className="tabular text-[0.8125rem] text-[var(--color-text-muted)]">
                        {payment.paidAt ? `Pago em ${formatDateTime(payment.paidAt, timeZone)}` : 'Aguardando recebimento'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular text-sm font-semibold">{formatMoney(payment.amount)}</span>
                      <Badge tone={PAYMENT_TONES[payment.status] ?? 'neutral'}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {sale.status === 'OPEN' && can(Permission.SALES_WRITE) ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Receber agora</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                O valor entra no &quot;Recebido&quot; do painel a partir do registro.
              </p>
              <div className="mt-3">
                <SelectField
                  label="Forma de pagamento"
                  name="receiveMethod"
                  value={receiveMethod}
                  onChange={(event) => setReceiveMethod(event.target.value as PaymentMethod | '')}
                  options={[
                    { value: '', label: 'Manter a informada na venda' },
                    ...(['PIX', 'CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER'] as PaymentMethod[]).map((method) => ({
                      value: method,
                      label: PAYMENT_METHOD_LABELS[method],
                    })),
                  ]}
                />
              </div>
              <Button className="mt-4 w-full" loading={receive.isPending} onClick={() => receive.mutate()}>
                Registrar recebimento de {formatMoney(sale.total)}
              </Button>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Cliente" />
            <dl className="grid gap-4 p-5">
              <InfoItem
                label="Cliente"
                value={
                  sale.customerId ? (
                    <Link to={`/clientes/${sale.customerId}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <User aria-hidden className="size-3.5" /> {sale.customerName}
                    </Link>
                  ) : (
                    'Balcão (sem cadastro)'
                  )
                }
                muted={!sale.customerId}
              />
              {sale.petId ? (
                <InfoItem
                  label="Pet"
                  value={
                    <Link to={`/pets/${sale.petId}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <PawPrint aria-hidden className="size-3.5" /> {sale.petName}
                    </Link>
                  }
                />
              ) : null}
              {sale.notes ? <InfoItem label="Observações" value={<span className="whitespace-pre-line">{sale.notes}</span>} /> : null}
            </dl>
          </Card>

          {sale.status !== 'CANCELLED' && can(Permission.SALES_CANCEL) ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Cancelar venda</h2>
              <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
                Devolve os produtos ao estoque e estorna o recebimento. A venda continua no histórico.
              </p>
              <Button
                variant="secondary"
                className="mt-4 w-full text-[var(--color-danger)]"
                icon={<Ban className="size-4" />}
                onClick={() => setCancelOpen(true)}
              >
                Cancelar venda
              </Button>
            </Card>
          ) : null}
        </div>
      </div>

      <ReasonDialog
        open={cancelOpen}
        title={`Cancelar a venda #${sale.number}?`}
        description="Os produtos voltam ao estoque e o valor recebido é estornado (sai do Recebido do painel)."
        placeholder="Ex.: cliente desistiu da compra"
        confirmLabel="Cancelar venda"
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
        onCancel={() => setCancelOpen(false)}
      />
    </>
  );
}
