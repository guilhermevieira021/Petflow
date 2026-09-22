import type { BillingStatusDto } from '@petflow/contracts';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TrialBanner } from './TrialBanner';

const BASE_PLAN: BillingStatusDto['plan'] = {
  id: 'plan-trial',
  code: 'TRIAL',
  name: 'Teste gratuito',
  priceCents: 0,
  currency: 'BRL',
  billingPeriod: null,
  trialHours: 48,
  limits: { customers: 10, pets: 15, appointments: 10, services: 5, users: 2 },
  features: [],
};

function billing(overrides: Partial<BillingStatusDto>): BillingStatusDto {
  return {
    plan: BASE_PLAN,
    subscription: {
      id: 'sub-1',
      tenantId: 'tenant-1',
      planCode: 'TRIAL',
      status: 'TRIALING',
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      createdAt: new Date().toISOString(),
    },
    usage: {
      customers: { used: 0, limit: 10 },
      pets: { used: 0, limit: 15 },
      appointments: { used: 0, limit: 10 },
      services: { used: 0, limit: 5 },
      users: { used: 1, limit: 2 },
    },
    trial: { active: false, endsAt: null, hoursRemaining: null },
    access: { blocked: false, reason: null },
    ...overrides,
  };
}

function renderBanner(data: BillingStatusDto) {
  return render(<TrialBanner billing={data} />, { wrapper: MemoryRouter });
}

describe('TrialBanner', () => {
  it('nao renderiza nada para uma assinatura PRO ativa e saudavel', () => {
    const { container } = renderBanner(
      billing({ subscription: { ...billing({}).subscription, status: 'ACTIVE', planCode: 'PRO' } }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra o countdown em horas quando faltam ate 24h', () => {
    renderBanner(billing({ trial: { active: true, hoursRemaining: 20, endsAt: new Date().toISOString() } }));
    expect(screen.getByText(/seu teste termina em 20h/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver planos/i })).toHaveAttribute('href', '/planos');
  });

  it('mostra o countdown em dias quando falta mais de 24h', () => {
    renderBanner(billing({ trial: { active: true, hoursRemaining: 41, endsAt: new Date().toISOString() } }));
    expect(screen.getByText(/seu teste termina em 2 dia\(s\)/i)).toBeInTheDocument();
  });

  it('mostra o paywall quando o acesso esta bloqueado por trial vencido', () => {
    renderBanner(
      billing({
        access: { blocked: true, reason: 'TRIAL_EXPIRED' },
        trial: { active: false, hoursRemaining: 0, endsAt: new Date().toISOString() },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/periodo de teste terminou/i);
    expect(screen.getByRole('link', { name: /escolher plano/i })).toHaveAttribute('href', '/upgrade');
  });

  it('avisa sobre pagamento pendente em PAST_DUE', () => {
    renderBanner(billing({ subscription: { ...billing({}).subscription, status: 'PAST_DUE' } }));
    expect(screen.getByRole('alert')).toHaveTextContent(/problema com o pagamento/i);
  });
});
