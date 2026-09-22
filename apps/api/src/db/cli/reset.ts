import { rm } from 'node:fs/promises';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { closeDatabase, getScriptExecutor } from '../client.js';

/**
 * Apaga o banco de desenvolvimento por completo.
 *
 * Com PGlite basta remover o diretorio de dados. Com PostgreSQL, recriamos o
 * schema `public` -- o que derruba tabelas, indices, funcoes e policies, mas
 * preserva as roles (que sao objetos de cluster, nao de banco).
 */
async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('db:reset e destrutivo e nunca deve rodar em producao.');
  }

  if (env.DB_DRIVER === 'pglite') {
    await closeDatabase().catch(() => undefined);
    if (env.PGLITE_DATA_DIR !== 'memory://') {
      await rm(env.PGLITE_DATA_DIR, { recursive: true, force: true });
      logger.info({ dir: env.PGLITE_DATA_DIR }, 'Diretorio do PGlite removido');
    }
    return;
  }

  const execScript = await getScriptExecutor();
  await execScript('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  logger.info({ driver: env.DB_DRIVER }, 'Schema public recriado');
}

main()
  .then(() => closeDatabase().catch(() => undefined))
  .then(() => {
    logger.info('Banco reiniciado. Rode "npm run db:seed" para popular novamente.');
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error instanceof Error ? error.message : error }, 'Reset falhou');
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
