import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setCsrfToken } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devolve o corpo tipado em uma resposta de sucesso', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { name: 'Rex' }));
    const result = await apiRequest<{ name: string }>('/pets/1');
    expect(result).toEqual({ name: 'Rex' });
  });

  it('devolve undefined em 204 sem tentar parsear corpo', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiRequest('/customers/1');
    expect(result).toBeUndefined();
  });

  it('lanca ApiError com code/message/fields do envelope de erro da API', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Alguns campos precisam ser corrigidos.',
          fields: [{ field: 'name', message: 'Informe o nome.' }],
        },
      }),
    );

    await expect(apiRequest('/customers')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(422, {
        error: { code: 'VALIDATION_ERROR', message: 'x', fields: [{ field: 'name', message: 'Informe o nome.' }] },
      }),
    );
    try {
      await apiRequest('/customers');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldError('name')).toBe('Informe o nome.');
    }
  });

  it('trata falha de rede (fetch rejeitado) como ApiError de servico indisponivel', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/customers')).rejects.toMatchObject({ status: 0 });
  });

  it('nao inventa mensagem de erro quando o corpo nao segue o envelope esperado', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const error = await apiRequest('/customers').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).not.toContain('<html>');
  });
});

describe('apiRequest -- token CSRF', () => {
  /**
   * Regressao do bug de producao: com API e frontend em origens diferentes
   * (Railway/Vercel), `document.cookie` no frontend NUNCA enxerga um cookie
   * definido pela API -- entao o token precisa vir de `setCsrfToken`
   * (chamado a partir da resposta de /auth/me, nao de um cookie lido aqui).
   */
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setCsrfToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it('anexa X-CSRF-Token numa mutacao depois de setCsrfToken', async () => {
    setCsrfToken('token-de-teste');
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));

    await apiRequest('/customers', { method: 'POST', body: { name: 'Rex' } });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('token-de-teste');
  });

  it('nao anexa o header quando nenhum token foi definido ainda', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));

    await apiRequest('/customers', { method: 'POST', body: { name: 'Rex' } });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('nunca anexa o header em requisicoes GET, mesmo com token definido', async () => {
    setCsrfToken('token-de-teste');
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));

    await apiRequest('/customers');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });
});
