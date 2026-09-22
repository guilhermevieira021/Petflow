import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrator.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  // Em dev/teste aplicamos as migrations no boot para que `npm run dev`
  // funcione num clone limpo. Em producao isso e um passo deliberado do
  // deploy: subir o processo nao pode alterar o schema por conta propria.
  if (env.NODE_ENV !== 'production') {
    const result = await runMigrations();
    if (result.applied.length > 0) {
      logger.info({ applied: result.applied }, 'Migrations aplicadas no boot');
    }
  }

  const app = await buildServer();
  await app.listen({ port: env.PORT, host: env.HOST });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Encerrando servidor');
    try {
      await app.close();
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Falha ao encerrar');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error({ err: error instanceof Error ? error.message : error }, 'Falha ao iniciar a API');
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
