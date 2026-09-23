/**
 * Formatacao para exibicao. Toda a interface fala pt-BR e R$.
 * O backend sempre entrega numero e ISO 8601; a conversao acontece so aqui.
 */

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const compactCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return currencyFormatter.format(value);
}

/** Para eixos de grafico e espacos apertados: R$ 1,2 mil. */
export function formatMoneyCompact(value: number): string {
  return compactCurrencyFormatter.format(value);
}

/**
 * `received / expected` como percentual, ex.: 62%. `null` quando nao ha
 * base de calculo (`expected` zero ou negativo) -- nesse caso a tela mostra
 * "--" em vez de inventar 0% ou 100%, que mentiriam sobre "nada previsto".
 */
export function realizedPercentage(expected: number, received: number): number | null {
  if (expected <= 0) return null;
  return Math.round((received / expected) * 100);
}

export function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value}%`;
}

/** (11) 98888-7777 a partir de digitos puros. */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  const clean = digits.replace(/\D/g, '');
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }
  return clean;
}

/**
 * `timeZone` e opcional em todos os formatadores abaixo. Quando informado
 * (o fuso configurado do tenant, vindo de `session.tenant.timezone` ou de
 * `dashboard.timezone`), a data/hora exibida corresponde ao "relogio da
 * parede" do pet shop, e nao ao fuso do navegador de quem esta olhando --
 * relevante para quem acessa de outro estado/fuso. Quando omitido, cai no
 * fuso do navegador (comportamento anterior, aceitavel para datas que nao
 * dependem de precisao de horario, como "ultima visita").
 */

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '--';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone }).format(new Date(iso));
}

export function formatDateLong(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone,
  }).format(new Date(iso));
}

/** "qua" a partir de um ISO -- usado nas colunas de data compactas da agenda. */
export function formatWeekdayShort(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '--';
  const value = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone }).format(new Date(iso));
  // pt-BR devolve "qua." com ponto; a lista fica mais limpa sem ele.
  return value.replace(/\.$/, '');
}

export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '--';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '--';
  return `${formatDate(iso, timeZone)} as ${formatTime(iso, timeZone)}`;
}

/** "ha 3 dias", "em 2 horas". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '--';
  const target = new Date(iso).getTime();
  const diffSeconds = Math.round((target - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return 'agora';
}

/** Iniciais para avatar, no maximo duas letras. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Link para abrir uma conversa no WhatsApp com a mensagem pre-preenchida.
 *
 * Isto NAO e uma integracao com a API do WhatsApp: apenas abre o aplicativo
 * com o texto pronto, e quem envia e a pessoa. E o comportamento correto
 * enquanto nenhum provider estiver configurado.
 */
export function whatsappLink(phone: string | null | undefined, message?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${withCountry}${text}`;
}
