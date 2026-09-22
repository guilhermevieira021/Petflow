import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api';

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
