import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Derivacao de senha.
 *
 * Usamos scrypt do `node:crypto` em vez de argon2/bcrypt por uma razao
 * pratica: ambos exigem compilacao nativa, que falha em maquinas Windows sem
 * build tools. scrypt e memory-hard, faz parte da stdlib e nao adiciona
 * dependencia. O formato do hash carrega os parametros, entao trocar por
 * argon2id no futuro e uma questao de adicionar um novo `algo` aqui -- os
 * hashes antigos continuam verificaveis.
 *
 * Formato: scrypt$N$r$p$<salt-base64>$<hash-base64>
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Hash de senha "descartavel" usado para igualar o tempo de resposta quando o
 * email informado no login nao existe. Sem isso, a diferenca de latencia
 * entrega quais emails estao cadastrados.
 */
const DUMMY_HASH_PROMISE = hashPassword('dummy-password-para-timing-safe-login-1');

export async function wasteTimeLikeAVerification(): Promise<void> {
  await verifyPassword('senha-incorreta-qualquer', await DUMMY_HASH_PROMISE);
}

/** Token opaco de alta entropia (sessao, reset de senha, CSRF). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens sao guardados hasheados. Se o banco vazar, os tokens nao servem.
 * SHA-256 e suficiente aqui: o segredo ja tem 256 bits de entropia, entao nao
 * ha o que forcar por dicionario.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

/** Comparacao resistente a timing para tokens em string. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
