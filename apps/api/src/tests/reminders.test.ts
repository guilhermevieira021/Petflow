import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CloudApiProvider,
  setWhatsappProviderForTests,
  WhatsappSendError,
  type WhatsappProvider,
} from '../integrations/whatsapp/whatsapp.provider.js';
import { processDueReminders } from '../modules/messages/reminders.service.js';
import {
  authed,
  createTenantWithOwner,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/**
 * Fase 3 -- WhatsApp: variaveis {{nome_cliente}} etc., reagendamento,
 * pos-atendimento e lembretes com GERACAO separada do ENVIO. Regra critica:
 * nada e marcado como enviado sem aceite da API.
 */

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let customerId: string;
let petId: string;
let serviceId: string;

interface Reminder {
  id: string;
  appointmentId: string;
  status: string;
  note: string | null;
  messageId: string | null;
  scheduledAt: string;
  appointmentStartsAt: string;
}
interface Message {
  id: string;
  type: string;
  status: string;
  content: string;
  appointmentId: string | null;
  failureReason: string | null;
}

class FakeProvider implements WhatsappProvider {
  readonly kind = 'cloud_api' as const;
  readonly configured = true;
  sent: string[] = [];
  constructor(private readonly behaviour: 'accept' | 'reject') {}
  async send(_to: string, body: string) {
    if (this.behaviour === 'reject') throw new WhatsappSendError('WhatsApp recusou a mensagem: numero invalido');
    this.sent.push(body);
    return { providerMessageId: `wamid.r${this.sent.length}` };
  }
}

const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString();

async function book(startsAt: string): Promise<string> {
  const response = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/appointments',
    payload: { customerId, petId, serviceId, startsAt },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

async function remindersOf(session: TestSession, status?: string): Promise<Reminder[]> {
  const response = await authed(server, session, {
    method: 'GET',
    url: `/api/messages/reminders${status ? `?status=${status}` : ''}`,
  });
  return response.json<{ data: Reminder[] }>().data;
}

async function messagesOf(appointmentId: string): Promise<Message[]> {
  const response = await authed(server, shopA.owner, { method: 'GET', url: `/api/messages?appointmentId=${appointmentId}` });
  return response.json<{ data: Message[] }>().data;
}

function processNow(session: TestSession, payload: Record<string, unknown> = {}) {
  return authed(server, session, { method: 'POST', url: '/api/messages/reminders/process', payload });
}

async function setStatus(appointmentId: string, status: string) {
  const response = await authed(server, shopA.owner, {
    method: 'PATCH',
    url: `/api/appointments/${appointmentId}/status`,
    payload: { status },
  });
  expect(response.statusCode).toBe(200);
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Lembretes A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Lembretes B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  const customer = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: 'João Tutor', phone: '11988887777' },
  });
  customerId = customer.json<{ id: string }>().id;
  const pet = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/pets',
    payload: { customerId, name: 'Thor', species: 'DOG' },
  });
  petId = pet.json<{ id: string }>().id;
  const service = await authed(server, shopA.owner, {
    method: 'POST',
    url: '/api/services',
    payload: { name: 'Banho', durationMinutes: 60, price: 60 },
  });
  serviceId = service.json<{ id: string }>().id;
});

afterEach(() => setWhatsappProviderForTests(null));

afterAll(async () => {
  await teardownTestApp();
});

describe('templates e variaveis', () => {
  it('templates automaticos incluem reagendamento e pos-atendimento, com as variaveis novas', async () => {
    const response = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages/templates' });
    const templates = response.json<{ type: string; body: string }[]>();
    const types = templates.map((template) => template.type);
    for (const type of ['APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULE', 'POST_SERVICE_FOLLOWUP']) {
      expect(types).toContain(type);
    }
    const reminder = templates.find((template) => template.type === 'APPOINTMENT_REMINDER');
    expect(reminder?.body).toContain('{{nome_cliente}}');
    expect(reminder?.body).toContain('{{nome_pet}}');
  });

  it('template com variavel desconhecida ou mal escrita e recusado', async () => {
    for (const body of ['Oi {{apelido}}', 'Oi {{nome cliente}}', 'Oi {{nome_cliente}']) {
      const response = await authed(server, shopA.owner, {
        method: 'PUT',
        url: '/api/messages/templates/type/APPOINTMENT_REMINDER',
        payload: { name: 'Lembrete', body, active: true },
      });
      expect(response.statusCode).toBe(422);
    }
  });

  it('previa substitui todas as variaveis com dados reais', async () => {
    const appointmentId = await book(hours(30));
    const preview = await authed(server, shopA.owner, {
      method: 'POST',
      url: '/api/messages/preview',
      payload: { customerId, appointmentId, templateType: 'APPOINTMENT_REMINDER' },
    });
    const { content, missingVariables } = preview.json<{ content: string; missingVariables: string[] }>();
    expect(missingVariables).toEqual([]);
    expect(content).toMatch(/^Olá, João! O Thor tem Banho agendado em \d{2}\/\d{2} às \d{2}:\d{2}\. Até lá! — Pet Shop Lembretes A$/);
    expect(content).not.toContain('{{');
    await setStatus(appointmentId, 'CANCELLED');
  });
});

describe('lembretes: geracao', () => {
  it('criar agendamento AGENDA o lembrete (inicio - antecedencia) e nao envia nada', async () => {
    const startsAt = hours(48);
    const appointmentId = await book(startsAt);
    const pending = (await remindersOf(shopA.owner, 'PENDING')).filter((reminder) => reminder.appointmentId === appointmentId);
    expect(pending).toHaveLength(1);
    const expected = new Date(startsAt).getTime() - 24 * 3_600_000;
    expect(Math.abs(new Date(pending[0]!.scheduledAt).getTime() - expected)).toBeLessThan(5_000);
    expect(await messagesOf(appointmentId)).toHaveLength(0);

    // Ainda nao venceu: processar agora nao gera nada para ele.
    const result = (await processNow(shopA.owner)).json<{ processed: number }>();
    expect(result.processed).toBe(0);
    expect((await remindersOf(shopA.owner, 'PENDING')).some((reminder) => reminder.appointmentId === appointmentId)).toBe(true);
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('cancelar o agendamento cancela o lembrete pendente', async () => {
    const cancelled = (await remindersOf(shopA.owner, 'CANCELLED')).map((reminder) => reminder.appointmentId);
    expect(cancelled.length).toBeGreaterThanOrEqual(2);
    expect(await remindersOf(shopA.owner, 'PENDING')).toHaveLength(0);
  });

  it('status do agendador informa que nao ha processamento automatico', async () => {
    const status = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages/reminders/status' });
    expect(status.json()).toMatchObject({ automaticProcessing: false, reminderHours: 24 });
  });
});

describe('lembretes: envio', () => {
  it('sem WhatsApp configurado: mensagem REGISTRADA (DRAFT), lembrete REGISTERED, nunca "enviado"', async () => {
    const appointmentId = await book(hours(5));
    const response = await processNow(shopA.owner);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ processed: 1, sent: 0, registered: 1, failed: 0, providerConnected: false });
    expect(response.json<{ notice: string }>().notice).toContain('NÃO enviado');

    const [reminder] = (await remindersOf(shopA.owner, 'REGISTERED')).filter((item) => item.appointmentId === appointmentId);
    expect(reminder?.messageId).toBeTruthy();
    const [message] = await messagesOf(appointmentId);
    expect(message).toMatchObject({ id: reminder?.messageId, type: 'APPOINTMENT_REMINDER', status: 'DRAFT' });
    expect(message?.content).toContain('Thor');

    // Idempotente: processar de novo nao duplica.
    expect((await processNow(shopA.owner)).json<{ processed: number }>().processed).toBe(0);
    expect(await messagesOf(appointmentId)).toHaveLength(1);
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('com a API configurada e aceita: SENT so depois do aceite', async () => {
    const provider = new FakeProvider('accept');
    setWhatsappProviderForTests(provider);
    const appointmentId = await book(hours(6));
    const result = (await processNow(shopA.owner)).json<{ sent: number; registered: number }>();
    expect(result).toMatchObject({ sent: 1, registered: 0 });
    expect(provider.sent).toHaveLength(1);
    expect((await remindersOf(shopA.owner, 'SENT')).some((item) => item.appointmentId === appointmentId)).toBe(true);
    const [message] = (await messagesOf(appointmentId)).filter((item) => item.type === 'APPOINTMENT_REMINDER');
    expect(message?.status).toBe('SENT');
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('erro da API: FAILED com o motivo, sem fingir envio', async () => {
    setWhatsappProviderForTests(new FakeProvider('reject'));
    const appointmentId = await book(hours(7));
    const result = (await processNow(shopA.owner)).json<{ sent: number; failed: number }>();
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    const [reminder] = (await remindersOf(shopA.owner, 'FAILED')).filter((item) => item.appointmentId === appointmentId);
    expect(reminder?.note).toContain('numero invalido');
    const [message] = (await messagesOf(appointmentId)).filter((item) => item.type === 'APPOINTMENT_REMINDER');
    expect(message).toMatchObject({ status: 'FAILED' });
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('template de lembrete desativado: lembrete SKIPPED, nenhuma mensagem', async () => {
    await authed(server, shopA.owner, {
      method: 'PUT',
      url: '/api/messages/templates/type/APPOINTMENT_REMINDER',
      payload: { name: 'Lembrete', body: 'Oi {{nome_cliente}}, até {{data}}!', active: false },
    });
    const appointmentId = await book(hours(8));
    const result = (await processNow(shopA.owner)).json<{ skipped: number; registered: number }>();
    expect(result).toMatchObject({ skipped: 1, registered: 0 });
    expect(await messagesOf(appointmentId)).toHaveLength(0);
    await authed(server, shopA.owner, { method: 'DELETE', url: '/api/messages/templates/type/APPOINTMENT_REMINDER' });
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('processar com antecedencia inclui os lembretes das proximas horas', async () => {
    const appointmentId = await book(hours(40));
    expect((await processNow(shopA.owner)).json<{ processed: number }>().processed).toBe(0);
    const ahead = (await processNow(shopA.owner, { aheadHours: 24 })).json<{ processed: number; registered: number }>();
    expect(ahead).toMatchObject({ processed: 1, registered: 1 });
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('worker automatico (trigger scheduled) so age com envio automatico autorizado', async () => {
    const appointmentId = await book(hours(4));
    const context = { tenantId: shopA.tenantId, userId: shopA.owner.userId };
    const blocked = await processDueReminders(context, { aheadHours: 0, trigger: 'scheduled' }, new FakeProvider('accept'));
    expect(blocked.processed).toBe(0);
    expect((await remindersOf(shopA.owner, 'PENDING')).some((item) => item.appointmentId === appointmentId)).toBe(true);
    await setStatus(appointmentId, 'CANCELLED');
  });
});

describe('reagendamento e pos-atendimento', () => {
  it('remarcar: lembrete antigo cancelado, novo agendado e aviso de reagendamento registrado', async () => {
    await authed(server, shopA.owner, {
      method: 'PATCH',
      url: '/api/tenants/current',
      payload: { settings: { automationEnabled: true } },
    });
    const appointmentId = await book(hours(50));
    const newStart = hours(74);
    const patch = await authed(server, shopA.owner, {
      method: 'PATCH',
      url: `/api/appointments/${appointmentId}`,
      payload: { startsAt: newStart },
    });
    expect(patch.statusCode).toBe(200);

    const ofAppointment = (await remindersOf(shopA.owner)).filter((item) => item.appointmentId === appointmentId);
    expect(ofAppointment.map((item) => item.status).sort()).toEqual(['CANCELLED', 'PENDING']);
    const pending = ofAppointment.find((item) => item.status === 'PENDING');
    expect(new Date(pending!.appointmentStartsAt).toISOString()).toBe(newStart);

    const [reschedule] = (await messagesOf(appointmentId)).filter((item) => item.type === 'APPOINTMENT_RESCHEDULE');
    expect(reschedule?.status).toBe('DRAFT');
    expect(reschedule?.content).toContain('remarcado');
    expect(reschedule?.content).not.toContain('{{');

    // A duracao original (60 min) e preservada ao remarcar so o inicio.
    const detail = await authed(server, shopA.owner, { method: 'GET', url: `/api/appointments/${appointmentId}` });
    const { startsAt, endsAt } = detail.json<{ startsAt: string; endsAt: string }>();
    expect(new Date(endsAt).getTime() - new Date(startsAt).getTime()).toBe(60 * 60_000);
    await setStatus(appointmentId, 'CANCELLED');
  });

  it('concluir o atendimento registra o pos-atendimento e encerra o lembrete', async () => {
    const appointmentId = await book(hours(30));
    await setStatus(appointmentId, 'IN_PROGRESS');
    await setStatus(appointmentId, 'COMPLETED');
    const [followup] = (await messagesOf(appointmentId)).filter((item) => item.type === 'POST_SERVICE_FOLLOWUP');
    expect(followup).toMatchObject({ status: 'DRAFT' });
    expect(followup?.content).toContain('Thor');
    const ofAppointment = (await remindersOf(shopA.owner)).filter((item) => item.appointmentId === appointmentId);
    expect(ofAppointment.map((item) => item.status)).toEqual(['CANCELLED']);
  });
});

describe('isolamento', () => {
  it('outro pet shop nao ve nem processa os lembretes do A', async () => {
    await book(hours(3));
    expect(await remindersOf(shopB.owner)).toHaveLength(0);
    const result = (await processNow(shopB.owner)).json<{ processed: number }>();
    expect(result.processed).toBe(0);
    expect((await remindersOf(shopA.owner, 'PENDING')).length).toBe(1);
  });
});

describe('CloudApiProvider: respostas problematicas', () => {
  const config = { apiUrl: 'https://graph.example/v21.0', accessToken: 'token-secreto', phoneNumberId: '123' };

  it('resposta 200 sem id da mensagem e tratada como falha (nao como envio)', async () => {
    const provider = new CloudApiProvider(config, (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch);
    await expect(provider.send('5511988887777', 'oi')).rejects.toThrow(/sem identificador/);
  });

  it('corpo invalido (nao JSON) tambem e falha', async () => {
    const provider = new CloudApiProvider(config, (async () => new Response('<html>erro</html>', { status: 200 })) as typeof fetch);
    await expect(provider.send('5511988887777', 'oi')).rejects.toThrow(WhatsappSendError);
  });

  it('timeout vira falha com mensagem clara e sem o token', async () => {
    const provider = new CloudApiProvider(config, (async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch);
    await expect(provider.send('5511988887777', 'oi')).rejects.toThrow('A API do WhatsApp nao respondeu a tempo.');
    await provider.send('5511988887777', 'oi').catch((error: Error) => expect(error.message).not.toContain('token-secreto'));
  });
});
