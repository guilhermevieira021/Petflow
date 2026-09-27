import { z } from 'zod';

/**
 * Temas visuais do sistema autenticado.
 *
 * Aqui ficam so os IDENTIFICADORES e textos (a API valida e persiste a
 * escolha). Os tokens de cor de cada tema vivem no frontend
 * (apps/web/src/lib/theme/themes.ts), que e quem os aplica.
 */

export const ThemeId = {
  ORIGINAL: 'original',
  OCEAN: 'ocean',
  FOREST: 'forest',
  SUNSET: 'sunset',
  LAVENDER: 'lavender',
  /** Tema escuro. */
  MIDNIGHT: 'midnight',
} as const;
export type ThemeId = (typeof ThemeId)[keyof typeof ThemeId];

export const THEME_IDS = Object.values(ThemeId) as ThemeId[];

export const themeIdSchema = z.nativeEnum(ThemeId, {
  errorMap: () => ({ message: 'Tema inválido.' }),
});

/**
 * De onde vem a cor principal:
 *  - `theme`: a cor do tema escolhido;
 *  - `custom`: a cor propria do pet shop (tenants.primary_color), sobre o
 *    tema. E o padrao -- exatamente o comportamento anterior aos temas.
 */
export const BrandColorMode = { THEME: 'theme', CUSTOM: 'custom' } as const;
export type BrandColorMode = (typeof BrandColorMode)[keyof typeof BrandColorMode];

export const appearanceSettingsSchema = z
  .object({
    theme: themeIdSchema.default('original'),
    brandColorMode: z.nativeEnum(BrandColorMode, { errorMap: () => ({ message: 'Modo de cor inválido.' }) }).default('custom'),
  })
  .strict();
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'original', brandColorMode: 'custom' };

/** Aparencia do pet shop, legivel por qualquer usuario logado. */
export interface TenantAppearanceDto extends AppearanceSettings {
  primaryColor: string;
  logoUrl: string | null;
}
