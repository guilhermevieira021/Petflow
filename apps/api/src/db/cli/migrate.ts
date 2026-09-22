import { closeDatabase } from '../client.js';
import { runMigrations } from '../migrator.js';
import { logger } from '../../core/logger.js';
import { env } from '../../config/env.js';

async function main(): Promise<void> {
  logger.info({ driver: env.DB_DRIVER }, 'Executando migrations');
  const result = await runMigrations();

  if (result.applied.length === 0) {
    logger.info({ skipped: result.skipped.length }, 'Banco ja esta atualizado');
  } else {
    logger.info({ applied: result.applied }, 'Migrations aplicadas');
  }
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    logger.error({ err: error instanceof Error ? error.message : error }, 'Migracao falhou');
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
