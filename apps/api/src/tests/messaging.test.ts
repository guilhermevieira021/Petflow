import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CloudApiProvider,
  setWhatsappProviderForTests,
  WhatsappSendError,
  type WhatsappProvider,
} from '../integrations/whatsapp/whatsapp.provider.js';
import { renderTemplate, toWhatsappRecipient } from '../modules/messages/whatsapp.service.js';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  errorCode,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/**
 * WhatsApp: templates, composicao com dados reais, e a regra critica --
 * NUNCA marcar como enviada uma mensagem que so foi registrada.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let customerA: string;
let petA: string;
let appointmentA: string;

interface MessageBody {
  id: string;
  status: string;
  content: string;
  recipient: string | null;
  provider: string | null;
  failureReason: string | null;
  type: string;
  appointmentId: string | null;
}

interface SendBody {
  delivered: boolean;
  manualLink: string | null;
  notice: string;
  message: MessageBody;
}

/** Provider falso, controlado pelo teste -- simula a API oficial conectada. */
class FakeCloudProvider implements WhatsappProvider {
  readonly kind = 'cloud_api' as const;
  readonly configured = true;
  sent: { to: string; body: string }[] = [];
  constructor(private readonly behaviour: 'accept' | 'reject') {}
  async send(to: string, body: string) {
    if (this.behaviour === 'reject') throw new WhatsappSendError('WhatsApp recusou a mensagem: fora da janela de 24h');
    this.sent.push({ to, body });
    return { providerMessageId: `wamid.${this.sent.length}` };
  }
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Mensagens A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Mensagens B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });

  const customer = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: 'Juliana Mensagem', phone: '11988887777', whatsapp: '11977776666' },
  });
  customerA = customer.json<{ id: string }>().id;
  const pet = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId: customerA, name: 'Bolinha', species: 'DOG' },
  });
  petA = pet.json<{ id: string }>().id;
  const service = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/services',
    payload: { name: 'Banho Mensagem', durationMinutes: 30, price: 50 },
  });
  const appointment = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/appointments',
    payload: {
      customerId: customerA,
      petId: petA,
      serviceId: service.json<{ id: string }>().id,
      startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  appointmentA = appointment.json<{ id: string }>().id;
});

afterEach(() => setWhatsappProviderForTests(null));

afterAll(async () => {
  await teardownTestApp();
});

describe('unidade', () => {
  it('renderTemplate substitui variaveis e aponta as que ficaram sem dado', () => {
    expect(
      renderTemplate('Oi {{nome_cliente}}, {{nome_pet}} em {{data}}', { nome_cliente: 'Ana', nome_pet: 'Rex' }),
    ).toEqual({
      content: 'Oi Ana, Rex em {{data}}',
      missing: ['data'],
    });
  });

  it('renderTemplate aceita os nomes antigos ({{cliente}}, {{pet}}, {{petshop}})', () => {
    expect(
      renderTemplate('Oi {{cliente}}, {{pet}} -- {{petshop}}', { nome_cliente: 'Ana', nome_pet: 'Rex', nome_petshop: 'Loja' }),
    ).toEqual({ content: 'Oi Ana, Rex -- Loja', missing: [] });
  });

  it('renderTemplate nunca deixa passar variavel desconhecida ou chave mal formada', () => {
    expect(renderTemplate('Oi {{apelido}}', { nome_cliente: 'Ana' }).missing).toEqual(['apelido']);
    expect(renderTemplate('Oi {{nome cliente}}', { nome_cliente: 'Ana' }).missing).toEqual(['formato']);
    expect(renderTemplate('Oi {{nome_cliente}', { nome_cliente: 'Ana' }).missing).toEqual(['formato']);
  });

  it('destinatario vira numero internacional com 55', () => {
    expect(toWhatsappRecipient('(11) 97777-6666')).toBe('5511977776666');
    expect(toWhatsappRecipient('5511977776666')).toBe('5511977776666');
  });

  it('CloudApiProvider chama a Graph API e devolve o id da mensagem', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new CloudApiProvider({ apiUrl: 'https://graph.test/v21.0', accessToken: 'token-x', phoneNumberId: '123' }, fakeFetch);
    const result = await provider.send('5511977776666', 'Ola');
    expect(result.providerMessageId).toBe('wamid.ABC');
    expect(calls[0]?.url).toBe('https://graph.test/v21.0/123/messages');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer token-x');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ to: '5511977776666', type: 'text', text: { body: 'Ola' } });
  });

  it('CloudApiProvider converte recusa da API em erro (sem vazar o token)', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Re-engagement message' } }), { status: 400 })) as unknown as typeof fetch;
    const provider = new CloudApiProvider({ apiUrl: 'https://graph.test', accessToken: 'segredo', phoneNumberId: '1' }, fakeFetch);
    await expect(provider.send('5511977776666', 'x')).rejects.toThrow(/Re-engagement message/);
    await expect(provider.send('5511977776666', 'x')).rejects.not.toThrow(/segredo/);
  });
});

describe('templates', () => {
  it('lista os templates padrao enquanto o pet shop nao personaliza', async () => {
    const response = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages/templates' });
    const templates = response.json<{ type: string; isDefault: boolean }[]>();
    expect(templates.map((template) => template.type)).toEqual(
      expect.arrayContaining(['APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION', 'RETURN_INVITE']),
    );
    expect(templates.every((template) => template.isDefault)).toBe(true);
  });

  it('personaliza um template automatico e recusa variavel desconhecida (422)', async () => {
    const saved = await authed(server, shopA.owner, {
      method: 'PUT',
      url: '/api/messages/templates/type/APPOINTMENT_CONFIRMATION',
      payload: { name: 'Confirmacao', body: 'Oi {{cliente}}! {{pet}} confirmado para {{data}} {{horario}}.', active: true },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ isDefault: boolean }>().isDefault).toBe(false);

    const invalid = await authed(server, shopA.owner, {
      method: 'PUT',
      url: '/api/messages/templates/type/APPOINTMENT_REMINDER',
      payload: { name: 'Lembrete', body: 'Oi {{senha}}' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('STAFF nao edita templates (403) e o outro pet shop continua com o padrao', async () => {
    const forbidden = await authed(server, staffA, {
      method: 'POST',
      url: '/api/messages/templates',
      payload: { name: 'Promo', body: 'Oi {{cliente}}' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(errorCode(forbidden.body)).toBe('INSUFFICIENT_PERMISSION');

    const otherShop = await authed(server, shopB.owner, { method: 'GET', url: '/api/messages/templates' });
    const confirmation = otherShop
      .json<{ type: string; isDefault: boolean }[]>()
      .find((template) => template.type === 'APPOINTMENT_CONFIRMATION');
    expect(confirmation?.isDefault).toBe(true);
  });
});

describe('envio', () => {
  it('SEM API conectada: registra como DRAFT, delivered=false, oferece link -- nunca SENT', async () => {
    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customerA, appointmentId: appointmentA, templateType: 'APPOINTMENT_REMINDER' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<SendBody>();
    expect(body.delivered).toBe(false);
    expect(body.message.status).toBe('DRAFT');
    expect(body.message.recipient).toBe('5511977776666');
    expect(body.message.content).toContain('Bolinha');
    expect(body.message.content).not.toContain('{{');
    expect(body.manualLink).toMatch(/^https:\/\/wa\.me\/5511977776666\?text=/);
    expect(body.notice).toMatch(/NAO foi enviada/);
  });

  it('COM API conectada (aceite): SENT com o id do provider e o texto real enviado', async () => {
    const provider = new FakeCloudProvider('accept');
    setWhatsappProviderForTests(provider);
    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customerA, petId: petA, content: 'Oi {{cliente}}, o {{pet}} esta pronto!' },
    });
    const body = response.json<SendBody>();
    expect(body.delivered).toBe(true);
    expect(body.message.status).toBe('SENT');
    expect(body.manualLink).toBeNull();
    expect(provider.sent).toEqual([{ to: '5511977776666', body: 'Oi Juliana, o Bolinha esta pronto!' }]);
  });

  it('texto com variavel sem dado e recusado antes de sair (422)', async () => {
    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customerA, content: 'Seu horario e {{horario}}' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('COM API conectada (recusa): FAILED com o motivo, delivered=false', async () => {
    setWhatsappProviderForTests(new FakeCloudProvider('reject'));
    const response = await authed(server, staffA, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customerA, petId: petA, templateType: 'RETURN_INVITE' },
    });
    const body = response.json<SendBody>();
    expect(body.delivered).toBe(false);
    expect(body.message.status).toBe('FAILED');
    expect(body.message.failureReason).toMatch(/24h/);
  });

  it('o pet shop B nao envia mensagem para cliente do A (404)', async () => {
    const response = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/messages/send',
      payload: { customerId: customerA, content: 'Oi' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('disparo automatico por status do agendamento', () => {
  it('desligado (padrao): confirmar o agendamento nao gera mensagem', async () => {
    await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentA}/status`,
      payload: { status: 'CONFIRMED' },
    });
    const list = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/messages?appointmentId=${appointmentA}&type=APPOINTMENT_CONFIRMATION`,
    });
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it('ligado + API conectada: cancelar envia o aviso de cancelamento de verdade', async () => {
    await authed(server, shopA.owner, {
      method: 'PATCH',
      url: '/api/tenants/current',
      payload: { settings: { automationEnabled: true } },
    });
    const provider = new FakeCloudProvider('accept');
    setWhatsappProviderForTests(provider);

    const cancelled = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentA}/status`,
      payload: { status: 'CANCELLED', reason: 'Cliente pediu' },
    });
    expect(cancelled.statusCode).toBe(200);

    const list = await authed(server, shopA.owner, {
      method: 'GET',
      url: `/api/messages?appointmentId=${appointmentA}&type=APPOINTMENT_CANCELLATION`,
    });
    const [message] = list.json<{ data: MessageBody[] }>().data;
    expect(message).toMatchObject({ status: 'SENT', provider: 'cloud_api' });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.body).toContain('Bolinha');
  });
});
