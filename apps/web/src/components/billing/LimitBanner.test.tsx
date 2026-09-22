import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LimitBanner } from './LimitBanner';

describe('LimitBanner', () => {
  it('nao renderiza nada quando o uso esta baixo', () => {
    const { container } = render(<LimitBanner label="Clientes" entry={{ used: 2, limit: 10 }} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('nao renderiza nada quando o recurso e ilimitado', () => {
    const { container } = render(<LimitBanner label="Clientes" entry={{ used: 500, limit: null }} />, {
      wrapper: MemoryRouter,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra aviso a partir de 80% de uso', () => {
    render(<LimitBanner label="Clientes" entry={{ used: 8, limit: 10 }} />, { wrapper: MemoryRouter });
    expect(screen.getByText(/ja usou 8 de 10 clientes/i)).toBeInTheDocument();
  });

  it('mostra mensagem de limite atingido no maximo, com link de upgrade', () => {
    render(<LimitBanner label="Clientes" entry={{ used: 10, limit: 10 }} />, { wrapper: MemoryRouter });
    expect(screen.getByText(/atingiu o limite de 10 clientes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /fazer upgrade/i })).toHaveAttribute('href', '/planos');
  });
});
