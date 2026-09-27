import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSalePage } from './NewSalePage';

/** Caixa (PDV): bipes somam na mesma linha, estoque e produto desconhecido sao barrados. */

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('@/components/ui/Toast', () => ({ useToast: () => toast }));
vi.mock('@/features/auth/session', () => ({
  useCurrentSession: () => ({ tenant: { id: 'tenant-pdv-test', timezone: 'America/Sao_Paulo' } }),
  useSession: () => ({ can: () => true, session: { tenant: { id: 'tenant-pdv-test' } } }),
}));

const PRODUCT = {
  id: 'p1',
  name: 'Ração Premier 15kg',
  barcode: '7891000000011',
  salePrice: 189.9,
  stockQuantity: 2,
  trackStock: true,
  active: true,
  unit: 'UN',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let saleRequest: unknown = null;

beforeEach(() => {
  sessionStorage.clear();
  toast.success.mockReset();
  toast.error.mockReset();
  saleRequest = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/products/lookup')) {
        return url.includes('code=7891000000011')
          ? json(200, { status: 'FOUND', code: '7891000000011', matchedBy: 'BARCODE', product: PRODUCT })
          : json(200, { status: 'NOT_FOUND', code: '0000', catalogSuggestion: null });
      }
      if (url.endsWith('/sales') && init?.method === 'POST') {
        saleRequest = JSON.parse(String(init.body));
        return json(201, { id: 's1', number: 42, status: 'PAID', total: 379.8, items: [{ id: 'i1' }] });
      }
      return json(200, { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0, hasNext: false, hasPrevious: false } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NewSalePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function scan(code: string) {
  const input = screen.getByLabelText('Bipe o produto');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Caixa (PDV)', () => {
  it('bipar o mesmo produto soma na mesma linha e o total acompanha', async () => {
    renderPage();
    await scan('7891000000011');
    await waitFor(() => expect(screen.getByLabelText('Quantidade de Ração Premier 15kg')).toHaveValue('1'));
    await scan('7891000000011');
    await waitFor(() => expect(screen.getByLabelText('Quantidade de Ração Premier 15kg')).toHaveValue('2'));
    expect(within(screen.getByRole('list', { name: 'Itens da venda' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByText('R$ 379,80').length).toBeGreaterThan(0);
  });

  it('bipe alem do estoque e barrado com "Estoque insuficiente"', async () => {
    renderPage();
    await scan('7891000000011');
    await scan('7891000000011');
    await waitFor(() => expect(screen.getByLabelText('Quantidade de Ração Premier 15kg')).toHaveValue('2'));
    await scan('7891000000011');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Estoque insuficiente')));
    expect(screen.getByLabelText('Quantidade de Ração Premier 15kg')).toHaveValue('2');
  });

  it('codigo desconhecido: "Produto não encontrado." e nada entra no carrinho', async () => {
    renderPage();
    await scan('0000');
    expect(await screen.findByText('Produto não encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar produto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Digitar código novamente' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Itens da venda' })).toBeNull();
  });

  it('finalizar envia a venda e mostra "Venda concluída." com numero, total e forma de pagamento', async () => {
    renderPage();
    await scan('7891000000011');
    await scan('7891000000011');
    await waitFor(() => expect(screen.getByLabelText('Quantidade de Ração Premier 15kg')).toHaveValue('2'));
    fireEvent.click(screen.getByRole('radio', { name: /Dinheiro/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Finalizar venda' })[0]!);

    expect(await screen.findByText('Venda concluída.')).toBeInTheDocument();
    expect(saleRequest).toMatchObject({ items: [{ productId: 'p1', quantity: 2 }], payment: { method: 'CASH', paid: true } });
    expect(screen.getByText(/Venda #42/)).toBeInTheDocument();
    expect(screen.getByText('Dinheiro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nova venda/ })).toBeInTheDocument();
  });
});
