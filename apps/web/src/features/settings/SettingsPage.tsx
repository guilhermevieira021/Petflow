import {
  BRAZIL_TIMEZONES,
  isTimezone,
  Permission,
  type Tenant,
  type UpdateTenantInput,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { RequirePermission } from '@/features/auth/guards';
import { useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { formatPhone } from '@/lib/format';

const TENANT_QUERY_KEY = ['tenant', 'current'] as const;

type TabKey = 'empresa' | 'whatsapp' | 'automacao' | 'aparencia';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'automacao', label: 'Automacao' },
  { key: 'aparencia', label: 'Aparencia' },
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
      toast.success('Configuracoes salvas.');
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fields.length === 0) {
        toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
      }
    },
  });
}

function SectionSkeleton() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Carregando configuracoes</span>
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
            label="Fuso horario"
            name="timezone"
            defaultValue={tenant.timezone}
            disabled={readOnly}
            hint="Define o que conta como 'hoje' na agenda e nos indicadores."
            options={BRAZIL_TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
          />

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alteracoes
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
        title="Automacao e retorno de clientes"
        description="Define quando um cliente e considerado sumido e quando lembrar dos atendimentos."
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <SelectField
            label="Considerar cliente inativo apos"
            name="inactiveCustomerDays"
            defaultValue={String(tenant.settings.inactiveCustomerDays)}
            disabled={readOnly}
            hint="Usado na tela de recuperacao e no indicador de clientes sumidos."
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
              <span className="block text-sm font-medium">Autorizar envio automatico</span>
              <span className="mt-0.5 block text-[0.8125rem] text-[var(--color-text-muted)]">
                Enquanto estiver desligado, nenhuma mensagem sai sozinha: o sistema apenas prepara
                o texto e voce decide quando enviar.
              </span>
            </span>
          </label>

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alteracoes
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   WhatsApp
--------------------------------------------------------------------------- */

function WhatsAppSection({ tenant }: { tenant: Tenant }) {
  return (
    <Card>
      <CardHeader title="WhatsApp" description="Como as mensagens do sistema chegam aos seus clientes." />
      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Numero usado para contato</p>
          <p className="mt-0.5 text-sm font-medium">
            {tenant.whatsapp ? formatPhone(tenant.whatsapp) : 'Nao configurado -- defina na aba Empresa'}
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-subtle)] p-3.5 text-[0.8125rem] text-[var(--color-info)]">
          Nenhuma API oficial do WhatsApp esta conectada nesta instalacao. As mensagens de Recuperacao
          e do perfil do cliente abrem o WhatsApp com o texto ja pronto, e voce confirma o envio
          manualmente -- nada sai sozinho do sistema.
        </div>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Aparencia (white-label)
--------------------------------------------------------------------------- */

function AppearanceSection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const mutation = useUpdateTenant();
  const [color, setColor] = useState(tenant.primaryColor);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const logoUrl = String(data.get('logoUrl') ?? '').trim();
    mutation.mutate({ primaryColor: color, logoUrl: logoUrl === '' ? null : logoUrl });
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <Card>
      <CardHeader
        title="Aparencia"
        description="A marca do seu pet shop aplicada ao sistema."
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            label="URL do logo"
            name="logoUrl"
            type="url"
            defaultValue={tenant.logoUrl ?? ''}
            placeholder="https://seusite.com.br/logo.png"
            hint="Imagem quadrada, de preferencia com fundo transparente."
            disabled={readOnly}
            error={apiError?.fieldError('logoUrl')}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="primaryColor" className="text-[0.8125rem] font-medium">
              Cor principal
            </label>
            <div className="flex items-center gap-3">
              <input
                id="primaryColor"
                type="color"
                value={color}
                disabled={readOnly}
                onChange={(event) => setColor(event.target.value)}
                className="h-9.5 w-14 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1"
              />
              <output className="tabular text-sm text-[var(--color-text-muted)]">{color}</output>
              <span
                aria-hidden
                className="ml-auto rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem] font-medium text-white"
                style={{ backgroundColor: color }}
              >
                Previa
              </span>
            </div>
            <p className="text-[0.8125rem] text-[var(--color-text-subtle)]">
              Os graficos mantem a propria paleta, escolhida para continuar legivel para quem tem
              daltonismo.
            </p>
          </div>

          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={mutation.isPending}>
                Salvar alteracoes
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
  const [tab, setTab] = useState<TabKey>('empresa');
  const query = useTenant();

  const readOnly = !can(Permission.SETTINGS_WRITE);

  return (
    <RequirePermission permission={Permission.SETTINGS_READ}>
      <PageHeader
        title="Configuracoes"
        description={
          readOnly
            ? 'Somente o proprietario pode alterar estas informacoes.'
            : 'Dados do pet shop, WhatsApp, automacoes e aparencia.'
        }
      />

      {/* Abas com semantica de tablist: setas do teclado funcionam por padrao
          no foco, e o estado selecionado e anunciado. */}
      <div role="tablist" aria-label="Secoes das configuracoes" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={
              tab === item.key
                ? 'border-b-2 border-[var(--color-brand)] px-3.5 py-2.5 text-sm font-medium text-[var(--color-brand-text)]'
                : 'border-b-2 border-transparent px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]'
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
            {tab === 'whatsapp' ? <WhatsAppSection tenant={query.data} /> : null}
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
