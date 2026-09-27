import {
  MESSAGE_STATUS_LABELS,
  MESSAGE_TEMPLATE_TRIGGERS,
  MESSAGE_TYPE_LABELS,
  Permission,
  REMINDER_STATUS_LABELS,
  TEMPLATE_VARIABLE_LABELS,
  TEMPLATE_VARIABLES,
  type MessageDto,
  type MessageStatus,
  type MessageTemplateDto,
  type Paginated,
  type ProcessRemindersResultDto,
  type ReminderDto,
  type ReminderSchedulerStatusDto,
  type ReminderStatus,
  type SendMessageResultDto,
  type WhatsappStatusDto,
} from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, ExternalLink, MessageSquare, Plug, PlugZap, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type BadgeTone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useCurrentSession, useSession } from '@/features/auth/session';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatPhone, whatsappLink } from '@/lib/format';

const STATUS_TONES: Record<MessageStatus, BadgeTone> = {
  DRAFT: 'warning',
  QUEUED: 'info',
  SENT: 'success',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'danger',
  OPENED_EXTERNALLY: 'neutral',
};

type Tab = 'history' | 'reminders' | 'templates';

/* ---------------------------------------------------------------------------
   Conexao
--------------------------------------------------------------------------- */

function ConnectionBanner({ status }: { status: WhatsappStatusDto }) {
  return (
    <div
      role="status"
      className={cn(
        'mb-5 flex items-start gap-3 rounded-[var(--radius-lg)] border p-4',
        status.connected
          ? 'border-[var(--color-success)]/25 bg-[var(--color-success-subtle)]'
          : 'border-[var(--color-warning)]/25 bg-[var(--color-warning-subtle)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          status.connected ? 'bg-[var(--color-success-solid)] text-white' : 'bg-[var(--color-warning-solid)] text-white',
        )}
      >
        {status.connected ? <PlugZap className="size-4" /> : <Plug className="size-4" />}
      </span>
      <div className="min-w-0">
        <p className={cn('text-sm font-semibold', status.connected ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]')}>
          {status.connected ? 'WhatsApp conectado' : 'WhatsApp não conectado'}
        </p>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">{status.message}</p>
        <p className="mt-1 text-[0.75rem] text-[var(--color-text-subtle)]">
          Mensagens automáticas (confirmação, cancelamento, reagendamento e pós-atendimento):{' '}
          <strong className="font-medium text-[var(--color-text-muted)]">{status.automationEnabled ? 'ligadas' : 'desligadas'}</strong>
          {status.automationEnabled ? '' : ' — ative em Configurações.'}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Resultado de envio -- nunca finge envio
--------------------------------------------------------------------------- */

function SendResultNotice({ result, onClose }: { result: SendMessageResultDto; onClose: () => void }) {
  return (
    <div
      role="alert"
      className={cn(
        'mb-4 rounded-[var(--radius-lg)] border p-4',
        result.delivered ? 'border-[var(--color-success)]/25 bg-[var(--color-success-subtle)]' : 'border-[var(--color-warning)]/25 bg-[var(--color-warning-subtle)]',
      )}
    >
      <p className="text-sm font-semibold">{result.delivered ? 'Mensagem enviada' : 'Mensagem registrada — não enviada'}</p>
      <p className="mt-0.5 text-[0.8125rem] text-[var(--color-text-muted)]">{result.notice}</p>
      <p className="mt-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-2 text-[0.8125rem] whitespace-pre-line">{result.content}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {result.manualLink ? (
          <a href={result.manualLink} target="_blank" rel="noreferrer noopener" className={buttonClasses('primary', 'sm')}>
            <ExternalLink aria-hidden className="size-3.5" /> Enviar pelo WhatsApp
          </a>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Historico
--------------------------------------------------------------------------- */

function HistoryTab() {
  const session = useCurrentSession();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['messages', 'list', page],
    queryFn: () => api.get<Paginated<MessageDto>>('/messages', { page, pageSize: 20 }),
    placeholderData: (previous) => previous,
  });

  return (
    <Card className="overflow-hidden">
      {query.isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : null}
      {query.isError ? (
        <ErrorState message={query.error instanceof ApiError ? query.error.message : 'Tente novamente.'} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data && query.data.data.length === 0 ? (
        <EmptyState icon={<MessageSquare className="size-5" />} title="Nenhuma mensagem ainda" description="Mensagens enviadas ou registradas aparecem aqui." />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <>
          <ul className="divide-y divide-[var(--color-border)]">
            {query.data.data.map((message) => (
              <li key={message.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{message.customerName}</span>
                  {message.petName ? <span className="text-[0.8125rem] text-[var(--color-text-muted)]">· {message.petName}</span> : null}
                  <Badge tone="neutral">{MESSAGE_TYPE_LABELS[message.type]}</Badge>
                  <Badge dot tone={STATUS_TONES[message.status]}>
                    {MESSAGE_STATUS_LABELS[message.status]}
                  </Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[0.8125rem] text-[var(--color-text-muted)]">{message.content}</p>
                <p className="mt-1 text-[0.75rem] text-[var(--color-text-subtle)]">
                  {formatDateTime(message.createdAt, session.tenant.timezone)}
                  {message.recipient ? ` · para ${formatPhone(message.recipient.replace(/^55/, ''))}` : ''}
                  {message.failureReason ? ` · ${message.failureReason}` : ''}
                </p>
              </li>
            ))}
          </ul>
          <Pagination pagination={query.data.pagination} onPageChange={setPage} />
        </>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   Lembretes: fila (geracao) x processamento (envio)
--------------------------------------------------------------------------- */

const REMINDER_TONES: Record<ReminderStatus, BadgeTone> = {
  PENDING: 'info',
  SENT: 'success',
  REGISTERED: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
};

type ReminderFilter = 'PENDING' | 'REGISTERED' | 'DONE';

function RemindersTab() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const timeZone = session.tenant.timezone;
  const [filter, setFilter] = useState<ReminderFilter>('PENDING');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ProcessRemindersResultDto | null>(null);

  const status = useQuery({
    queryKey: ['messages', 'reminders', 'status'],
    queryFn: () => api.get<ReminderSchedulerStatusDto>('/messages/reminders/status'),
  });
  const list = useQuery({
    queryKey: ['messages', 'reminders', 'list', filter, page],
    queryFn: () =>
      api.get<Paginated<ReminderDto>>('/messages/reminders', {
        status: filter === 'DONE' ? undefined : filter,
        page,
        pageSize: 20,
      }),
    placeholderData: (previous) => previous,
  });

  const process = useMutation({
    mutationFn: (aheadHours: number) => api.post<ProcessRemindersResultDto>('/messages/reminders/process', { aheadHours }),
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível processar.'),
  });

  const items = (list.data?.data ?? []).filter((item) =>
    filter === 'DONE' ? item.status !== 'PENDING' && item.status !== 'REGISTERED' : true,
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <BellRing aria-hidden className="size-4 text-[var(--color-brand-text)]" />
              Lembretes de atendimento
            </h3>
            <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">
              Cada agendamento gera um lembrete para {status.data?.reminderHours ?? '…'}h antes do horário.{' '}
              {status.data ? (
                <>
                  <strong className="text-[var(--color-text)]">{status.data.pending}</strong> agendado(s),{' '}
                  <strong className="text-[var(--color-text)]">{status.data.dueNow}</strong> pronto(s) para processar.
                </>
              ) : null}
            </p>
          </div>
          {can(Permission.MESSAGES_SEND) ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={process.isPending && process.variables === 24} onClick={() => process.mutate(24)}>
                Incluir próximas 24h
              </Button>
              <Button icon={<Send className="size-4" />} loading={process.isPending && process.variables === 0} onClick={() => process.mutate(0)}>
                Processar lembretes
              </Button>
            </div>
          ) : null}
        </div>
        <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-[0.75rem] text-[var(--color-text-muted)]">
          O processamento automático (sem clicar) depende de um agendador no servidor (worker/cron) e ainda não está ativo.
          {status.data && !status.data.automaticProcessing ? ' Por enquanto, use "Processar lembretes".' : ''}
        </p>
        {result ? (
          <div
            role="status"
            className={cn(
              'mt-3 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-[0.8125rem]',
              result.providerConnected
                ? 'border-[var(--color-success)]/30 bg-[var(--color-success-subtle)]'
                : 'border-[var(--color-warning)]/40 bg-[var(--color-warning-subtle)]',
            )}
          >
            <p className="font-medium">{result.notice}</p>
            <p className="mt-0.5 text-[var(--color-text-muted)]">
              Processados: {result.processed} · enviados pela API: {result.sent} · registrados sem envio: {result.registered} · falhas:{' '}
              {result.failed} · não gerados: {result.skipped}
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-3">
          <SegmentedControl<ReminderFilter>
            label="Filtrar lembretes"
            size="sm"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            options={[
              { value: 'PENDING', label: 'Agendados' },
              { value: 'REGISTERED', label: 'Não enviados' },
              { value: 'DONE', label: 'Concluídos' },
            ]}
          />
        </div>
        {list.isLoading ? <Skeleton className="m-4 h-24" /> : null}
        {list.isError ? <ErrorState message="Não foi possível carregar." onRetry={() => void list.refetch()} /> : null}
        {list.data && items.length === 0 ? (
          <EmptyState
            compact
            icon={<CheckCircle2 className="size-5" />}
            title={filter === 'PENDING' ? 'Nenhum lembrete agendado' : filter === 'REGISTERED' ? 'Nada pendente de envio manual' : 'Nenhum lembrete concluído'}
          />
        ) : null}
        {items.length > 0 ? (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => {
              const link = item.status === 'REGISTERED' && item.messageContent ? whatsappLink(item.customerWhatsapp, item.messageContent) : null;
              return (
                <li key={item.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {item.petName ?? 'Pet'} <span className="font-normal text-[var(--color-text-muted)]">· {item.customerName}</span>
                    </p>
                    <p className="truncate text-[0.8125rem] text-[var(--color-text-muted)]">
                      {item.serviceName ?? 'Atendimento'} em {formatDateTime(item.appointmentStartsAt, timeZone)} · lembrete{' '}
                      {item.status === 'PENDING' ? 'para' : 'de'} {formatDateTime(item.scheduledAt, timeZone)}
                    </p>
                    {item.note ? <p className="truncate text-[0.75rem] text-[var(--color-text-subtle)]">{item.note}</p> : null}
                  </div>
                  <Badge dot tone={REMINDER_TONES[item.status]}>
                    {REMINDER_STATUS_LABELS[item.status]}
                  </Badge>
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer" className={buttonClasses('secondary', 'sm')}>
                      <ExternalLink aria-hidden className="size-3.5" />
                      Enviar pelo WhatsApp
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {list.data ? <Pagination pagination={list.data.pagination} onPageChange={setPage} /> : null}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Templates
--------------------------------------------------------------------------- */

function TemplateEditor({ template, canEdit }: { template: MessageTemplateDto; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [active, setActive] = useState(template.active);
  const dirty = body !== template.body || active !== template.active;

  const save = useMutation({
    mutationFn: () =>
      template.type === 'CUSTOM'
        ? api.patch<MessageTemplateDto>(`/messages/templates/${template.id}`, { name: template.name, body, active })
        : api.put<MessageTemplateDto>(`/messages/templates/type/${template.type}`, { name: template.name, body, active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', 'templates'] });
      toast.success('Template salvo.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.'),
  });
  const reset = useMutation({
    mutationFn: () => api.delete(`/messages/templates/type/${template.type}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', 'templates'] });
      toast.success('Texto padrão restaurado.');
    },
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{template.name}</h3>
          {template.type !== 'CUSTOM' ? (
            <p className="text-[0.75rem] text-[var(--color-text-muted)]">{MESSAGE_TEMPLATE_TRIGGERS[template.type]}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {template.isDefault ? <Badge tone="neutral">Texto padrão</Badge> : <Badge tone="brand">Personalizado</Badge>}
          {!active ? <Badge tone="warning">Desativado</Badge> : null}
        </div>
      </div>
      <label className="sr-only" htmlFor={`tpl-${template.type}-${template.id ?? 'default'}`}>
        Texto do template {template.name}
      </label>
      <textarea
        id={`tpl-${template.type}-${template.id ?? 'default'}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        readOnly={!canEdit}
        maxLength={2000}
        className="mt-3 min-h-24 w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3.5 py-2.5 text-base leading-relaxed focus-visible:border-[var(--color-brand)] focus-visible:outline-none read-only:bg-[var(--color-surface-sunken)] sm:text-sm"
      />
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-[0.8125rem]">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4 accent-[var(--color-brand)]" />
            Ativo
          </label>
          <div className="flex gap-2">
            {!template.isDefault && template.type !== 'CUSTOM' ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={reset.isPending} onClick={() => reset.mutate()}>
                Restaurar padrão
              </Button>
            ) : null}
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function TemplatesTab() {
  const { can } = useSession();
  const canEdit = can(Permission.MESSAGE_TEMPLATES_WRITE);
  const query = useQuery({
    queryKey: ['messages', 'templates'],
    queryFn: () => api.get<MessageTemplateDto[]>('/messages/templates'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {query.isLoading ? <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" /> : null}
        {(query.data ?? []).map((template) => (
          <TemplateEditor key={`${template.type}-${template.id ?? 'default'}-${template.updatedAt ?? ''}`} template={template} canEdit={canEdit} />
        ))}
      </div>
      <Card className="h-fit p-5">
        <h3 className="text-sm font-semibold">Variáveis</h3>
        <p className="mt-1 text-[0.8125rem] text-[var(--color-text-muted)]">Preenchidas com os dados reais no momento do envio.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {TEMPLATE_VARIABLES.map((variable) => (
            <li key={variable} className="text-[0.8125rem]">
              <code className="rounded-[var(--radius-xs)] bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-[0.75rem]">{`{{${variable}}}`}</code>
              <span className="ml-2 text-[var(--color-text-muted)]">{TEMPLATE_VARIABLE_LABELS[variable]}</span>
            </li>
          ))}
        </ul>
        {!canEdit ? <p className="mt-4 text-[0.75rem] text-[var(--color-text-subtle)]">Somente administradores editam os templates.</p> : null}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pagina
--------------------------------------------------------------------------- */

export function MessagesPage() {
  const [tab, setTab] = useState<Tab>('history');
  const [result, setResult] = useState<SendMessageResultDto | null>(null);
  const status = useQuery({
    queryKey: ['messages', 'whatsapp-status'],
    queryFn: () => api.get<WhatsappStatusDto>('/messages/whatsapp/status'),
  });

  return (
    <>
      <PageHeader title="Mensagens" description="WhatsApp com os clientes: histórico, lembretes e textos prontos." />
      {status.data ? <ConnectionBanner status={status.data} /> : <Skeleton className="mb-5 h-20 w-full rounded-[var(--radius-lg)]" />}
      {result ? <SendResultNotice result={result} onClose={() => setResult(null)} /> : null}
      <SegmentedControl
        label="Seções de mensagens"
        value={tab}
        onChange={setTab}
        className="mb-4 w-full sm:w-auto"
        options={[
          { value: 'history', label: 'Histórico' },
          { value: 'reminders', label: 'Lembretes' },
          { value: 'templates', label: 'Templates' },
        ]}
      />
      {tab === 'history' ? <HistoryTab /> : null}
      {tab === 'reminders' ? <RemindersTab /> : null}
      {tab === 'templates' ? <TemplatesTab /> : null}
    </>
  );
}
