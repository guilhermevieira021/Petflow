import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Configuracao unica para todo o monorepo.
 *
 * Filosofia: poucas regras, todas com motivo. Uma configuracao com 200 regras
 * de estilo so ensina a equipe a rodar --fix sem ler. As regras aqui
 * apontam defeitos reais -- promessa nao aguardada, `any` solto, dependencia
 * faltando num hook.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.data/**',
      '**/coverage/**',
      'apps/web/dist/**',
      'packages/*/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // -------------------------------------------------------------------------
  // Backend
  // -------------------------------------------------------------------------
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` derruba a tipagem em silencio. Se for inevitavel, o desvio
      // precisa ser explicito e comentado.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // -------------------------------------------------------------------------
  // Frontend
  // -------------------------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // -------------------------------------------------------------------------
  // Scripts de CLI e testes: console faz parte do trabalho.
  // -------------------------------------------------------------------------
  {
    files: ['apps/api/src/db/cli/**/*.ts', 'apps/api/src/config/env.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },

  // -------------------------------------------------------------------------
  // Arquivos de configuracao
  // -------------------------------------------------------------------------
  {
    files: ['*.config.{js,ts}', '**/*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
