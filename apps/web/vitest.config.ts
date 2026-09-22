import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Config de testes separada do vite.config.ts de build.
 *
 * Cobre logica pura (formatacao, parsing de erro da API) e componentes
 * isolados (banners de billing) com Testing Library. Nao e E2E: um teste de
 * ponta a ponta de verdade precisaria de um navegador real (Playwright),
 * fora do escopo desta fase -- ver FRONTEND.md.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
