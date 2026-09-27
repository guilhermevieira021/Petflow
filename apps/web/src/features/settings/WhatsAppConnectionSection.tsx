import type { Tenant, WhatsappConnectionDto, WhatsappSetupDto, WhatsappTestResultDto } from '@petflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, MessageCircle, PlugZap } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TextField } from '@/components/ui/Field';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatPhone } from '@/lib/format';

/**
 * WhatsApp Business DO PET SHOP (API oficial da Meta).
 *
 * Conectar usa o Embedded Signup da Meta (fluxo oficial para SaaS): o
 * navegador so recebe um `code` e os IDs; a troca por token acontece no
 * servidor, e o token fica criptografado la. Nada de WhatsApp Web/QR Code.
 * Sem o app da Meta configurado no servidor, ha a conexao manual (avancado).
 */

const CONNECTION_KEY = ['messages', 'whatsapp-connection'] as const;

interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/** Carrega o SDK oficial do Facebook uma unica vez. */
function loadFacebookSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error('SDK da Meta indisponível.'));
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK da Meta.'));
    document.body.appendChild(script);
  });
}

/** "+55 11 98765-4321" (formato da Meta) -> "(11) 98765-4321". */
export function formatWhatsappNumber(raw: string | null | undefined): string {
  if (!raw) return '--';
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits;
  return local.length === 10 || local.length === 11 ? formatPhone(local) : raw;
}

function ManualConnectForm({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      api.post<WhatsappConnectionDto>('/messages/whatsapp/connection/manual', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
      toast.success('WhatsApp conectado.');
      onDone();
    },
  });
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      wabaId: String(data.get('wabaId') ?? '').trim(),
      phoneNumberId: String(data.get('phoneNumberId') ?? '').trim(),
      accessToken: String(data.get('accessToken') ?? '').trim(),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4"
    >
      <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
        Use os dados da sua conta no Meta Business (WhatsApp Manager). O token deve ser de um usuário de sistema, com permissão
        <code className="mx-1 font-mono text-[0.75rem]">whatsapp_business_messaging</code>. Ele é guardado criptografado e nunca é
        exibido de novo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="ID da conta do WhatsApp Business (WABA)"
          name="wabaId"
          inputMode="numeric"
          required
          error={apiError?.fieldError('wabaId')}
        />
        <TextField
          label="ID do número de telefone"
          name="phoneNumberId"
          inputMode="numeric"
          required
          error={apiError?.fieldError('phoneNumberId')}
        />
      </div>
      <TextField
        label="Token de acesso"
        name="accessToken"
        type="password"
        autoComplete="off"
        required
        error={apiError?.fieldError('accessToken')}
      />
      {apiError && apiError.fields.length === 0 ? (
        <p role="alert" className="text-[0.8125rem] text-[var(--color-danger)]">
          {apiError.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={disabled}>
          Validar e conectar
        </Button>
      </div>
    </form>
  );
}

export function WhatsAppConnectionSection({ tenant, readOnly }: { tenant: Tenant; readOnly: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [manual, setManual] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [lastTest, setLastTest] = useState<WhatsappTestResultDto | null>(null);
  const [connecting, setConnecting] = useState(false);
  const signupData = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const connection = useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: () => api.get<WhatsappConnectionDto>('/messages/whatsapp/connection'),
  });
  const setup = useQuery({
    queryKey: ['messages', 'whatsapp-setup'],
    queryFn: () => api.get<WhatsappSetupDto>('/messages/whatsapp/setup'),
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['messages'] });
  }

  const embedded = useMutation({
    mutationFn: (payload: { code: string; wabaId: string; phoneNumberId: string }) =>
      api.post<WhatsappConnectionDto>('/messages/whatsapp/connection/embedded', payload),
    onSuccess: async () => {
      await refresh();
      toast.success('WhatsApp Business conectado.');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível conectar.'),
    onSettled: () => setConnecting(false),
  });

  const test = useMutation({
    mutationFn: () => api.post<WhatsappTestResultDto>('/messages/whatsapp/connection/test'),
    onSuccess: async (result) => {
      setLastTest(result);
      await refresh();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível testar.'),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete('/messages/whatsapp/connection'),
    onSuccess: async () => {
      setConfirmDisconnect(false);
      setLastTest(null);
      await refresh();
      toast.success('WhatsApp desconectado. As mensagens voltam a ficar registradas para envio manual.');
    },
  });

  // O Embedded Signup avisa os IDs (WABA e numero) por postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          signupData.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        }
      } catch {
        // Mensagens de outros widgets do Facebook: ignoradas.
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function startEmbeddedSignup(): Promise<void> {
    const config = setup.data?.embeddedSignup;
    if (!config?.available || !config.appId || !config.configId) return;
    setConnecting(true);
    signupData.current = {};
    try {
      const sdk = await loadFacebookSdk(config.appId, config.graphVersion);
      sdk.login(
        (response) => {
          const code = response.authResponse?.code;
          const { wabaId, phoneNumberId } = signupData.current;
          if (!code || !wabaId || !phoneNumberId) {
            setConnecting(false);
            if (response.status !== 'unknown') toast.error('A conexão com a Meta não foi concluída.');
            return;
          }
          embedded.mutate({ code, wabaId, phoneNumberId });
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      );
    } catch (error) {
      setConnecting(false);
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir a Meta.');
    }
  }

  const data = connection.data;
  const setupData = setup.data;
  const connected = data?.status === 'CONNECTED' || data?.status === 'ERROR';

  return (
    <Card>
      <CardHeader
        title="WhatsApp"
        description="Mensagens do sistema saindo pelo WhatsApp Business do seu pet shop."
        icon={<MessageCircle className="size-4" />}
      />
      <CardBody className="flex flex-col gap-4">
        {connection.isLoading ? <Skeleton className="h-24 w-full" /> : null}

        {data && !connected ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning-subtle)] p-4">
              <p className="flex items-center gap-2 font-semibold">
                <PlugZap aria-hidden className="size-4 text-[var(--color-warning)]" />
                WhatsApp não conectado
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Conecte o WhatsApp Business do seu pet shop para enviar confirmações, lembretes e mensagens aos seus clientes.
              </p>
              <p className="mt-2 text-[0.8125rem] text-[var(--color-text-muted)]">
                Enquanto isso, as mensagens ficam registradas como "não enviadas" e podem ser enviadas pelo link do WhatsApp.
              </p>
            </div>

            {!readOnly ? (
              setupData?.embeddedSignup.available && setupData.storageReady ? (
                <Button
                  className="self-start"
                  loading={connecting || embedded.isPending}
                  onClick={() => void startEmbeddedSignup()}
                >
                  Conectar WhatsApp Business
                </Button>
              ) : (
                <div className="flex flex-col gap-3">
                  <Button className="self-start" disabled title="Conexão automática indisponível">
                    Conectar WhatsApp Business
                  </Button>
                  <p className="flex items-start gap-1.5 text-[0.8125rem] text-[var(--color-text-muted)]">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warning)]" />
                    {setupData && !setupData.storageReady
                      ? 'A conexão ainda não está disponível: falta configurar no servidor a chave que protege os tokens do WhatsApp.'
                      : 'A conexão automática com a Meta ainda não foi habilitada no Petflow. Se você já tem uma conta no WhatsApp Business Platform, pode conectar com os dados dela.'}
                  </p>
                  {setupData?.storageReady ? (
                    manual ? (
                      <ManualConnectForm onDone={() => setManual(false)} disabled={false} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setManual(true)}
                        className="self-start text-[0.8125rem] font-medium text-[var(--color-brand-text)] hover:underline"
                      >
                        Conectar com os dados da Meta (avançado)
                      </button>
                    )
                  ) : null}
                </div>
              )
            ) : (
              <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Somente o proprietário pode conectar o WhatsApp.</p>
            )}
          </div>
        ) : null}

        {data && connected ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success-subtle)] p-4">
              <p className="flex items-center gap-2 font-semibold text-[var(--color-success)]">
                <CheckCircle2 aria-hidden className="size-4" />
                WhatsApp conectado
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Número</dt>
                  <dd className="tabular font-semibold">
                    {data.displayPhoneNumber ? formatWhatsappNumber(data.displayPhoneNumber) : data.phoneNumberId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Nome verificado</dt>
                  <dd className="font-medium">{data.verifiedName ?? '--'}</dd>
                </div>
                <div>
                  <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Conectado</dt>
                  <dd>
                    {data.method === 'EMBEDDED_SIGNUP' ? 'Pela Meta (Embedded Signup)' : 'Manual'}
                    {data.connectedAt ? ` · ${formatDateTime(data.connectedAt, tenant.timezone)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.75rem] text-[var(--color-text-muted)]">Token</dt>
                  <dd className="tabular">{data.tokenHint ?? '--'} (guardado criptografado)</dd>
                </div>
              </dl>
            </div>

            {!data.cloudApiReady ? (
              <p className="flex items-start gap-1.5 text-[0.8125rem] text-[var(--color-warning)]">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />A Meta ainda não registrou este número na Cloud
                API. Conclua o registro no WhatsApp Manager para enviar mensagens.
              </p>
            ) : null}
            {data.status === 'ERROR' || data.lastError ? (
              <p role="alert" className="flex items-start gap-1.5 text-[0.8125rem] text-[var(--color-danger)]">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {data.lastError ?? 'O último teste de conexão falhou.'}
              </p>
            ) : null}
            {lastTest ? (
              <p
                role="status"
                className={
                  lastTest.ok ? 'text-[0.8125rem] text-[var(--color-success)]' : 'text-[0.8125rem] text-[var(--color-danger)]'
                }
              >
                {lastTest.message}
              </p>
            ) : null}

            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
                  Testar conexão
                </Button>
                <Button variant="danger" onClick={() => setConfirmDisconnect(true)}>
                  Desconectar
                </Button>
              </div>
            ) : null}
            {data.lastCheckedAt ? (
              <p className="text-[0.75rem] text-[var(--color-text-subtle)]">
                Última verificação: {formatDateTime(data.lastCheckedAt, tenant.timezone)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-[var(--color-border)] pt-4">
          <p className="text-[0.8125rem] text-[var(--color-text-muted)]">Número de contato exibido para os clientes</p>
          <p className="mt-0.5 text-sm font-medium">
            {tenant.whatsapp ? formatPhone(tenant.whatsapp) : 'Não configurado -- defina na aba Empresa'}
          </p>
        </div>
      </CardBody>

      <ConfirmDialog
        open={confirmDisconnect}
        title="Desconectar o WhatsApp?"
        description="O token é apagado do Petflow. As mensagens voltam a ficar registradas para envio manual pelo link do WhatsApp."
        confirmLabel="Desconectar"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </Card>
  );
}
