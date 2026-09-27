import type { CatalogProductSuggestionDto } from '@petflow/contracts';

/**
 * Base GLOBAL de produtos (preparacao).
 *
 * Fluxo futuro: codigo de barras -> base global Petflow -> produto conhecido
 * (marca, nome, categoria, variante) -> "Encontramos este produto. Deseja
 * adiciona-lo ao seu estoque?". O cadastro/estoque continua SEMPRE do tenant:
 * a base global so sugere dados para o formulario.
 *
 * Hoje nenhuma base esta ligada (nenhuma API externa, nenhum dado inventado):
 * `lookup` devolve null e o pet shop cadastra manualmente.
 */
export interface ProductCatalogProvider {
  readonly name: string;
  readonly configured: boolean;
  lookup(code: string): Promise<CatalogProductSuggestionDto | null>;
}

class NoCatalogProvider implements ProductCatalogProvider {
  readonly name = 'none';
  readonly configured = false;

  async lookup(): Promise<CatalogProductSuggestionDto | null> {
    return null;
  }
}

let override: ProductCatalogProvider | null = null;

export function getProductCatalogProvider(): ProductCatalogProvider {
  return override ?? new NoCatalogProvider();
}

/** Somente testes. */
export function setProductCatalogProviderForTests(provider: ProductCatalogProvider | null): void {
  override = provider;
}
