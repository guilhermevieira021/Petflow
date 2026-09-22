/**
 * Utilitarios de data no fuso do tenant.
 *
 * Um pet shop em Manaus e outro em Sao Paulo tem "hoje" diferentes. Todo
 * calculo de dia operacional passa por aqui, usando Intl -- que ja conhece o
 * banco de fusos do sistema -- em vez de aritmetica manual de offset, que
 * erra em horario de verao e em fusos com offsets quebrados.
 */

/** Data local do tenant no formato YYYY-MM-DD. */
export function toLocalDate(instant: Date, timeZone: string): string {
  // en-CA formata como YYYY-MM-DD, que e exatamente o que precisamos.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function todayInTimeZone(timeZone: string): string {
  return toLocalDate(new Date(), timeZone);
}

/** Desloca uma data YYYY-MM-DD em dias, sem depender de fuso. */
export function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** Lista de datas YYYY-MM-DD de `from` ate `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  // Limite de seguranca: uma serie de dashboard nunca precisa de mais que isso.
  for (let guard = 0; guard < 400 && cursor <= to; guard += 1) {
    dates.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return dates;
}
