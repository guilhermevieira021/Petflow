import { createHmac, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystem } from '../db/context.js';
import { whatsappConnections } from '../db/schema/index.js';
import { setMetaAppConfigForTests } from '../integrations/whatsapp/meta-graph.js';
import { setMetaFetchForTests } from '../integrations/whatsapp/whatsapp.provider.js';
import { setWhatsappEncryptionKeyForTests } from '../modules/messages/whatsapp-connection.service.js';
import { setWhatsappWebhookConfigForTests } from '../modules/messages/whatsapp-webhook.service.js';
import {
  authed,
  createTenantWithOwner,
  createUserAndLogin,
  setupTestApp,
  teardownTestApp,
  upgradeToPro,
  type TestSession,
  type TestTenant,
} from './helpers.js';

/**
 * Fase 5 -- WhatsApp Business POR PET SHOP. Nenhum teste fala com a Meta de
 * verdade: uma "Graph API" falsa responde e registra cada chamada.
 */

const TOKEN_A = 'EAAG-token-do-pet-shop-A-0000AAAA';
const TOKEN_B = 'EAAG-token-do-pet-shop-B-1111BBBB';
const PHONE_A = '100000000000001';
const PHONE_B = '200000000000002';
const WABA_A = '300000000000003';
const WABA_B = '400000000000004';

interface GraphCall {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

let server: FastifyInstance;
let shopA: TestTenant;
let shopB: TestTenant;
let staffA: TestSession;
let customerA: string;
let customerB: string;
let calls: GraphCall[] = [];
let messageCounter = 0;

/** Graph API falsa: tokens conhecidos passam, o resto e 401. */
const fakeGraph: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const auth = headers.authorization ?? null;
  calls.push({ url, method: init?.method ?? 'GET', auth, body: init?.body ? JSON.parse(String(init.body)) : null });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url.includes('/oauth/access_token')) {
    return url.includes('code=codigo-valido-do-embedded-signup')
      ? json(200, { access_token: TOKEN_B, token_type: 'bearer' })
      : json(400, { error: { message: 'Invalid verification code format.' } });
  }
  const token = auth?.replace('Bearer ', '');
  if (token !== TOKEN_A && token !== TOKEN_B) return json(401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
  if (url.includes('/subscribed_apps')) return json(200, { success: true });
  if (url.includes('/messages')) {
    messageCounter += 1;
    return json(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.test.${messageCounter}` }] });
  }
  const phone = url.includes(PHONE_A) ? PHONE_A : url.includes(PHONE_B) ? PHONE_B : null;
  if (!phone) return json(404, { error: { message: 'Unsupported get request.' } });
  return json(200, {
    display_phone_number: phone === PHONE_A ? '+55 11 98888-0001' : '+55 21 97777-0002',
    verified_name: phone === PHONE_A ? 'Pet Shop A' : 'Pet Shop B',
    platform_type: 'CLOUD_API',
    id: phone,
  });
};

function connectManual(session: TestSession, payload: Record<string, unknown>) {
  return authed(server, session, { method: 'POST', url: '/api/messages/whatsapp/connection/manual', payload });
}

function connection(session: TestSession) {
  return authed(server, session, { method: 'GET', url: '/api/messages/whatsapp/connection' });
}

function send(session: TestSession, customerId: string, content: string) {
  return authed(server, session, { method: 'POST', url: '/api/messages/send', payload: { customerId, content } });
}

async function createCustomer(tenant: TestTenant, name: string): Promise<string> {
  const response = await authed(server, tenant.owner, { method: 'POST', url: '/api/customers', payload: { name, phone: '11988887777' } });
  return response.json<{ id: string }>().id;
}

beforeAll(async () => {
  server = await setupTestApp();
  shopA = await createTenantWithOwner(server, { tenantName: 'Pet Shop Zap A' });
  shopB = await createTenantWithOwner(server, { tenantName: 'Pet Shop Zap B' });
  await upgradeToPro(shopA.tenantId);
  await upgradeToPro(shopB.tenantId);
  staffA = await createUserAndLogin(server, shopA.owner, { role: 'STAFF' });
  customerA = await createCustomer(shopA, 'Cliente Zap A');
  customerB = await createCustomer(shopB, 'Cliente Zap B');
  setMetaFetchForTests(fakeGraph);
});

beforeEach(() => {
  calls = [];
  setWhatsappEncryptionKeyForTests(randomKey);
});

afterEach(() => {
  setWhatsappEncryptionKeyForTests(undefined);
  setMetaAppConfigForTests(null);
  setWhatsappWebhookConfigForTests(null);
});

afterAll(async () => {
  setMetaFetchForTests(null);
  await teardownTestApp();
});

const randomKey = randomBytes(32);

describe('sem configuracao no servidor', () => {
  it('sem chave de criptografia: nenhuma conexao e aceita (503) e nada e gravado', async () => {
    setWhatsappEncryptionKeyForTests(null);
    const setup = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages/whatsapp/setup' });
    expect(setup.json()).toMatchObject({ storageReady: false, embeddedSignup: { available: false } });
    const response = await connectManual(shopA.owner, { wabaId: WABA_A, phoneNumberId: PHONE_A, accessToken: TOKEN_A });
    expect(response.statusCode).toBe(503);
    expect((await connection(shopA.owner)).json()).toMatchObject({ status: 'NOT_CONNECTED' });
  });

  it('desconectado: mensagem fica REGISTRADA (nao enviada) e ninguem chama a Meta', async () => {
    const response = await send(shopA.owner, customerA, 'Oi, teste sem conexao');
    expect(response.json()).toMatchObject({ delivered: false, message: { status: 'DRAFT' } });
    expect(calls).toHaveLength(0);
  });
});

describe('conexao por pet shop', () => {
  it('STAFF nao conecta; proprietario conecta com dados validados na Meta', async () => {
    expect((await connectManual(staffA, { wabaId: WABA_A, phoneNumberId: PHONE_A, accessToken: TOKEN_A })).statusCode).toBe(403);

    const response = await connectManual(shopA.owner, { wabaId: WABA_A, phoneNumberId: PHONE_A, accessToken: TOKEN_A });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'CONNECTED',
      method: 'MANUAL',
      displayPhoneNumber: '+55 11 98888-0001',
      verifiedName: 'Pet Shop A',
      phoneNumberId: PHONE_A,
      cloudApiReady: true,
      tokenHint: '••••AAAA',
    });
    // Validou o numero e inscreveu o app nos webhooks da conta.
    expect(calls.some((call) => call.url.includes(`/${PHONE_A}?`))).toBe(true);
    expect(calls.some((call) => call.url.endsWith(`/${WABA_A}/subscribed_apps`) && call.method === 'POST')).toBe(true);
  });

  it('o token nunca volta para o frontend e fica criptografado no banco', async () => {
    const responses = [await connection(shopA.owner), await connection(staffA)];
    for (const item of responses) {
      expect(item.statusCode).toBe(200);
      expect(item.body).not.toContain(TOKEN_A);
    }
    const [row] = await withSystem((tx) => tx.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, shopA.tenantId)));
    expect(row?.accessTokenCiphertext).toBeTruthy();
    expect(row?.accessTokenCiphertext).not.toContain(TOKEN_A);
    expect(row?.accessTokenCiphertext?.startsWith('v1:')).toBe(true);
  });

  it('pet shop B continua desconectado e nao pode conectar o numero do A', async () => {
    expect((await connection(shopB.owner)).json()).toMatchObject({ status: 'NOT_CONNECTED', phoneNumberId: null });
    const steal = await connectManual(shopB.owner, { wabaId: WABA_A, phoneNumberId: PHONE_A, accessToken: TOKEN_A });
    expect(steal.statusCode).toBe(409);
    expect((await connection(shopB.owner)).json()).toMatchObject({ status: 'NOT_CONNECTED' });
  });

  it('token invalido: a Meta recusa, nada e gravado', async () => {
    const response = await connectManual(shopB.owner, { wabaId: WABA_B, phoneNumberId: PHONE_B, accessToken: 'EAAG-token-invalido-9999' });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('EAAG-token-invalido');
    expect((await connection(shopB.owner)).json()).toMatchObject({ status: 'NOT_CONNECTED' });
  });

  it('Embedded Signup: sem app da Meta configurado responde 503; configurado troca o code no servidor', async () => {
    const payload = { code: 'codigo-valido-do-embedded-signup', wabaId: WABA_B, phoneNumberId: PHONE_B };
    const unavailable = await authed(server, shopB.owner, { method: 'POST', url: '/api/messages/whatsapp/connection/embedded', payload });
    expect(unavailable.statusCode).toBe(503);

    setMetaAppConfigForTests({ appId: '999000111', appSecret: 'segredo-do-app', embeddedSignupConfigId: '555' });
    const setup = await authed(server, shopB.owner, { method: 'GET', url: '/api/messages/whatsapp/setup' });
    expect(setup.json()).toMatchObject({ embeddedSignup: { available: true, appId: '999000111', configId: '555' } });
    expect(setup.body).not.toContain('segredo-do-app');

    const bad = await authed(server, shopB.owner, {
      method: 'POST',
      url: '/api/messages/whatsapp/connection/embedded',
      payload: { ...payload, code: 'codigo-errado-0000' },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await authed(server, shopB.owner, { method: 'POST', url: '/api/messages/whatsapp/connection/embedded', payload });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'CONNECTED', method: 'EMBEDDED_SIGNUP', phoneNumberId: PHONE_B, tokenHint: '••••BBBB' });
    // A troca do code aconteceu no servidor, com o segredo do app, nunca no navegador.
    const exchange = calls.find((call) => call.url.includes('/oauth/access_token'));
    expect(exchange?.url).toContain('client_id=999000111');
    expect(ok.body).not.toContain(TOKEN_B);
  });
});

describe('envio sai pelo numero do proprio pet shop', () => {
  it('A envia pelo numero e token do A; B pelo do B -- nunca cruzado', async () => {
    const fromA = await send(shopA.owner, customerA, 'Oi do pet shop A');
    const fromB = await send(shopB.owner, customerB, 'Oi do pet shop B');
    expect(fromA.json()).toMatchObject({ delivered: true, message: { status: 'SENT' } });
    expect(fromB.json()).toMatchObject({ delivered: true, message: { status: 'SENT' } });

    const sends = calls.filter((call) => call.url.endsWith('/messages'));
    const callA = sends.find((call) => (call.body as { text: { body: string } }).text.body === 'Oi do pet shop A');
    const callB = sends.find((call) => (call.body as { text: { body: string } }).text.body === 'Oi do pet shop B');
    expect(callA?.url).toContain(`/${PHONE_A}/messages`);
    expect(callA?.auth).toBe(`Bearer ${TOKEN_A}`);
    expect(callB?.url).toContain(`/${PHONE_B}/messages`);
    expect(callB?.auth).toBe(`Bearer ${TOKEN_B}`);
  });

  it('testar conexao: sucesso e falha ficam registrados', async () => {
    const ok = await authed(server, shopA.owner, { method: 'POST', url: '/api/messages/whatsapp/connection/test' });
    expect(ok.json()).toMatchObject({ ok: true, connection: { status: 'CONNECTED' } });

    // Meta fora do ar: ERROR com motivo, sem apagar a conexao.
    setMetaFetchForTests(async () => new Response('erro', { status: 503 }));
    const failed = await authed(server, shopA.owner, { method: 'POST', url: '/api/messages/whatsapp/connection/test' });
    setMetaFetchForTests(fakeGraph);
    expect(failed.json()).toMatchObject({ ok: false, connection: { status: 'ERROR' } });
    expect(failed.json<{ connection: { lastError: string } }>().connection.lastError).toContain('503');
    expect(failed.body).not.toContain(TOKEN_A);
    // Volta a funcionar quando a Meta volta.
    const back = await authed(server, shopA.owner, { method: 'POST', url: '/api/messages/whatsapp/connection/test' });
    expect(back.json()).toMatchObject({ ok: true, connection: { status: 'CONNECTED' } });
  });
});

describe('webhook multi-tenant', () => {
  const secret = 'segredo-webhook';
  function post(payload: unknown) {
    const body = JSON.stringify(payload);
    return server.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
      payload: body,
    });
  }
  const statusFrom = (phoneNumberId: string, id: string, status: string) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id, status }] } }] }],
  });

  it('status so vale se vier do numero do mesmo pet shop da mensagem', async () => {
    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    const sent = await send(shopA.owner, customerA, 'Mensagem para status');
    const wamid = calls.filter((call) => call.url.endsWith('/messages')).length;
    const providerId = `wamid.test.${messageCounter}`;
    expect(sent.json()).toMatchObject({ message: { status: 'SENT' } });
    expect(wamid).toBeGreaterThan(0);

    // Numero do B dizendo que a mensagem do A foi lida: ignorado.
    expect((await post(statusFrom(PHONE_B, providerId, 'read'))).json()).toMatchObject({ mismatched: 1, updated: 0 });
    // Numero do proprio A: vale.
    expect((await post(statusFrom(PHONE_A, providerId, 'delivered'))).json()).toMatchObject({ updated: 1 });

    const list = await authed(server, shopA.owner, { method: 'GET', url: '/api/messages?pageSize=50' });
    const message = list.json<{ data: { content: string; status: string }[] }>().data.find((item) => item.content === 'Mensagem para status');
    expect(message?.status).toBe('DELIVERED');
  });

  it('mensagens recebidas sao reconhecidas (200) e contadas', async () => {
    setWhatsappWebhookConfigForTests({ verifyToken: 'tok', appSecret: secret });
    const inbound = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: PHONE_A }, messages: [{ id: 'wamid.in.1', from: '5511988887777', type: 'text', text: { body: 'Oi' } }] },
            },
          ],
        },
      ],
    };
    const response = await post(inbound);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ inbound: 1 });
  });
});

describe('desconectar', () => {
  it('apaga o token, volta a "nao enviada" e libera o numero', async () => {
    const response = await authed(server, shopA.owner, { method: 'DELETE', url: '/api/messages/whatsapp/connection' });
    expect(response.json()).toMatchObject({ status: 'NOT_CONNECTED' });
    const [row] = await withSystem((tx) => tx.select().from(whatsappConnections).where(eq(whatsappConnections.tenantId, shopA.tenantId)));
    expect(row).toMatchObject({ status: 'DISCONNECTED', accessTokenCiphertext: null });

    calls = [];
    const after = await send(shopA.owner, customerA, 'Depois de desconectar');
    expect(after.json()).toMatchObject({ delivered: false, message: { status: 'DRAFT' } });
    expect(calls).toHaveLength(0);
    // B continua conectado e enviando pelo proprio numero.
    expect((await send(shopB.owner, customerB, 'B segue')).json()).toMatchObject({ delivered: true });
  });
});
