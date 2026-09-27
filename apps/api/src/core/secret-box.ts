import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Criptografia de segredos guardados no banco (ex.: token do WhatsApp de cada
 * pet shop). AES-256-GCM: confidencialidade + integridade -- um valor
 * adulterado no banco nao decifra.
 *
 * Formato: "v1:<iv base64>:<tag base64>:<dados base64>".
 * A chave (32 bytes, base64 ou hex) vive so no ambiente do servidor.
 */

const VERSION = 'v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/** Interpreta a chave de 32 bytes (base64 ou hex). null se ausente ou invalida. */
export function parseEncryptionKey(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  const candidates = [/^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : null, Buffer.from(value, 'base64')];
  return candidates.find((buffer) => buffer?.length === 32) ?? null;
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function openSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new SecretBoxError('Segredo em formato desconhecido.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('Nao foi possivel decifrar o segredo (chave diferente ou dado adulterado).');
  }
}
