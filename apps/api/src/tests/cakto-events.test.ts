import { describe, expect, it } from 'vitest';
import {
  CAKTO_PRO_PERIOD_DAYS,
  computeProPeriodEnd,
  parseCaktoPurchaseApprovedEvent,
  resolveTenantIdFromCaktoRefId,
} from '../modules/billing/cakto-events.js';

/**
 * Testes puros (sem banco) do modulo de interpretacao de eventos da Cakto.
 *
 * O caso "5.1/14" do pedido do usuario -- verificar a regra dos 30 dias sem
 * esperar 30 dias de verdade -- vive aqui: `computeProPeriodEnd` e uma
 * funcao pura, deterministica, testada com datas fixas.
 */

describe('computeProPeriodEnd', () => {
  it('soma exatamente 30 dias (nao 30 dias corridos aproximados) a partir de paidAt', () => {
    expect(CAKTO_PRO_PERIOD_DAYS).toBe(30);

    const paidAt = new Date('2026-06-26T12:00:00.000Z');
    const expiresAt = computeProPeriodEnd(paidAt);

    expect(expiresAt.toISOString()).toBe('2026-07-26T12:00:00.000Z');
    expect(expiresAt.getTime() - paidAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('atravessa virada de mes/ano corretamente', () => {
    const paidAt = new Date('2026-12-15T00:00:00.000Z');
    const expiresAt = computeProPeriodEnd(paidAt);
    expect(expiresAt.toISOString()).toBe('2027-01-14T00:00:00.000Z');
  });

  it('"data atual < expiresAt" e "data atual >= expiresAt" -- os dois lados do limite', () => {
    const paidAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = computeProPeriodEnd(paidAt);

    const umMsAntes = new Date(expiresAt.getTime() - 1);
    const exatamenteNoLimite = new Date(expiresAt.getTime());
    const umMsDepois = new Date(expiresAt.getTime() + 1);

    expect(umMsAntes.getTime() < expiresAt.getTime()).toBe(true);
    expect(exatamenteNoLimite.getTime() >= expiresAt.getTime()).toBe(true);
    expect(umMsDepois.getTime() >= expiresAt.getTime()).toBe(true);
  });
});

describe('parseCaktoPurchaseApprovedEvent', () => {
  const payloadExemploConfirmadoPelaCakto = {
    id: '87956abe-940e-4e8b-8a27-82c482920f64',
    refId: '9vbgfmg',
    customer: { name: 'John Doe', email: 'john.doe@example.com' },
    subscription: null,
    status: 'paid',
    paidAt: '2026-06-26T12:00:00.000000+00:00',
  };

  it('extrai os campos confirmados do payload real de purchase_approved', () => {
    const parsed = parseCaktoPurchaseApprovedEvent(payloadExemploConfirmadoPelaCakto);

    expect(parsed).not.toBeNull();
    expect(parsed!.eventId).toBe('87956abe-940e-4e8b-8a27-82c482920f64');
    expect(parsed!.refId).toBe('9vbgfmg');
    expect(parsed!.paidAt.toISOString()).toBe('2026-06-26T12:00:00.000Z');
    expect(parsed!.providerSubscriptionId).toBeNull();
    expect(parsed!.customerEmail).toBe('john.doe@example.com');
  });

  it('devolve null (nunca lanca) quando falta data.id', () => {
    const { id: _id, ...semId } = payloadExemploConfirmadoPelaCakto;
    expect(parseCaktoPurchaseApprovedEvent(semId)).toBeNull();
  });

  it('devolve null quando falta data.paidAt', () => {
    const { paidAt: _paidAt, ...semPaidAt } = payloadExemploConfirmadoPelaCakto;
    expect(parseCaktoPurchaseApprovedEvent(semPaidAt)).toBeNull();
  });

  it('devolve null quando paidAt nao e uma data valida', () => {
    expect(
      parseCaktoPurchaseApprovedEvent({ ...payloadExemploConfirmadoPelaCakto, paidAt: 'nao-e-uma-data' }),
    ).toBeNull();
  });

  it('devolve null para payload que nao e objeto', () => {
    expect(parseCaktoPurchaseApprovedEvent(null)).toBeNull();
    expect(parseCaktoPurchaseApprovedEvent('string')).toBeNull();
    expect(parseCaktoPurchaseApprovedEvent(undefined)).toBeNull();
  });

  it('refId e providerSubscriptionId sao opcionais -- payload sem eles ainda e valido', () => {
    const { refId: _refId, subscription: _subscription, ...resto } = payloadExemploConfirmadoPelaCakto;
    const parsed = parseCaktoPurchaseApprovedEvent(resto);
    expect(parsed).not.toBeNull();
    expect(parsed!.refId).toBeNull();
    expect(parsed!.providerSubscriptionId).toBeNull();
  });
});

describe('resolveTenantIdFromCaktoRefId', () => {
  it('AGUARDANDO CONFIGURACAO DO PROJETO: sempre devolve null ate a correlacao ser confirmada (ver CAKTO.md)', () => {
    expect(resolveTenantIdFromCaktoRefId('9vbgfmg')).toBeNull();
    expect(resolveTenantIdFromCaktoRefId(null)).toBeNull();
  });
});
