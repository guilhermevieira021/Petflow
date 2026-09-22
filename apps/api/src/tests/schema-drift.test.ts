import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase } from '../db/client.js';
import { withSystem } from '../db/context.js';
import { runMigrations } from '../db/migrator.js';
import { schema } from '../db/schema/index.js';
import { teardownTestApp } from './helpers.js';

/**
 * Guarda contra divergencia entre o SQL das migrations e o schema do Drizzle.
 *
 * Escrevemos as migrations a mao (ver ADR-003) para manter controle sobre RLS,
 * GRANTs e FKs compostas. O preco dessa escolha e a possibilidade de o schema
 * do ORM dizer uma coisa e o banco outra -- um bug silencioso e caro. Este
 * teste cobra esse preco a cada execucao da suite.
 */

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await teardownTestApp();
});

/**
 * Type alias (e nao interface) de proposito: `db.execute<T>` exige que T seja
 * compativel com Record<string, unknown>, e apenas aliases de objeto ganham a
 * assinatura de indice implicita que satisfaz essa restricao.
 */
type ColumnInfo = {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
};

async function loadDatabaseColumns(): Promise<Map<string, Map<string, ColumnInfo>>> {
  const db = await getDatabase();
  const result = await db.execute<ColumnInfo>(sql`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const byTable = new Map<string, Map<string, ColumnInfo>>();
  for (const row of result.rows) {
    const columns = byTable.get(row.table_name) ?? new Map<string, ColumnInfo>();
    columns.set(row.column_name, row);
    byTable.set(row.table_name, columns);
  }
  return byTable;
}

describe('Schema do ORM x schema real do banco', () => {
  it('toda tabela declarada no Drizzle existe no banco', async () => {
    const byTable = await loadDatabaseColumns();
    const missing = Object.values(schema)
      .map(getTableName)
      .filter((name) => !byTable.has(name));

    expect(missing).toEqual([]);
  });

  it('toda coluna declarada no Drizzle existe no banco, com a mesma nulidade', async () => {
    const byTable = await loadDatabaseColumns();
    const problems: string[] = [];

    for (const table of Object.values(schema)) {
      const tableName = getTableName(table);
      const dbColumns = byTable.get(tableName);
      if (!dbColumns) continue;

      for (const column of Object.values(getTableColumns(table))) {
        const dbColumn = dbColumns.get(column.name);
        if (!dbColumn) {
          problems.push(`${tableName}.${column.name}: declarada no ORM, ausente no banco`);
          continue;
        }

        const dbNotNull = dbColumn.is_nullable === 'NO';
        if (column.notNull !== dbNotNull) {
          problems.push(
            `${tableName}.${column.name}: ORM diz notNull=${String(column.notNull)}, ` +
              `banco diz notNull=${String(dbNotNull)}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

/**
 * Tabelas globais da plataforma: nao tem tenant_id porque nao sao dado de UM
 * pet shop -- sao o catalogo compartilhado por todos. `plans` e a unica hoje.
 * RLS nao se aplica a elas por definicao, entao ficam de fora das duas
 * checagens abaixo.
 */
const GLOBAL_CATALOG_TABLES = new Set(['plans']);

describe('Invariantes de seguranca do schema', () => {
  it('toda tabela de negocio tem RLS habilitado', async () => {
    const db = await getDatabase();
    const result = await db.execute<{ tablename: string; rowsecurity: boolean }>(sql`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_migrations'
    `);

    const semRls = result.rows
      .filter((row) => !row.rowsecurity && !GLOBAL_CATALOG_TABLES.has(row.tablename))
      .map((row) => row.tablename);
    expect(semRls).toEqual([]);
  });

  it('toda tabela com RLS tem ao menos uma policy de isolamento', async () => {
    const db = await getDatabase();
    const result = await db.execute<{ tablename: string; total: number }>(sql`
      SELECT tablename, count(*)::int AS total
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
    `);

    const comPolicy = new Set(result.rows.map((row) => row.tablename));
    const tabelasDeNegocio = Object.values(schema)
      .map(getTableName)
      .filter((name) => !GLOBAL_CATALOG_TABLES.has(name));

    for (const tabela of tabelasDeNegocio) {
      expect(comPolicy.has(tabela)).toBe(true);
    }
  });

  it('a role da aplicacao nao pode alterar nem apagar a trilha de auditoria', async () => {
    const db = await getDatabase();
    const result = await db.execute<{ privilege_type: string }>(sql`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_name = 'audit_logs' AND grantee = 'petflow_app'
    `);

    const privilegios = result.rows.map((row) => row.privilege_type).sort();
    expect(privilegios).toEqual(['INSERT', 'SELECT']);
  });

  it('a role de autenticacao nao alcanca nenhuma tabela de negocio', async () => {
    const db = await getDatabase();
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT table_name
      FROM information_schema.role_table_grants
      WHERE grantee = 'petflow_bootstrap'
    `);

    const alcancaveis = result.rows.map((row) => row.table_name).sort();
    // Exatamente estas tres, e nada de clientes, pets, agenda ou financeiro.
    expect(alcancaveis).toEqual(['password_reset_tokens', 'sessions', 'users']);
  });

  it('o tenant da transacao e obrigatorio: sem ele, nada e visivel', async () => {
    const db = await getDatabase();

    // Contexto de tenant AUSENTE, mas com a role da aplicacao assumida.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE petflow_app`);
      const result = await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM customers`,
      );
      return result.rows;
    });

    // Falha fechado: app_current_tenant() e NULL, entao nenhuma linha casa.
    expect(rows[0]?.total).toBe(0);
  });

  it('existe ao menos um registro visivel quando o contexto esta correto', async () => {
    const tenantId = await withSystem(async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`INSERT INTO tenants (name, slug, settings) VALUES ('Drift Check', 'drift-check', '{}'::jsonb) RETURNING id`,
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('fixture: tenant');
      await tx.execute(
        sql`INSERT INTO customers (tenant_id, name, phone) VALUES (${id}, 'Cliente Drift', '11988887777')`,
      );
      return id;
    });

    const db = await getDatabase();
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE petflow_app`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      const result = await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM customers`,
      );
      return result.rows;
    });

    expect(rows[0]?.total).toBe(1);
  });
});
