/**
 * Marca de "acabei de mandar o usuario para o checkout".
 *
 * O retorno do checkout NUNCA libera o PRO por si so (§13) -- quem decide e
 * sempre `GET /billing/status`, atualizado pelo webhook. Esta marca so serve
 * para a pagina de Billing saber que faz sentido mostrar "Estamos
 * confirmando seu pagamento..." e consultar o backend por um tempo limitado,
 * em vez de mostrar o estado normal (TRIAL/etc.) como se nada tivesse
 * acontecido.
 *
 * Guardada no proprio navegador (sessionStorage) porque e a UNICA forma que
 * temos de saber "o usuario voltou de um checkout" sem depender de conhecer
 * a URL de retorno que a Cakto usa -- ainda nao confirmada (ver CAKTO.md).
 * Funciona independente de para onde a Cakto redireciona de volta: assim que
 * a pessoa reabrir /billing ou /upgrade nesta mesma aba, a marca esta la.
 */
const STORAGE_KEY = 'petflow_checkout_started_at';
/** Depois disso, uma marca antiga e ignorada -- ninguem fica preso num aviso de dias atras. */
const MAX_AGE_MS = 30 * 60 * 1000;

export function markCheckoutStarted(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // sessionStorage pode falhar (aba privada, storage bloqueado) -- sem
    // problema, o pior caso e nao mostrar o aviso de confirmacao.
  }
}

export function isReturningFromCheckout(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function clearCheckoutStarted(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ver comentario acima.
  }
}
