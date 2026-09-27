import type { WhatsappProviderKind } from '@petflow/contracts';

/**
 * Provider de envio de WhatsApp. Cada PET SHOP tem o seu (conexao propria,
 * resolvida em whatsapp-connection.service.ts); nao existe numero global.
 *
 *  - `link` (sem conexao): NAO envia nada. O sistema registra a mensagem como
 *    DRAFT ("registrada, nao enviada") e oferece o link wa.me para a pessoa
 *    enviar pelo proprio aplicativo. Nunca vira SENT.
 *  - `cloud_api`: API oficial da Meta (WhatsApp Business Cloud API). Envia de
 *    verdade; SENT significa "aceita pela API", nao "entregue" -- entrega e
 *    leitura dependem do webhook de status da Meta (ainda nao implementado).
 *
 * Limitacao conhecida da Cloud API: fora da janela de 24h de conversa, a Meta
 * so aceita mensagens de TEMPLATE previamente aprovado. Texto livre enviado
 * fora da janela volta como erro e fica registrado como FAILED com o motivo.
 */

export interface SendResult {
  providerMessageId: string;
}

export class WhatsappSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsappSendError';
  }
}

export interface WhatsappProvider {
  readonly kind: WhatsappProviderKind;
  readonly configured: boolean;
  /** `to`: numero internacional so com digitos (ex.: 5511988887777). */
  send(to: string, body: string): Promise<SendResult>;
}

class LinkOnlyProvider implements WhatsappProvider {
  readonly kind = 'link' as const;
  readonly configured = false;

  async send(): Promise<SendResult> {
    throw new WhatsappSendError('WhatsApp nao conectado: nenhuma API configurada no servidor.');
  }
}

export class CloudApiProvider implements WhatsappProvider {
  readonly kind = 'cloud_api' as const;
  readonly configured = true;

  constructor(
    private readonly config: { apiUrl: string; accessToken: string; phoneNumberId: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, body: string): Promise<SendResult> {
    const url = `${this.config.apiUrl.replace(/\/$/, '')}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new WhatsappSendError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'A API do WhatsApp nao respondeu a tempo.'
          : 'Nao foi possivel conectar a API do WhatsApp.',
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number };
    } | null;

    if (!response.ok) {
      // Mensagem do provider vai para o registro (failure_reason), nunca o token.
      const detail = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new WhatsappSendError(`WhatsApp recusou a mensagem: ${detail}`.slice(0, 500));
    }

    const id = payload?.messages?.[0]?.id;
    if (!id) throw new WhatsappSendError('Resposta da API do WhatsApp sem identificador da mensagem.');
    return { providerMessageId: id };
  }
}

/** Sem conexao: nada e enviado; a mensagem fica "registrada, nao enviada". */
export const LINK_ONLY_PROVIDER: WhatsappProvider = new LinkOnlyProvider();

/**
 * fetch usado para falar com a Graph API da Meta. Substituivel so em testes
 * (nenhum teste chama a Meta de verdade).
 */
let metaFetch: typeof fetch = (...args) => fetch(...args);

export function getMetaFetch(): typeof fetch {
  return metaFetch;
}

/** Somente testes. */
export function setMetaFetchForTests(fetchImpl: typeof fetch | null): void {
  metaFetch = fetchImpl ?? ((...args) => fetch(...args));
}

let override: WhatsappProvider | null = null;

/** Provider forcado em testes (vale para todos os pet shops). */
export function getWhatsappProviderOverride(): WhatsappProvider | null {
  return override;
}

/** Apenas para testes: injeta um provider controlado. */
export function setWhatsappProviderForTests(provider: WhatsappProvider | null): void {
  override = provider;
}
