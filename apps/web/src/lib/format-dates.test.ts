import { describe, expect, it } from 'vitest';
import { formatAge, formatCalendarDate, formatTrialPeriod } from './format';

describe('formatCalendarDate', () => {
  it('nao volta um dia em fuso negativo (data de calendario pura)', () => {
    expect(formatCalendarDate('2020-05-10')).toBe('10/05/2020');
  });

  it('mostra "--" sem data', () => {
    expect(formatCalendarDate(null)).toBe('--');
  });
});

describe('formatAge', () => {
  const now = new Date(2026, 8, 24); // 24/09/2026

  it('usa anos a partir de 12 meses', () => {
    expect(formatAge('2022-09-24', now)).toBe('4 anos');
    expect(formatAge('2025-09-24', now)).toBe('1 ano');
  });

  it('usa meses abaixo de 1 ano e respeita o dia do mes', () => {
    expect(formatAge('2026-02-10', now)).toBe('7 meses');
    expect(formatAge('2026-08-25', now)).toBe('Menos de 1 mês');
  });

  it('retorna null sem data ou com data futura', () => {
    expect(formatAge(null, now)).toBeNull();
    expect(formatAge('2027-01-01', now)).toBeNull();
  });
});

describe('formatTrialPeriod', () => {
  it('mostra horas abaixo de 72h e dias em multiplos de 24 a partir disso', () => {
    expect(formatTrialPeriod(48)).toBe('48 horas');
    expect(formatTrialPeriod(72)).toBe('3 dias');
    expect(formatTrialPeriod(720)).toBe('30 dias');
    expect(formatTrialPeriod(100)).toBe('100 horas');
  });

  it('retorna null sem valor valido', () => {
    expect(formatTrialPeriod(null)).toBeNull();
    expect(formatTrialPeriod(0)).toBeNull();
  });
});
