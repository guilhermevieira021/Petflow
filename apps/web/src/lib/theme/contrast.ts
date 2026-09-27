/**
 * Contraste WCAG 2.x entre duas cores hexadecimais (#rgb ou #rrggbb).
 * Usado nos testes dos temas e no aviso da cor propria do pet shop.
 */

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Cor inválida: ${hex}`);
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Razao de contraste (1 a 21), arredondada em 2 casas como nas ferramentas WCAG. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * Mistura duas cores em sRGB: `weightB` e a fracao de `b` (0 = so `a`).
 * Usada para os tons derivados da marca no tema escuro.
 */
export function mixHex(a: string, b: string, weightB: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * weightB);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Texto normal: AA exige 4,5:1. */
export const WCAG_AA_TEXT = 4.5;
