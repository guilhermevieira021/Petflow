import type { PlanCode } from '@petflow/contracts';
import { env } from '../../config/env.js';

export interface CheckoutSessionParams {
  tenantId: string;
  planCode: PlanCode;
  priceCents: number;
}

export interface CheckoutSession {
  checkoutUrl: string;
}

/**
 * Abstracao sobre o gateway de pagamento.
 *
 * Nenhum codigo de negocio conhece "Cakto" ou qualquer outro nome de
 * provider -- so conhece esta interface. Trocar de provedor e trocar a
 * implementacao devolvida por `getBillingProvider()`, sem tocar em
 * `billing.service.ts` nem nas rotas.
 */
export interface BillingProvider {
  readonly name: string;
  /** false enquanto nenhuma credencial real estiver configurada. */
  readonly configured: boolean;
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession>;
}

/**
 * Provider padrao: nenhum gateway configurado.
 *
 * NAO gera URL de checkout fake nem finge um pagamento aprovado. O sistema
 * inteiro -- pricing, billing, paywall -- funciona plenamente sem isso: o
 * usuario ve os planos, ve o uso, ve o paywall quando o trial expira, e o
 * botao de assinar informa honestamente que o checkout ainda nao esta
 * disponivel nesta instalacao.
 */
class NullBillingProvider implements BillingProvider {
  readonly name = 'none';
  readonly configured = false;

  createCheckoutSession(): Promise<CheckoutSession> {
    throw new Error(
      'NullBillingProvider nao cria sessoes de checkout. Verifique `configured` antes de chamar.',
    );
  }
}

/**
 * Checkout hospedado da Cakto.
 *
 * O link fornecido (`CAKTO_PRO_CHECKOUT_URL`) e um checkout ESTATICO de
 * produto unico -- nao ha API da Cakto sendo chamada para gerar uma sessao
 * por compra. Por isso `createCheckoutSession` nao faz nenhuma requisicao de
 * rede: so devolve o link configurado.
 *
 * Consequencia importante, documentada em detalhe em CAKTO.md: como o link e
 * o MESMO para qualquer tenant, o retorno do checkout por si so nao diz qual
 * pet shop comprou. Essa correlacao (checkout -> tenant) e exatamente o que
 * falta confirmar com a conta Cakto antes de o webhook poder atualizar uma
 * assinatura com seguranca -- ver o webhook em routes/cakto-webhook.routes.ts.
 */
export class CaktoProvider implements BillingProvider {
  readonly name = 'cakto';
  readonly configured = true;

  constructor(private readonly checkoutUrl: string) {}

  async createCheckoutSession(_params: CheckoutSessionParams): Promise<CheckoutSession> {
    return { checkoutUrl: this.checkoutUrl };
  }
}

let cached: BillingProvider | null = null;

/**
 * Ponto unico de troca de provider. `CAKTO_PRO_CHECKOUT_URL` configurado ->
 * `CaktoProvider`; caso contrario, `NullBillingProvider`. Trocar de gateway
 * no futuro e trocar esta funcao, sem tocar em `billing.service.ts` nem nas
 * rotas que a consomem.
 */
export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  cached = env.CAKTO_PRO_CHECKOUT_URL
    ? new CaktoProvider(env.CAKTO_PRO_CHECKOUT_URL)
    : new NullBillingProvider();
  return cached;
}
