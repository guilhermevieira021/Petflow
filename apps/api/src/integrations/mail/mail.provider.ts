import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  readonly name: string;
  /** true quando o provider realmente entrega a mensagem a um destinatario. */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * Provider padrao: escreve a mensagem no log do servidor.
 *
 * NAO envia email de verdade -- e isso e explicito, nao um acidente. Enquanto
 * MAIL_PROVIDER=console, o link de recuperacao de senha aparece no terminal da
 * API e em nenhum outro lugar. A API continua respondendo 202 ao usuario para
 * nao revelar quais emails existem na base.
 */
class ConsoleMailProvider implements MailProvider {
  readonly name = 'console';
  readonly delivers = false;

  async send(message: MailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'EMAIL NAO ENVIADO (MAIL_PROVIDER=console) -- conteudo abaixo',
    );
  }
}

let cached: MailProvider | null = null;

export function createMailProvider(): MailProvider {
  if (cached) return cached;

  switch (env.MAIL_PROVIDER) {
    case 'console':
      cached = new ConsoleMailProvider();
      return cached;
    case 'smtp':
      // Falhar no boot, e nao na primeira recuperacao de senha de um cliente.
      throw new Error(
        'MAIL_PROVIDER=smtp ainda nao foi implementado. ' +
          'Use MAIL_PROVIDER=console ou implemente SmtpMailProvider antes de subir com esta configuracao.',
      );
    default: {
      const exhaustive: never = env.MAIL_PROVIDER;
      throw new Error(`MAIL_PROVIDER desconhecido: ${String(exhaustive)}`);
    }
  }
}
