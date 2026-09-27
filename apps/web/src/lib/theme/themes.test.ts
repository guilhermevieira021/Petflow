import { THEME_IDS } from '@petflow/contracts';
import { describe, expect, it } from 'vitest';
import { contrastRatio, WCAG_AA_TEXT } from './contrast';
import { brandDerivedTokens, THEME_TOKEN_NAMES, THEMES, themeCssVariables } from './themes';

describe('calculo de contraste', () => {
  it('bate com os valores de referencia WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#777777', '#ffffff')).toBe(4.48);
  });
});

describe('temas', () => {
  it('existem 6 temas (5 claros + 1 escuro) e cada id do contrato tem definicao', () => {
    expect(THEME_IDS).toHaveLength(6);
    expect(Object.values(THEMES).filter((theme) => theme.mode === 'dark').map((theme) => theme.id)).toEqual(['midnight']);
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
  });

  it('todo tema define TODOS os tokens (nada herdado por acidente)', () => {
    for (const theme of Object.values(THEMES)) {
      for (const token of THEME_TOKEN_NAMES) {
        expect(theme.tokens[token], `${theme.id}.${token}`).toBeTruthy();
      }
    }
  });

  it('os temas sao realmente diferentes entre si (marca, fundo e navegacao)', () => {
    const themes = Object.values(THEMES);
    for (const key of ['brand', 'canvas', 'ink'] as const) {
      expect(new Set(themes.map((theme) => theme.tokens[key])).size, key).toBe(themes.length);
    }
  });

  it('Original preserva exatamente o visual anterior', () => {
    expect(THEMES.original.tokens).toMatchObject({ brand: '#2f6bff', canvas: '#f4f5f7', ink: '#0c0f14', text: '#0d1117' });
  });
});

describe.each(Object.values(THEMES))('acessibilidade: $name', (theme) => {
  const t = theme.tokens;
  // Texto da marca: no claro a propria marca; no escuro o tom derivado (claro).
  const brandText = theme.mode === 'dark' ? brandDerivedTokens(t.brand, 'dark', t.surface)['brand-text']! : t.brand;
  const pairs: [string, string, string, number][] = [
    ['texto / fundo', t.text, t.canvas, 7],
    ['texto / card', t.text, t.surface, 7],
    ['texto secundario / card', t['text-muted'], t.surface, WCAG_AA_TEXT],
    ['texto secundario / fundo', t['text-muted'], t.canvas, WCAG_AA_TEXT],
    ['texto secundario / area rebaixada', t['text-muted'], t['surface-sunken'], WCAG_AA_TEXT],
    ['texto auxiliar / card', t['text-subtle'], t.surface, 3],
    ['botao: texto / marca', t['text-inverse'], t.brand, WCAG_AA_TEXT],
    ['marca como texto / card', brandText, t.surface, WCAG_AA_TEXT],
    ['sidebar: texto', t['ink-text'], t.ink, 7],
    ['sidebar: texto secundario', t['ink-muted'], t.ink, WCAG_AA_TEXT],
    ['badge sucesso', t.success, t['success-subtle'], WCAG_AA_TEXT],
    ['badge alerta', t.warning, t['warning-subtle'], WCAG_AA_TEXT],
    ['badge erro', t.danger, t['danger-subtle'], WCAG_AA_TEXT],
    ['badge informacao', t.info, t['info-subtle'], WCAG_AA_TEXT],
    ['botao sucesso', t['text-inverse'], t['success-solid'], WCAG_AA_TEXT],
    ['botao alerta', t['text-inverse'], t['warning-solid'], WCAG_AA_TEXT],
    ['botao erro', t['text-inverse'], t['danger-solid'], WCAG_AA_TEXT],
    ['estado sucesso / card', t.success, t.surface, WCAG_AA_TEXT],
    ['estado erro / card', t.danger, t.surface, WCAG_AA_TEXT],
    ['sucesso sobre a sidebar', t['success-on-ink'], t.ink, WCAG_AA_TEXT],
    ['erro sobre a sidebar', t['danger-on-ink'], t.ink, WCAG_AA_TEXT],
  ];

  it.each(pairs)('%s', (_label, foreground, background, minimum) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});

describe('tema escuro', () => {
  it('tons da marca calculados sobre a superficie escura (nao sobre branco)', () => {
    const derived = brandDerivedTokens('#2563eb', 'dark', '#161b22');
    expect(derived['brand-subtle']).toMatch(/^#[0-9a-f]{6}$/);
    // Fundo suave escuro de verdade: bem mais escuro que o branco da versao clara.
    expect(contrastRatio(derived['brand-subtle']!, '#ffffff')).toBeGreaterThan(10);
    expect(contrastRatio(derived['brand-text']!, derived['brand-subtle']!)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });

  it('cor propria do pet shop tambem funciona no escuro', () => {
    const vars = themeCssVariables('midnight', '#aa3300');
    expect(vars['--color-brand']).toBe('#aa3300');
    expect(vars['--color-brand-subtle']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--color-canvas']).toBe(THEMES.midnight.tokens.canvas);
  });
});

describe('variaveis CSS', () => {
  it('gera o conjunto completo com tons derivados da marca do tema', () => {
    const vars = themeCssVariables('forest');
    expect(vars['--color-brand']).toBe(THEMES.forest.tokens.brand);
    expect(vars['--color-canvas']).toBe(THEMES.forest.tokens.canvas);
    expect(vars['--color-brand-subtle']).toContain(THEMES.forest.tokens.brand);
    expect(Object.keys(vars)).toHaveLength(THEME_TOKEN_NAMES.length + Object.keys(brandDerivedTokens('#000')).length - 1);
  });

  it('a cor propria do pet shop substitui so a marca, o resto continua do tema', () => {
    const vars = themeCssVariables('sunset', '#123456');
    expect(vars['--color-brand']).toBe('#123456');
    expect(vars['--color-brand-hover']).toContain('#123456');
    expect(vars['--color-canvas']).toBe(THEMES.sunset.tokens.canvas);
    expect(vars['--color-ink']).toBe(THEMES.sunset.tokens.ink);
  });
});
