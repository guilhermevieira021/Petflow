/**
 * Conversoes entre os tipos que o driver do Postgres devolve e os tipos que a
 * API expoe em JSON.
 *
 * Regra da casa: NUMERIC chega como string (de proposito -- o driver nao
 * converte para float para nao perder precisao) e TIMESTAMPTZ chega como Date.
 * A fronteira HTTP fala sempre `number` e ISO 8601 em string.
 */

export function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Converte reais (number) para o literal que o NUMERIC(10,2) espera. */
export function toMoneyLiteral(value: number): string {
  return value.toFixed(2);
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoRequired(value: Date | string): string {
  const result = toIso(value);
  if (result === null) {
    throw new Error('Data obrigatoria ausente na serializacao.');
  }
  return result;
}

/** Data pura YYYY-MM-DD: o driver pode devolver Date ou string. */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/**
 * COUNT() do Postgres e bigint e chega como string. Number.parseInt e seguro
 * aqui: um pet shop com mais de 2^53 registros nao e o nosso problema.
 */
export function toCount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}
