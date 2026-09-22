import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { asc } from 'drizzle-orm';
import { getDatabase, getScriptExecutor } from './client.js';
import { logger } from '../core/logger.js';

/**
 * Migrador proprio, em vez de drizzle-kit.
 *
 * Motivo: precisamos de controle total sobre RLS, criacao de roles, GRANTs
 * por coluna, indices parciais e FKs compostas. Geradores de migration a
 * partir do schema do ORM nao representam nada disso, e um schema de
 * seguranca que o gerador "nao ve" e um schema que ele silenciosamente
 * apaga na proxima geracao.
 *
 * O custo dessa escolha -- risco de divergencia entre o SQL e o schema do
 * Drizzle -- e coberto por um teste automatico (schema-drift.test.ts) que
 * compara as definicoes do ORM com o information_schema do banco real.
 *
 * O diretorio `migrations/` fica na raiz do pacote, um nivel acima tanto de
 * `src/` quanto de `dist/`, entao este caminho relativo vale para execucao
 * via tsx e para o build compilado.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const migrationsTable = pgTable('_migrations', {
  name: text('name').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((file) => file.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

export async function runMigrations(): Promise<MigrationResult> {
  const execScript = await getScriptExecutor();
  const db = await getDatabase();

  await execScript(CREATE_MIGRATIONS_TABLE);

  const alreadyApplied = await db
    .select({ name: migrationsTable.name })
    .from(migrationsTable)
    .orderBy(asc(migrationsTable.name));
  const appliedSet = new Set(alreadyApplied.map((row) => row.name));

  const files = await listMigrationFiles();
  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (appliedSet.has(file)) {
      result.skipped.push(file);
      continue;
    }

    const contents = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    // Nome de arquivo vem do repositorio, mas escapamos mesmo assim: um
    // literal SQL montado por concatenacao nunca deve confiar na origem.
    const escapedName = file.replace(/'/g, "''");

    // Aplicar a migration e registra-la acontecem na MESMA transacao. Em caso
    // de falha o Postgres transforma o COMMIT em ROLLBACK e nada fica pela
    // metade -- nem o schema, nem o registro.
    const script = [
      'BEGIN;',
      contents,
      `INSERT INTO _migrations (name) VALUES ('${escapedName}');`,
      'COMMIT;',
    ].join('\n');

    logger.info({ migration: file }, 'Aplicando migration');
    try {
      await execScript(script);
    } catch (error) {
      logger.error({ migration: file, err: error }, 'Falha ao aplicar migration');
      throw error;
    }
    result.applied.push(file);
  }

  return result;
}
