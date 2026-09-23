/**
 * Interpretacao de eventos da Cakto.
 *
 * Modulo deliberadamente pequeno e puro (sem banco, sem HTTP): so entende o
 * FORMATO de um evento `purchase_approved`, o UNICO confirmado ate agora com
 * a conta Cakto (ver CAKTO.md). Qualquer outro nome de evento e tratado como
 * desconhecido pelo chamador -- este modulo nao tenta adivinhar o formato de
 * eventos ainda nao confirmados (atraso, cancelamento, reembolso).
 *
 * A resolucao de qual TENANT corresponde a um evento tambem vive aqui, e hoje
 * sempre devolve `null` -- de proposito. O link de checkout configurado
 * (`CAKTO_PRO_CHECKOUT_URL`) e o MESMO para qualquer pet shop, entao nao ha
 * hoje nenhum dado confirmado que permita saber quem comprou. Inventar uma
 * regra aqui (por exemplo, casar por e-mail) arriscaria ativar o PRO do
 * tenant errado -- e esse e exatamente o erro que a isolacao entre tenants
 * existe para prevenir. Ver CAKTO.md, item 3.
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
  const customerEmail =
    customer !== null && typeof customer === 'object' && typeof (customer as Record<string, unknown>).email === 'string'
      ? ((customer as Record<string, unknown>).email as string)
      : null;

  return { eventId, refId, paidAt, providerSubscriptionId, customerEmail };
}

/**
 * Hoje SEMPRE devolve `null` -- ver comentario do modulo. Existe como funcao
 * nomeada (em vez de o chamador so ler `null` direto) para que o dia em que a
 * Cakto confirmar um mecanismo de correlacao, so este ponto precise mudar.
 */
export function resolveTenantIdFromCaktoRefId(_refId: string | null): string | null {
  return null;
}
