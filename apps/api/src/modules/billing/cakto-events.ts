import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../../db/client.js';
import { users } from '../../db/schema/index.js';

/**
 * Interpretacao de eventos da Cakto.
 *
 * A parte de PARSING e calculo de data (abaixo) e pura -- so entende o
 * FORMATO de um evento `purchase_approved`, o UNICO confirmado ate agora com
 * a conta Cakto (ver CAKTO.md). Qualquer outro nome de evento e tratado como
 * desconhecido pelo chamador -- este modulo nao tenta adivinhar o formato de
 * eventos ainda nao confirmados (atraso, cancelamento, reembolso).
 *
 * A CORRELACAO DE TENANT (`resolveTenantIdFromCaktoEvent`) precisa do banco.
 * Estrategia adotada: casar `data.customer.email` (email de quem comprou no
 * checkout da Cakto) contra `users.email` -- que e GLOBALMENTE unico
 * (`users_email_unique`, ver migration 0001) e onde "um email = um usuario =
 * um tenant" e uma escolha deliberada da arquitetura (ver comentario em
 * db/schema/users.ts). So considera o OWNER do tenant, porque so o OWNER tem
 * `billing:write` e portanto e quem pode ter iniciado o checkout
 * (`POST /billing/checkout`, ver rbac.ts).
 *
 * Por que email e nao `refId`: o link de checkout configurado
 * (`CAKTO_PRO_CHECKOUT_URL`) e o MESMO link estatico para qualquer pet shop,
 * e nao ha confirmacao da Cakto de que `refId` seja algo que podemos
 * controlar (ver CAKTO.md). Email, ao contrario, e um dado que JA temos e que
 * a pessoa digita no proprio checkout da Cakto -- nao depende de nenhuma
 * configuracao adicional do lado da Cakto.
 *
 * Limite conhecido, documentado, nao escondido: se a pessoa usar no checkout
 * da Cakto um e-mail DIFERENTE do que usa para logar no PetFlow, a
 * correlacao falha com seguranca (fica `RECEIVED`, pendente de reconciliacao
 * manual) -- nunca adivinha. Zero ou mais de um usuario com aquele email
 * tambem resulta em `null`, pelo mesmo motivo.
 */

/** Duracao do periodo do plano PRO apos uma compra aprovada. Nao configuravel: e a mesma regra para toda compra. */
export const CAKTO_PRO_PERIOD_DAYS = 30;

export const CaktoEventType = {
  PURCHASE_APPROVED: 'purchase_approved',
} as const;

export interface CaktoPurchaseApprovedEvent {
  /** `data.id` no payload -- usado como eventId em billing_events. */
  eventId: string;
  /** `data.refId` -- candidato a correlacao de tenant, ainda nao confirmado como algo que controlamos. */
  refId: string | null;
  /** `data.paidAt`, convertido para Date. A UNICA fonte aceita para "data do pagamento" -- nunca data de cadastro, criacao de conta ou abertura do checkout. */
  paidAt: Date;
  /** `data.subscription` -- id da assinatura na Cakto, se houver (null em compras avulsas). */
  providerSubscriptionId: string | null;
  /** `data.customer.email` -- guardado so como providerCustomerId de referencia, nunca usado para decidir o tenant. */
  customerEmail: string | null;
}

/**
 * Soma CAKTO_PRO_PERIOD_DAYS a `paidAt`. Aritmetica pura em milissegundos --
 * nao ha DST a considerar em qualquer fuso brasileiro (ver core/datetime.ts),
 * entao 30 dias em ms e sempre exatos 30*24h reais.
 */
export function computeProPeriodEnd(paidAt: Date): Date {
  return new Date(paidAt.getTime() + CAKTO_PRO_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Extrai os campos que precisamos de um payload `purchase_approved`. Devolve
 * `null` (nunca lanca) quando falta algo essencial -- o chamador registra o
 * evento mesmo assim (idempotencia nao depende de entender o payload), mas
 * nao tenta aplicar a uma assinatura sem uma data de pagamento valida.
 */
export function parseCaktoPurchaseApprovedEvent(rawData: unknown): CaktoPurchaseApprovedEvent | null {
  if (rawData === null || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;

  const eventId = typeof data.id === 'string' && data.id.length > 0 ? data.id : null;
  const paidAtRaw = typeof data.paidAt === 'string' ? new Date(data.paidAt) : null;
  const paidAt = paidAtRaw && !Number.isNaN(paidAtRaw.getTime()) ? paidAtRaw : null;

  if (!eventId || !paidAt) return null;

  const refId = typeof data.refId === 'string' && data.refId.length > 0 ? data.refId : null;
  const providerSubscriptionId = typeof data.subscription === 'string' ? data.subscription : null;
  const customer = data.customer;
  const rawEmail =
    customer !== null && typeof customer === 'object' && typeof (customer as Record<string, unknown>).email === 'string'
      ? ((customer as Record<string, unknown>).email as string)
      : null;
  // Mesma normalizacao aplicada no cadastro/login (ver emailSchema em
  // contracts/common.ts) -- sem isso, "Fulano@X.com" nunca bateria com o
  // "fulano@x.com" gravado em users.email.
  const customerEmail = rawEmail ? rawEmail.trim().toLowerCase() : null;

  return { eventId, refId, paidAt, providerSubscriptionId, customerEmail };
}

/**
 * Resolve o tenant comprador casando `event.customerEmail` contra o OWNER
 * ativo daquele email. Devolve `null` sempre que a resposta nao for
 * inequivoca -- ver comentario do modulo para o porque de cada condicao.
 */
export async function resolveTenantIdFromCaktoEvent(
  tx: Transaction,
  event: CaktoPurchaseApprovedEvent,
): Promise<string | null> {
  if (!event.customerEmail) return null;

  const rows = await tx
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(
      and(
        eq(users.email, event.customerEmail),
        eq(users.role, 'OWNER'),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    );

  // Exatamente um -- zero (nao encontrado) ou mais de um (nao deveria
  // acontecer, dado o indice unico, mas se acontecer nao adivinhamos) tambem
  // devolvem null.
  if (rows.length !== 1) return null;
  return rows[0]!.tenantId;
}
