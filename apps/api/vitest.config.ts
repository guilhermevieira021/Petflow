import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Cada arquivo de teste cria (e depois fecha) sua propria instancia de
    // PGlite via o singleton em tests/helpers.ts. `singleFork` so limita o
    // NUMERO DE PROCESSOS -- por si so nao impede o Vitest de agendar as
    // hooks de arquivos diferentes de forma entrelacada dentro do mesmo
    // processo. Sem `fileParallelism: false`, o afterAll de um arquivo pode
    // fechar o banco enquanto outro arquivo ainda esta no meio dos seus
    // testes, causando falhas esporadicas dificeis de reproduzir isoladas.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DB_DRIVER: 'pglite',
      PGLITE_DATA_DIR: 'memory://',
      AUTH_SECRET: 'test-secret-com-mais-de-32-caracteres-para-passar-na-validacao',
      APP_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      MAIL_PROVIDER: 'console',
      WHATSAPP_PROVIDER: 'link',
      // So para exercitar o caminho autenticado do webhook em teste -- nao e
      // o segredo real da Cakto (ainda nao configurado em producao). Ver
      // cakto.test.ts e CAKTO.md.
      CAKTO_WEBHOOK_SECRET: 'segredo-de-teste-nao-e-o-real',
    },
  },
});
