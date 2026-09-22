import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import { schema, type Schema } from './schema/index.js';

/**
 * Tipo canonico do banco na aplicacao.
 *
 * Usamos a tipagem do driver node-postgres como referencia porque e o driver
 * de producao. O driver PGlite (dev/teste) expoe exatamente a mesma superficie
 * do Drizzle -- select/insert/update/delete/execute/transaction -- e por isso
 * e convertido para este mesmo tipo num unico ponto, em `createPgliteDatabase`.
 * Esse e o unico cast do modulo, e existe para que nenhum outro arquivo do
 * projeto precise conhecer qual driver esta ativo.
 */
export type Database = NodePgDatabase<Schema>;

export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/** Handle de leitura/escrita: uma transacao ou o proprio banco. */
export type Executor = Database | Transaction;

interface DatabaseHandle {
  db: Database;
  /**
   * Executa um script com MULTIPLAS instrucoes (protocolo simples).
   *
   * Existe exclusivamente para as migrations: o `execute` do Drizzle usa o
   * protocolo estendido, que aceita uma instrucao por chamada, e um arquivo de
   * migration e inerentemente multi-instrucao. Nao use em codigo de aplicacao
   * -- esta funcao nao aceita parametros e portanto nao oferece protecao
   * contra injecao.
   */
  execScript: (sqlText: string) => Promise<void>;
  close: () => Promise<void>;
}

let handlePromise: Promise<DatabaseHandle> | null = null;

async function createPostgresDatabase(): Promise<DatabaseHandle> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    // Uma query presa nao pode travar um worker para sempre.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 15_000,
  });

  const db = drizzle(pool, { schema });
  return {
    db,
    execScript: async (sqlText) => {
      await pool.query(sqlText);
    },
    close: () => pool.end(),
  };
}

async function createPgliteDatabase(): Promise<DatabaseHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');

  const dataDir = env.PGLITE_DATA_DIR === 'memory://' ? undefined : env.PGLITE_DATA_DIR;
  if (dataDir) {
    // O PGlite nao cria diretorios intermediarios.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;

  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    execScript: async (sqlText) => {
      await client.exec(sqlText);
    },
    close: () => client.close(),
  };
}

async function createHandle(): Promise<DatabaseHandle> {
  return env.DB_DRIVER === 'postgres' ? createPostgresDatabase() : createPgliteDatabase();
}

/**
 * NAO exportamos o handle diretamente para fora do modulo `db`.
 * O acesso passa obrigatoriamente por withTenant/withBootstrap/withSystem,
 * que sao os unicos lugares que definem o contexto de RLS.
 */
export async function getDatabase(): Promise<Database> {
  handlePromise ??= createHandle();
  return (await handlePromise).db;
}

/** Ver `DatabaseHandle.execScript`. Restrito ao migrador. */
export async function getScriptExecutor(): Promise<(sqlText: string) => Promise<void>> {
  handlePromise ??= createHandle();
  return (await handlePromise).execScript;
}

export async function closeDatabase(): Promise<void> {
  if (!handlePromise) return;
  const handle = await handlePromise;
  handlePromise = null;
  await handle.close();
}
