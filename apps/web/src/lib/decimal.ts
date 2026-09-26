/**
 * Entrada numerica em pt-BR: "59,90", "1.234,50", "0,125" ou "59.90".
 * Com virgula, os pontos sao separador de milhar; sem virgula, o ponto e o
 * decimal (quem digita "0.125" kg quer 0,125). Retorna NaN se nao for numero.
 */
export function parseDecimal(value: string): number {
  const compact = value.trim().replace(/\s/g, '');
  if (compact === '') return Number.NaN;
  const normalized = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact;
  return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}
