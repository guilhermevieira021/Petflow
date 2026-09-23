import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Le .env/.env.example da raiz do monorepo (mesma convencao usada pela
  // API), em vez de exigir um .env separado dentro de apps/web.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxy para a API: o navegador enxerga tudo na mesma origem, entao o
    // cookie de sessao (SameSite=Lax) funciona em desenvolvimento sem que
    // precisemos afrouxar a configuracao para SameSite=None.
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
