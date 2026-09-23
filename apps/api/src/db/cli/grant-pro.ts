import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '../../core/logger.js';
import { closeDatabase } from '../client.js';
import { withSystem } from '../context.js';
import { subscriptions, users, type UserRow } from '../schema/index.js';
import { applyBillingWebhookEvent } from '../../modules/billing/billing.service.js';

/**
 * Concede PRO manualmente a UM tenant, identificado por email do OWNER --
 * para contas internas de teste/demonstracao, sem passar pela Cakto.
 *
 * NAO e um caminho paralelo de billing: chama `applyBillingWebhookEvent`,
 * a MESMA funcao que o webhook real usa (billing.service.ts) -- so muda de
 * onde o `tenantId` vem (aqui, de um email confirmado manualmente; no
 * webhook, de `resolveTenantIdFromCaktoEvent`). Nenhuma logica de assinatura
 * e duplicada ou contornada.
 *
 * So roda com acesso direto ao banco (`DATABASE_URL` real, via
 * `railway run` ou equivalente) -- nao existe nenhuma rota HTTP para isto,
 * de proposito: a API nunca aceita um tenant vindo do cliente para liberar
 * um plano.
 *
 * Uso: tsx --env-file-if-exists=../../.env src/db/cli/grant-pro.ts <email>
 */

const GRANT_PERIOD_DAYS = 30;

async function findOwnerByEmail(email: string): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();

  const rows = await withSystem((tx) =>
    tx
      .select()
      .from(users)
      .where(
        and(eq(users.email, normalized), eq(users.role, 'OWNER'), eq(users.active, true), isNull(users.deletedAt)),
      ),
  );

  if (rows.length === 0) {
    throw new Error(`Nenhum OWNER ativo encontrado com o email "${normalized}".`);
  }
  if (rows.length > 1) {
    // Nao deveria ser possivel (users.email e unico), mas nunca adivinha se
    // acontecer -- para e deixa para investigacao manual.
    throw new Error(
      `Mais de um usuario encontrado para "${normalized}" (${rows.length}) -- abortando, nao vou adivinhar qual.`,
    );
  }
  return rows[0]!;
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    throw new Error('Uso: npm run db:grant-pro -w @petflow/api -- <email>');
  }

  const owner = await findOwnerByEmail(email);
  logger.info(
    { email: owner.email, tenantId: owner.tenantId, userId: owner.id },
    'OWNER encontrado -- aplicando PRO/ACTIVE',
  );

  const paidAt = new Date();
  const currentPeriodEnd = new Date(paidAt.getTime() + GRANT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  await withSystem((tx) =>
    applyBillingWebhookEvent(tx, {
      tenantId: owner.tenantId,
      status: 'ACTIVE',
      planCode: 'PRO',
      currentPeriodEnd: currentPeriodEnd.toISOString(),
      // Nunca marcado como "cakto": isto nao veio de um pagamento real, e o
      // historico da assinatura precisa continuar honesto sobre isso.
      provider: 'manual-admin-grant',
    }),
  );

  const [row] = await withSystem((tx) =>
    tx.select().from(subscriptions).where(eq(subscriptions.tenantId, owner.tenantId)),
  );

  logger.info(
    {
      tenantId: owner.tenantId,
      status: row?.status,
      currentPeriodEnd: row?.currentPeriodEnd?.toISOString(),
      provider: row?.provider,
    },
    'PRO concedido -- confira os valores acima antes de considerar concluido',
  );
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    logger.error({ err: error instanceof Error ? error.message : error }, 'Falha ao conceder PRO');
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
