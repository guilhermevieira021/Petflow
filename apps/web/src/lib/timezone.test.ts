import { describe, expect, it } from 'vitest';
import { localDayWindow, shiftDate, toLocalDate, zonedTimeToUtcIso } from './timezone';

/**
 * Regressao do bug de Agenda -> Semana: um agendamento no fim da tarde em
 * horario de Brasilia (UTC-3) virava o dia seguinte em UTC, sumindo da
 * contagem do dia certo. Estes casos fixam o comportamento correto.
 */
describe('zonedTimeToUtcIso', () => {
  it('converte 21h de Brasilia (quarta) para o instante UTC correto (00h de quinta)', () => {
    expect(zonedTimeToUtcIso('2026-09-23', '21:00:00', 'America/Sao_Paulo')).toBe(
      '2026-09-24T00:00:00.000Z',
    );
  });

  it('funciona para o fuso de Manaus (UTC-4)', () => {
    expect(zonedTimeToUtcIso('2026-09-23', '21:00:00', 'America/Manaus')).toBe(
      '2026-09-24T01:00:00.000Z',
    );
  });

  it('meio-dia local nao atravessa a virada de dia em nenhum fuso do Brasil', () => {
    expect(zonedTimeToUtcIso('2026-09-23', '12:00:00', 'America/Sao_Paulo')).toBe(
      '2026-09-23T15:00:00.000Z',
    );
  });
});

describe('toLocalDate', () => {
  it('devolve o dia LOCAL do agendamento, nao o dia UTC do timestamp', () => {
    // O mesmo instante que a suite de zonedTimeToUtcIso produziu acima.
    expect(toLocalDate('2026-09-24T00:00:00.000Z', 'America/Sao_Paulo')).toBe('2026-09-23');
    // Um `.slice(0, 10)' ingenuo devolveria '2026-09-24' (quinta) -- errado.
  });

  it('e a inversa de zonedTimeToUtcIso para qualquer hora do dia', () => {
    for (const time of ['00:00:00', '08:30:00', '17:00:00', '23:59:00']) {
      const utc = zonedTimeToUtcIso('2026-09-23', time, 'America/Sao_Paulo');
      expect(toLocalDate(utc, 'America/Sao_Paulo')).toBe('2026-09-23');
    }
  });
});

describe('localDayWindow', () => {
  it('a janela do dia local cobre um agendamento tardio que cruza a meia-noite UTC', () => {
    const window = localDayWindow('2026-09-23', 'America/Sao_Paulo');
    const appointment = '2026-09-24T00:00:00.000Z'; // 21h local de 23/09

    expect(appointment >= window.from && appointment <= window.to).toBe(true);
  });

  it('um agendamento do dia seguinte NAO cai na janela do dia anterior', () => {
    const window = localDayWindow('2026-09-23', 'America/Sao_Paulo');
    const nextDayAppointment = '2026-09-24T13:00:00.000Z'; // 10h local de 24/09

    expect(nextDayAppointment >= window.from && nextDayAppointment <= window.to).toBe(false);
  });
});

describe('shiftDate', () => {
  it('desloca dias em aritmetica de calendario pura', () => {
    expect(shiftDate('2026-09-23', 1)).toBe('2026-09-24');
    expect(shiftDate('2026-09-23', -1)).toBe('2026-09-22');
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01');
  });
});
