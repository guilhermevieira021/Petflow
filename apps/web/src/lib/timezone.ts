/**
 * Conversao entre calendario local do tenant e instantes UTC.
 *
 * Espelha `apps/api/src/core/datetime.ts` de proposito: o backend ja resolve
 * "hoje"/"esta semana" no fuso do tenant usando Intl; o frontend precisa da
 * MESMA nocao de dia para os limites que manda para `/appointments` (`from`/
 * `to`) e para agrupar agendamentos por dia na visao Semana. Antes desta
 * correcao, esses calculos usavam `new Date().toISOString()` (fuso do
 * NAVEGADOR convertido para UTC) -- um agendamento no fim da tarde em
 * horario de Brasilia podia cair no dia seguinte em UTC e sumir da contagem
 * do dia certo (a visao Semana da agenda tinha exatamente esse defeito).
 */

/** Data local no fuso informado, no formato YYYY-MM-DD. */
export function toLocalDate(instant: Date | string, timeZone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function todayInTimeZone(timeZone: string): string {
  return toLocalDate(new Date(), timeZone);
}

/** Desloca uma data YYYY-MM-DD em dias. Aritmetica de calendario pura, sem fuso. */
export function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/**
 * Offset do fuso informado, em minutos, no instante dado (`fuso - UTC`).
 *
 * Tecnica padrao (a mesma usada por bibliotecas como date-fns-tz): formata o
 * instante no fuso alvo, reinterpreta esses campos como se fossem UTC, e
 * compara com o instante original. O Brasil nao usa mais horario de verao,
 * entao uma unica passada (sem iteracao) e exata para qualquer data.
 */
function timeZoneOffsetMinutes(timeZone: string, atUtc: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(atUtc)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - atUtc.getTime()) / 60_000;
}

/** Converte uma data+hora LOCAL do fuso do tenant para o instante UTC (ISO 8601). */
export function zonedTimeToUtcIso(date: string, time: string, timeZone: string): string {
  const guess = new Date(`${date}T${time}Z`);
  const offsetMinutes = timeZoneOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offsetMinutes * 60_000).toISOString();
}

/** Janela [00:00:00, 23:59:59] do dia local, em UTC ISO -- para filtrar /appointments. */
export function localDayWindow(date: string, timeZone: string): { from: string; to: string } {
  return {
    from: zonedTimeToUtcIso(date, '00:00:00', timeZone),
    to: zonedTimeToUtcIso(date, '23:59:59', timeZone),
  };
}
