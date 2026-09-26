import { describe, expect, it } from 'vitest';
import { parseDecimal } from './decimal';

describe('parseDecimal', () => {
  it('entende virgula decimal e ponto de milhar (pt-BR)', () => {
    expect(parseDecimal('59,90')).toBe(59.9);
    expect(parseDecimal('1.234,50')).toBe(1234.5);
    expect(parseDecimal('0,125')).toBe(0.125);
  });

  it('sem virgula, o ponto e decimal (0.125 kg nao vira 125)', () => {
    expect(parseDecimal('0.125')).toBe(0.125);
    expect(parseDecimal('59.90')).toBe(59.9);
    expect(parseDecimal('2')).toBe(2);
  });

  it('entrada invalida vira NaN', () => {
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
  });
});
