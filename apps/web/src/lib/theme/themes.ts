import { ThemeId } from '@petflow/contracts';
import { mixHex } from './contrast';

/**
 * Sistema de temas.
 *
 * Cada tema e um conjunto COMPLETO de tokens (fundo, superficies, texto,
 * bordas, navegacao "ink", marca e estados), aplicado como CSS variables no
 * <html>. Os componentes ja consomem apenas `var(--color-*)` (ver
 * styles/index.css), entao trocar o tema repinta o app inteiro sem tocar em
 * componente nenhum.
 *
 * A cor da marca continua separada: os tons derivados (hover, fundo suave,
 * texto sobre fundo claro...) sao calculados a partir de UMA cor
 * (`brandDerivedTokens`). Assim o tema fornece a cor padrao, e o pet shop pode
 * sobrepor a propria cor (white-label) sem perder nada do tema.
 */

/** Tokens que variam por tema. Os nomes sao os das CSS variables (sem `--color-`). */
export const THEME_TOKEN_NAMES = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-hover',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-subtle',
  'text-inverse',
  'ink',
  'ink-raised',
  'ink-hover',
  'ink-border',
  'ink-text',
  'ink-muted',
  'brand',
  'success',
  'success-subtle',
  'success-on-ink',
  /** Fundo com texto branco em cima (botao "Avisar tutor", badge solido...). */
  'success-solid',
  'warning',
  'warning-subtle',
  'warning-solid',
  'danger',
  'danger-subtle',
  'danger-solid',
  'danger-border',
  'danger-on-ink',
  'info',
  'info-subtle',
  'chart-1',
  'chart-2',
  'chart-grid',
] as const;
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;

export type ThemeMode = 'light' | 'dark';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  /** Claro ou escuro: define os tons derivados da marca e o color-scheme nativo. */
  mode: ThemeMode;
  tokens: ThemeTokens;
}

/** Estados compartilhados pelos temas que nao precisam de ajuste proprio. */
const STATES = {
  // Mais escuros que os da Fase 1 (#0f8a5f / #a86400), que ficavam abaixo
  // do AA (4,5:1) em badge claro e com texto branco.
  success: '#0b7a54',
  'success-subtle': '#e7f6ef',
  'success-on-ink': '#4fd6a2',
  'success-solid': '#0b7a54',
  warning: '#945700',
  'warning-subtle': '#fdf3e2',
  'warning-solid': '#945700',
  danger: '#c0332f',
  'danger-subtle': '#fdeceb',
  'danger-solid': '#c0332f',
  'danger-border': '#f5c6c3',
  'danger-on-ink': '#ff8a84',
  info: '#1f6fb2',
  'info-subtle': '#e9f3fb',
} as const;

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  original: {
    id: 'original',
    name: 'Petflow Original',
    description: 'O visual padrão da marca: moderno, profissional e tecnológico.',
    mode: 'light',
    tokens: {
      canvas: '#f4f5f7',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#eff1f4',
      'surface-hover': '#f6f7f9',
      border: '#e4e7ec',
      'border-strong': '#d0d5dd',
      text: '#0d1117',
      'text-muted': '#525b69',
      'text-subtle': '#7a8392',
      'text-inverse': '#ffffff',
      ink: '#0c0f14',
      'ink-raised': '#161b23',
      'ink-hover': '#1d232d',
      'ink-border': 'rgb(255 255 255 / 0.08)',
      'ink-text': '#eef1f6',
      'ink-muted': '#939cac',
      brand: '#2f6bff',
      ...STATES,
      'chart-1': '#3b6fd4',
      'chart-2': '#c2410c',
      'chart-grid': '#eceef2',
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Azul profundo: confiança, limpeza e tecnologia.',
    mode: 'light',
    tokens: {
      canvas: '#eef4fa',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#e4edf6',
      'surface-hover': '#f2f7fc',
      border: '#d6e2ee',
      'border-strong': '#bccde0',
      text: '#081a2c',
      'text-muted': '#44576c',
      'text-subtle': '#687d93',
      'text-inverse': '#ffffff',
      ink: '#062038',
      'ink-raised': '#0b2c4a',
      'ink-hover': '#11385c',
      'ink-border': 'rgb(255 255 255 / 0.09)',
      'ink-text': '#e7f0fa',
      'ink-muted': '#93adc8',
      brand: '#0a64bd',
      ...STATES,
      info: '#0d6a8f',
      'info-subtle': '#e4f3f8',
      'chart-1': '#0a64bd',
      'chart-2': '#c2410c',
      'chart-grid': '#e3ebf4',
    },
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Verde esmeralda: natural, saudável e premium.',
    mode: 'light',
    tokens: {
      canvas: '#f1f6f3',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#e6efe9',
      'surface-hover': '#f4f8f5',
      border: '#d9e5dd',
      'border-strong': '#c0d3c6',
      text: '#0a1a11',
      'text-muted': '#45594d',
      'text-subtle': '#6a7f72',
      'text-inverse': '#ffffff',
      ink: '#0a2117',
      'ink-raised': '#112e20',
      'ink-hover': '#193b2a',
      'ink-border': 'rgb(255 255 255 / 0.09)',
      'ink-text': '#e8f4ed',
      'ink-muted': '#95b1a2',
      brand: '#04734f',
      ...STATES,
      // Sucesso em verde-folha, distinto do esmeralda da marca.
      success: '#2f7d12',
      'success-subtle': '#ebf6e3',
      'success-on-ink': '#8fdc6a',
      'success-solid': '#2f7d12',
      'chart-1': '#04734f',
      'chart-2': '#b4530a',
      'chart-grid': '#e3ece6',
    },
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    description: 'Laranja e âmbar: energético e comercial.',
    mode: 'light',
    tokens: {
      canvas: '#faf5f0',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#f3ebe3',
      'surface-hover': '#fcf8f4',
      border: '#ebdfd3',
      'border-strong': '#dccab9',
      text: '#1d120b',
      'text-muted': '#5e4c40',
      'text-subtle': '#836f62',
      'text-inverse': '#ffffff',
      ink: '#24150f',
      'ink-raised': '#311d15',
      'ink-hover': '#3e261c',
      'ink-border': 'rgb(255 255 255 / 0.09)',
      'ink-text': '#f9eee7',
      'ink-muted': '#b89f91',
      brand: '#c2410c',
      ...STATES,
      // Alerta puxado para o amarelo e erro para o vermelho: nao se
      // confundem com o laranja da marca.
      warning: '#8a5a00',
      'warning-subtle': '#fcf4d6',
      'warning-solid': '#8a5a00',
      danger: '#b3261e',
      'danger-subtle': '#fcebea',
      'danger-solid': '#b3261e',
      'chart-1': '#c2410c',
      'chart-2': '#2563a8',
      'chart-grid': '#efe5dc',
    },
  },
  lavender: {
    id: 'lavender',
    name: 'Lavender',
    description: 'Roxo e lilás: moderno, sofisticado e amigável.',
    mode: 'light',
    tokens: {
      canvas: '#f5f3fb',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#ece8f6',
      'surface-hover': '#f8f6fd',
      border: '#e1dcef',
      'border-strong': '#cdc4e2',
      text: '#150f22',
      'text-muted': '#534b66',
      'text-subtle': '#78708b',
      'text-inverse': '#ffffff',
      ink: '#1b1432',
      'ink-raised': '#251c43',
      'ink-hover': '#2f2553',
      'ink-border': 'rgb(255 255 255 / 0.09)',
      'ink-text': '#f1edfb',
      'ink-muted': '#aaa0c6',
      brand: '#7c3aed',
      ...STATES,
      'chart-1': '#7c3aed',
      'chart-2': '#c2410c',
      'chart-grid': '#ebe7f4',
    },
  },
  midnight: {
    id: 'midnight',
    name: 'Escuro',
    description: 'Tema escuro completo: confortável à noite e em ambientes com pouca luz.',
    mode: 'dark',
    tokens: {
      canvas: '#0d1117',
      surface: '#161b22',
      'surface-raised': '#1c2229',
      'surface-sunken': '#11161c',
      'surface-hover': '#1f262e',
      border: '#2b333d',
      'border-strong': '#3c4652',
      text: '#e6edf3',
      'text-muted': '#9ea9b5',
      'text-subtle': '#7d8894',
      'text-inverse': '#ffffff',
      // Navegacao um degrau mais escura que o fundo: a hierarquia continua.
      ink: '#080b0f',
      'ink-raised': '#12171d',
      'ink-hover': '#1a2027',
      'ink-border': 'rgb(255 255 255 / 0.07)',
      'ink-text': '#e6edf3',
      'ink-muted': '#8d99a6',
      brand: '#2563eb',
      // Como TEXTO/ICONE sobre fundo escuro, os estados precisam ser claros;
      // como FUNDO de botao com texto branco, usam a versao "-solid".
      success: '#4ac68d',
      'success-subtle': '#0f2a1f',
      'success-on-ink': '#4fd6a2',
      'success-solid': '#157a4f',
      warning: '#e3a93b',
      'warning-subtle': '#2d2210',
      'warning-solid': '#8f5a00',
      danger: '#f2766e',
      'danger-subtle': '#341716',
      'danger-border': '#6b2a27',
      'danger-on-ink': '#ff8a84',
      'danger-solid': '#c0332f',
      info: '#6cb0ef',
      'info-subtle': '#10243a',
      'chart-1': '#6d9cf5',
      'chart-2': '#f08a4b',
      'chart-grid': '#252d37',
    },
  },
};

export const DEFAULT_THEME_ID: ThemeId = 'original';

/**
 * Tons derivados da cor da marca. Mesma formula que styles/index.css usava
 * no :root -- repetida aqui como valores completos porque, sobrescritas no
 * <html> ou num container de previa, precisam ser recalculadas ali.
 *
 * No modo escuro o "fundo suave" e a "borda" misturam a marca com a
 * SUPERFICIE escura (nao com branco), e o texto da marca fica mais claro.
 * Sao calculados em hexadecimal para que o contraste possa ser testado.
 */
export function brandDerivedTokens(brand: string, mode: ThemeMode = 'light', surface = '#161b22'): Record<string, string> {
  if (mode === 'dark' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brand)) {
    return {
      brand,
      'brand-hover': mixHex(brand, '#000000', 0.12),
      'brand-active': mixHex(brand, '#000000', 0.22),
      'brand-subtle': mixHex(brand, surface, 0.82),
      'brand-border': mixHex(brand, surface, 0.55),
      'brand-text': mixHex(brand, '#ffffff', 0.5),
      'brand-on-ink': mixHex(brand, '#ffffff', 0.45),
    };
  }
  return {
    brand,
    'brand-hover': `color-mix(in oklab, ${brand} 88%, #000)`,
    'brand-active': `color-mix(in oklab, ${brand} 78%, #000)`,
    'brand-subtle': `color-mix(in oklab, ${brand} 9%, #fff)`,
    'brand-border': `color-mix(in oklab, ${brand} 28%, #fff)`,
    'brand-text': `color-mix(in oklab, ${brand} 82%, #000)`,
    'brand-on-ink': `color-mix(in oklab, ${brand} 55%, #fff)`,
  };
}

/**
 * Todas as CSS variables (`--color-*`) de um tema. `brandOverride` e a cor
 * propria do pet shop, quando ele escolhe usa-la no lugar da cor do tema.
 */
export function themeCssVariables(themeId: ThemeId, brandOverride?: string | null): Record<`--color-${string}`, string> {
  const theme = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID];
  const values: Record<string, string> = {
    ...theme.tokens,
    ...brandDerivedTokens(brandOverride || theme.tokens.brand, theme.mode, theme.tokens.surface),
  };
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [`--color-${name}`, value])) as Record<
    `--color-${string}`,
    string
  >;
}

/** Nomes de todas as variaveis que um tema controla (para limpar no logout). */
export const THEME_CSS_VARIABLE_NAMES = Object.keys(themeCssVariables(DEFAULT_THEME_ID));
