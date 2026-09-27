import type { Tenant } from '@petflow/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatWhatsappNumber, WhatsAppConnectionSection } from './WhatsAppConnectionSection';

/** Configuracoes > WhatsApp: estado real vindo do servidor, nunca o token. */

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toast }));

const TENANT = { id: 't1', name: 'Pet Teste', whatsapp: '11911112222', timezone: 'America/Sao_Paulo' } as unknown as Tenant;

const DISCONNECTED = {
  status: 'DISCONNECTED',
  method: null,
  wabaId: null,
  phoneNumberId: null,
  displayPhoneNumber: null,
  verifiedName: null,
  cloudApiReady: false,
  tokenHint: null,
  connectedAt: null,
  lastCheckedAt: null,
  lastError: null,
};
const CONNECTED = {
  ...DISCONNECTED,
  status: 'CONNECTED',
  method: 'MANUAL',
  wabaId: '111',
  phoneNumberId: '222',
  displayPhoneNumber: '+55 11 98765-4321',
  verifiedName: 'Pet Teste',
  cloudApiReady: true,
  tokenHint: '••••AAAA',
  connectedAt: '2026-09-01T12:00:00.000Z',
};
const SETUP_MANUAL_ONLY = {
  embeddedSignup: { available: false, appId: null, configId: null, graphVersion: 'v21.0' },
  storageReady: true,
  webhookConfigured: true,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let connection: unknown = DISCONNECTED;
let setup: unknown = SETUP_MANUAL_ONLY;
const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  // jsdom nao implementa <dialog>.showModal/close.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  connection = DISCONNECTED;
  setup = SETUP_MANUAL_ONLY;
  calls.length = 0;
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/whatsapp/setup')) return json(200, setup);
      if (url.endsWith('/whatsapp/connection/manual')) {
        connection = CONNECTED;
        return json(201, CONNECTED);
      }
      if (url.endsWith('/whatsapp/connection/test')) return json(200, { ok: true, message: 'Conexão com a Meta funcionando.' });
      if (url.endsWith('/whatsapp/connection') && method === 'DELETE') {
        connection = DISCONNECTED;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/whatsapp/connection')) return json(200, connection);
      return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderSection(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WhatsAppConnectionSection tenant={TENANT} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe('WhatsApp do pet shop', () => {
  it('formata o número vindo da Meta', () => {
    expect(formatWhatsappNumber('+55 11 98765-4321')).toBe('(11) 98765-4321');
    expect(formatWhatsappNumber('+1 555-0100')).toBe('+1 555-0100');
  });

  it('sem conexão mostra o estado honesto e o botão de conectar', async () => {
    renderSection();
    expect(await screen.findByText('WhatsApp não conectado')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Conecte o WhatsApp Business do seu pet shop para enviar confirmações, lembretes e mensagens aos seus clientes.',
      ),
    ).toBeInTheDocument();
    // Sem o app da Meta configurado, o botao automatico fica desabilitado e explica o motivo.
    expect(await screen.findByRole('button', { name: 'Conectar WhatsApp Business' })).toBeDisabled();
    expect(screen.getByText(/conexão automática com a Meta ainda não foi habilitada/)).toBeInTheDocument();
  });

  it('com o Embedded Signup configurado o botão fica disponível', async () => {
    setup = { ...SETUP_MANUAL_ONLY, embeddedSignup: { available: true, appId: '123', configId: '456', graphVersion: 'v21.0' } };
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conectar WhatsApp Business' })).toBeEnabled());
  });

  it('conexão manual envia os IDs e passa a mostrar o número conectado', async () => {
    renderSection();
    fireEvent.click(await screen.findByText('Conectar com os dados da Meta (avançado)'));
    fireEvent.change(screen.getByLabelText(/WABA/), { target: { value: '111' } });
    fireEvent.change(screen.getByLabelText(/ID do número de telefone/), { target: { value: '222' } });
    fireEvent.change(screen.getByLabelText(/Token de acesso/), { target: { value: 'EAAG-secreto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e conectar' }));

    expect(await screen.findByText('WhatsApp conectado')).toBeInTheDocument();
    expect(screen.getByText('(11) 98765-4321')).toBeInTheDocument();
    expect(screen.getByText(/••••AAAA/)).toBeInTheDocument();
    expect(screen.queryByText(/EAAG-secreto/)).not.toBeInTheDocument();
    const manual = calls.find((call) => call.url.endsWith('/connection/manual'));
    expect(manual?.body).toEqual({ wabaId: '111', phoneNumberId: '222', accessToken: 'EAAG-secreto' });
  });

  it('conectado: testar e desconectar (com confirmação)', async () => {
    connection = CONNECTED;
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Testar conexão' }));
    expect(await screen.findByText('Conexão com a Meta funcionando.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    expect(await screen.findByText('Desconectar o WhatsApp?')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Desconectar' });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(await screen.findByText('WhatsApp não conectado')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('quem não é proprietário vê o estado, mas não as ações', async () => {
    connection = CONNECTED;
    renderSection(true);
    expect(await screen.findByText('WhatsApp conectado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Testar conexão' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
  });
});
