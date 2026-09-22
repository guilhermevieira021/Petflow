import { sql } from 'drizzle-orm';
import { getDatabase, type Transaction } from './client.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Contexto que acompanha toda operacao de negocio.
 *
 * Nenhum servico recebe `tenantId` solto como string -- recebe este objeto,
 * produzido exclusivamente a partir da sessao autenticada. E impossivel
 * fabricar um TenantContext a partir do payload da requisicao.
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} invalido: valor nao e um UUID.`);
  }
}

/**
 * Executa `fn` numa transacao restrita ao tenant informado.
 *
 * Dentro dela a conexao assume a role `petflow_app`, que so enxerga linhas do
 * tenant ativo por forca das policies de RLS. Um bug que esqueca o
 * `WHERE tenant_id = ...` ainda assim nao vaza dados.
 *
 * `SET LOCAL` reverte automaticamente no fim da transacao, entao a conexao
 * volta limpa para o pool.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId, 'tenantId');
  const db = await getDatabase();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE petflow_app`);
    // set_config aceita parametro; SET LOCAL nao. Alem de evitar injecao,
    // is_local = true garante o escopo transacional.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Transacao do caminho de autenticacao (pre-sessao).
 *
 * USO RESTRITO a src/modules/auth. Assume a role `petflow_bootstrap`, que
 * enxerga users/sessions de todos os tenants -- necessario porque o login
 * recebe apenas um email e ainda nao sabe a qual tenant ele pertence -- mas
 * nao tem qualquer acesso a dado de negocio.
 */
export async function withBootstrap<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE petflow_bootstrap`);
    return fn(tx);
  });
}

/**
 * Transacao privilegiada, SEM RLS.
 *
 * USO RESTRITO a cinco situacoes, todas elas anteriores a existencia de uma
 * sessao de tenant ou externas ao ciclo de request:
 *   1. cadastro publico (cria o tenant, o primeiro OWNER e a assinatura trial);
 *   2. migrations;
 *   3. seed de desenvolvimento;
 *   4. webhook do gateway de pagamento (o tenant vem do payload, ja
 *      autenticado pelo mecanismo do provider -- nao ha cookie de sessao;
 *      ver CAKTO.md para o estado atual da integracao Cakto);
 *   5. leitura do catalogo publico de planos (GET /api/plans) -- nao ha dado
 *      de tenant nenhum ali, e a pagina de precos precisa funcionar para
 *      visitante sem sessao.
 *
 * Qualquer outro uso e bug de arquitetura. Se voce esta aqui para "resolver"
 * um caso em que o RLS atrapalhou, o problema quase certamente e a consulta.
 */
export async function withSystem<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await getDatabase();
  return db.transaction(async (tx) => fn(tx));
}

/**
 * Serializa operacoes concorrentes por chave dentro da transacao corrente.
 * O lock e liberado automaticamente no COMMIT/ROLLBACK.
 *
 * Usado para impedir double booking: duas requisicoes simultaneas para o mesmo
 * profissional serializam aqui, entao a segunda enxerga o agendamento da
 * primeira na verificacao de conflito.
 */
export async function acquireTransactionLock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
