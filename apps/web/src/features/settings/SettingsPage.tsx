import {
  BRAZIL_TIMEZONES,
  isTimezone,
  Permission,
  type Tenant,
  type UpdateTenantInput,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { RequirePermission } from '@/features/auth/guards';
import { useSession } from '@/features/auth/session';
import { AppearanceSection } from './AppearanceSection';
import { WhatsAppConnectionSection } from './WhatsAppConnectionSection';
import { ApiError, api } from '@/lib/api';
import { formatPhone } from '@/lib/format';

const TENANT_QUERY_KEY = ['tenant', 'current'] as const;

type TabKey = 'empresa' | 'agendamento' | 'whatsapp' | 'automacao' | 'aparencia';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'agendamento', label: 'Agendamento' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'automacao', label: 'Automação' },
  { key: 'aparencia', label: 'Aparência' },
];

function useTenant() {
  return useQuery({
    queryKey: TENANT_QUERY_KEY,
    queryFn: () => api.get<Tenant>('/tenants/current'),
  });
}

function useUpdateTenant() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { refresh } = useSession();

  return useMutation({
    mutationFn: (input: UpdateTenantInput) => api.patch<Tenant>('/tenants/current', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TENANT_QUERY_KEY });
      // A sessao carrega a marca (nome, logo, cor) usada pelo layout inteiro.
      await refresh();
      toast.success('Configurações salvas.');
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      }
    },
  });
}

function SectionSkeleton() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando configurações</span>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9.5 w-full" />
        ))}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Empresa
--------------------------------------------------------------------------- */

function CompanySection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const mutation = useUpdateTenant();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const timezone = String(data.get('timezone') ?? '');

    mutation.mutate({
      name: String(data.get('name') ?? ''),
      phone: String(data.get('phone') ?? ''),
      whatsapp: String(data.get('whatsapp') ?? ''),
      email: String(data.get('email') ?? '') || null,
      // Estreitamos com um type guard em vez de um cast: se alguem editar o
      // <select> pelo DevTools, mandamos o valor atual e nao lixo tipado.
      timezone: isTimezone(timezone) ? timezone : tenant.timezone,
    });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Card>
      <CardHeader
        title="Dados do pet shop"
        description="Aparecem nas mensagens enviadas aos clientes."
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            label="Nome do pet shop"
            name="name"
            defaultValue={tenant.name}
            disabled={readOnly}
            required
            error={apiError?.fieldError('name')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Telefone"
              name="phone"
              type="tel"
              defaultValue={formatPhone(tenant.phone)}
              placeholder="(11) 3333-4444"
              disabled={readOnly}
              error={apiError?.fieldError('phone')}
            />
            <TextField
              label="WhatsApp"
              name="whatsapp"
              type="tel"
              defaultValue={formatPhone(tenant.whatsapp)}
              placeholder="(11) 98888-7777"
              disabled={readOnly}
              error={apiError?.fieldError('whatsapp')}
            />
          </div>

          <TextField
            label="Email de contato"
            name="email"
            type="email"
            defaultValue={tenant.email ?? ''}
            disabled={readOnly}
            error={apiError?.fieldError('email')}
          />

          <SelectField
            label="Fuso horário"
            name="timezone"
            defaultValue={tenant.timezone}
            disabled={readOnly}
            hint="Define o que conta como 'hoje' na agenda e nos indicadores."
            options={BRAZIL_TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
          />

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alterações
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Automacao
--------------------------------------------------------------------------- */

function AutomationSection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const mutation = useUpdateTenant();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      settings: {
        inactiveCustomerDays: Number(data.get('inactiveCustomerDays')),
        appointmentReminderHours: Number(data.get('appointmentReminderHours')),
        automationEnabled: data.get('automationEnabled') === 'on',
      },
    });
  }

  return (
    <Card>
      <CardHeader
        title="Automação e retorno de clientes"
        description="Define quando um cliente e considerado sumido e quando lembrar dos atendimentos."
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <SelectField
            label="Considerar cliente inativo após"
            name="inactiveCustomerDays"
            defaultValue={String(tenant.settings.inactiveCustomerDays)}
            disabled={readOnly}
            hint="Usado na tela de recuperação e no indicador de clientes sumidos."
            options={[30, 45, 60, 90].map((days) => ({
              value: String(days),
              label: `${days} dias sem agendamento`,
            }))}
          />

          <SelectField
            label="Lembrar do atendimento com"
            name="appointmentReminderHours"
            defaultValue={String(tenant.settings.appointmentReminderHours)}
            disabled={readOnly}
            options={[2, 6, 12, 24, 48].map((hours) => ({
              value: String(hours),
              label: `${hours} horas de antecedencia`,
            }))}
          />

          <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5">
            <input
              type="checkbox"
              name="automationEnabled"
              defaultChecked={tenant.settings.automationEnabled}
              disabled={readOnly}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-medium">Autorizar envio automático</span>
              <span className="mt-0.5 block text-[0.8125rem] text-[var(--color-text-muted)]">
                Enquanto estiver desligado, nenhuma mensagem sai sozinha: o sistema apenas prepara
                o texto e você decide quando enviar.
              </span>
            </span>
          </label>

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alterações
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Agendamento online
--------------------------------------------------------------------------- */

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

function BookingSection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const mutation = useUpdateTenant();
  const toast = useToast();
  const { businessHours, publicBooking } = tenant.settings;
  const link = `${window.location.origin}/agendar/${tenant.slug}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      settings: {
        businessHours: {
          start: String(data.get('start')),
          end: String(data.get('end')),
          weekdays: data.getAll('weekdays').map(Number),
        },
        publicBooking: {
          enabled: data.get('enabled') === 'on',
          minLeadHours: Number(data.get('minLeadHours')),
          maxDaysAhead: Number(data.get('maxDaysAhead')),
          slotIntervalMinutes: Number(data.get('slotIntervalMinutes')),
        },
      },
    });
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Card>
      <CardHeader
        title="Agendamento online"
        description="Um link para o tutor pedir horário sozinho. Cada pedido chega como solicitação na agenda e só vira agendamento quando você aceita."
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={publicBooking.enabled}
              disabled={readOnly}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-medium">Receber pedidos pelo link</span>
              <span className="mt-0.5 block text-[0.8125rem] text-[var(--color-text-muted)]">
                Desligado, o link responde como página inexistente. O tutor só vê o nome do pet shop,
                os serviços ativos e os horários livres.
              </span>
            </span>
          </label>

          {publicBooking.enabled ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-3">
              <code className="min-w-0 flex-1 truncate text-[0.8125rem]">{link}</code>
              <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
                Copiar link
              </Button>
              <a
                href={`/agendar/${tenant.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
              >
                Abrir
              </a>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2" disabled={readOnly}>
            <legend className="mb-1 text-sm font-medium">Dias de atendimento</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((day) => (
                <label
                  key={day.value}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[0.8125rem] has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-subtle)] has-[:checked]:text-[var(--color-brand-text)]"
                >
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={day.value}
                    defaultChecked={businessHours.weekdays.includes(day.value)}
                    className="sr-only"
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Abre às" name="start" type="time" defaultValue={businessHours.start} disabled={readOnly} error={apiError?.fieldError('settings.businessHours.start')} />
            <TextField label="Fecha às" name="end" type="time" defaultValue={businessHours.end} disabled={readOnly} error={apiError?.fieldError('settings.businessHours.end')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Antecedência mínima"
              name="minLeadHours"
              defaultValue={String(publicBooking.minLeadHours)}
              disabled={readOnly}
              options={[0, 1, 2, 4, 12, 24, 48].map((hours) => ({
                value: String(hours),
                label: hours === 0 ? 'Sem mínimo' : `${hours} ${hours === 1 ? 'hora' : 'horas'}`,
              }))}
            />
            <SelectField
              label="Agenda aberta por"
              name="maxDaysAhead"
              defaultValue={String(publicBooking.maxDaysAhead)}
              disabled={readOnly}
              options={[7, 14, 30, 60, 90].map((days) => ({ value: String(days), label: `${days} dias` }))}
            />
            <SelectField
              label="Horários a cada"
              name="slotIntervalMinutes"
              defaultValue={String(publicBooking.slotIntervalMinutes)}
              disabled={readOnly}
              options={[15, 30, 60].map((minutes) => ({ value: String(minutes), label: `${minutes} minutos` }))}
            />
          </div>

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alterações
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Pagina
--------------------------------------------------------------------------- */

export function SettingsPage() {
  const { can } = useSession();
  // ?aba=aparencia abre direto na aba (atalho do seletor de tema do painel).
  const [searchParams] = useSearchParams();
  const initialTab = TABS.find((item) => item.key === searchParams.get('aba'))?.key ?? 'empresa';
  const [tab, setTab] = useState<TabKey>(initialTab);
  const query = useTenant();

  const readOnly = !can(Permission.SETTINGS_WRITE);

  return (
    <RequirePermission permission={Permission.SETTINGS_READ}>
      <PageHeader
        title="Configurações"
        description={
          readOnly
            ? 'Somente o proprietário pode alterar estas informações.'
            : 'Dados do pet shop, WhatsApp, automações e aparência.'
        }
      />

      {/* Abas com semantica de tablist: setas do teclado funcionam por padrao
          no foco, e o estado selecionado e anunciado. */}
      <div role="tablist" aria-label="Seções das configurações" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={
              tab === item.key
                ? 'shrink-0 whitespace-nowrap border-b-2 border-[var(--color-brand)] px-3.5 py-2.5 text-sm font-medium text-[var(--color-brand-text)]'
                : 'shrink-0 whitespace-nowrap border-b-2 border-transparent px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {query.isLoading ? (
          <SectionSkeleton />
        ) : query.isError ? (
          <Card>
            <ErrorState
              message={
                query.error instanceof ApiError
                  ? query.error.message
                  : 'Tente novamente em instantes.'
              }
              onRetry={() => void query.refetch()}
            />
          </Card>
        ) : query.data ? (
          <>
            {tab === 'empresa' ? <CompanySection tenant={query.data} readOnly={readOnly} /> : null}
            {tab === 'agendamento' ? <BookingSection tenant={query.data} readOnly={readOnly} /> : null}
            {tab === 'whatsapp' ? <WhatsAppConnectionSection tenant={query.data} readOnly={readOnly} /> : null}
            {tab === 'automacao' ? (
              <AutomationSection tenant={query.data} readOnly={readOnly} />
            ) : null}
            {tab === 'aparencia' ? (
              <AppearanceSection tenant={query.data} readOnly={readOnly} />
            ) : null}
          </>
        ) : null}
      </div>
    </RequirePermission>
  );
}
