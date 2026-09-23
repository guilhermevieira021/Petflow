import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatPercent,
  formatPhone,
  initials,
  realizedPercentage,
  whatsappLink,
} from './format';

/**
 * Intl.NumberFormat('pt-BR') pode usar um espaco unicode nao-quebravel entre
 * "R$" e o valor, dependendo do ICU do ambiente -- nao um espaco comum. A
 * comparacao normaliza qualquer caractere de espaco em branco para o espaco
 * ASCII antes de comparar, em vez de depender de igualdade exata de string.
 */
function normalizeSpaces(value: string): string {
  return value.split('').map((char) => (char.trim() === '' ? String.fromCharCode(32) : char)).join('');
}

describe('formatMoney', () => {
  it('formata em reais com duas casas', () => {
    expect(normalizeSpaces(formatMoney(70))).toBe('R$ 70,00');
    expect(normalizeSpaces(formatMoney(1234.5))).toBe('R$ 1.234,50');
  });
});

describe('formatPhone', () => {
  it('formata celular de 11 digitos', () => {
    expect(formatPhone('11988887777')).toBe('(11) 98888-7777');
  });

  it('formata fixo de 10 digitos', () => {
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('devolve string vazia para valor nulo', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});

describe('whatsappLink', () => {
  it('gera link wa.me com codigo do pais e mensagem codificada', () => {
    const link = whatsappLink('11988887777', 'Confirmando o horario');
    expect(link).toBe('https://wa.me/5511988887777?text=Confirmando%20o%20horario');
  });

  it('nao duplica o 55 quando o numero ja vem com codigo do pais', () => {
    const link = whatsappLink('5511988887777');
    expect(link).toBe('https://wa.me/5511988887777');
  });

  it('devolve null para telefone ausente ou curto demais', () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink('123')).toBeNull();
  });
});

describe('realizedPercentage', () => {
  it('calcula recebido sobre previsto, arredondado', () => {
    expect(realizedPercentage(100, 62)).toBe(62);
    expect(realizedPercentage(150, 65)).toBe(43); // 43.33... -> 43
  });

  it('devolve null quando nao ha previsto (nunca inventa 0% ou 100%)', () => {
    expect(realizedPercentage(0, 0)).toBeNull();
    expect(realizedPercentage(-10, 0)).toBeNull();
  });

  it('permite passar de 100% -- recebido pode exceder o previsto (ex.: pagamento adiantado)', () => {
    expect(realizedPercentage(100, 150)).toBe(150);
  });
});

describe('formatPercent', () => {
  it('formata com o sinal de porcentagem', () => {
    expect(formatPercent(62)).toBe('62%');
  });

  it('mostra -- em vez de um numero quando nao ha base de calculo', () => {
    expect(formatPercent(null)).toBe('--');
  });
});

describe('initials', () => {
  it('usa a primeira letra do primeiro e do ultimo nome', () => {
    expect(initials('Joao Batista Silva')).toBe('JS');
    expect(initials('Ana')).toBe('A');
  });

  it('devolve "?" para nome vazio', () => {
    expect(initials('   ')).toBe('?');
  });
});
