/** Faixa dos diacriticos combinantes produzidos pela normalizacao NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Normaliza um nome comercial para um slug seguro em URL. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    // "Cao & Cia do Bairro" -> "cao-cia-do-bairro"
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/**
 * Garante unicidade acrescentando sufixo numerico.
 * `exists` consulta o banco; o chamador decide o escopo da consulta.
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const normalized = slugify(base) || 'pet-shop';
  if (!(await exists(normalized))) return normalized;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${normalized.slice(0, 44)}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Ultimo recurso: sufixo aleatorio. Colisao aqui e praticamente impossivel.
  return `${normalized.slice(0, 40)}-${Math.floor(Math.random() * 100_000)}`;
}
