-- =============================================================================
-- 0003 - Planos, assinaturas e trial
--
-- `plans` e um catalogo global (nao tem tenant_id): e a tabela de precos da
-- plataforma, igual para todos os pet shops. `subscriptions` e por tenant e
-- segue a mesma politica de RLS das demais tabelas de negocio.
--
-- Os dois planos oficiais (TRIAL e PRO) sao inseridos AQUI, na migration, e
-- nao apenas no seed de desenvolvimento -- pricing/checkout dependem deles
-- existirem em qualquer ambiente, inclusive producao. O `ON CONFLICT` torna a
-- migration idempotente: reaplicar nao duplica nem falha.
-- =============================================================================

CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text        NOT NULL,
  name           text        NOT NULL,
  price_cents    integer     NOT NULL DEFAULT 0,
  currency       text        NOT NULL DEFAULT 'BRL',
  billing_period text,
  trial_hours    integer,
  limits         jsonb       NOT NULL,
  features       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plans_code_valid CHECK (code IN ('TRIAL', 'PRO')),
  CONSTRAINT plans_billing_period_valid CHECK (billing_period IS NULL OR billing_period = 'MONTHLY'),
  CONSTRAINT plans_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT plans_trial_hours_positive CHECK (trial_hours IS NULL OR trial_hours > 0)
);

CREATE UNIQUE INDEX plans_code_unique ON plans (code);

CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_id                 uuid        NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  status                  text        NOT NULL DEFAULT 'TRIALING',
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean     NOT NULL DEFAULT false,
  provider                text,
  provider_customer_id    text,
  provider_subscription_id text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_status_valid CHECK (
    status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')
  )
);

-- Um tenant tem, no maximo, UMA assinatura de cada vez.
CREATE UNIQUE INDEX subscriptions_tenant_unique ON subscriptions (tenant_id);
CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- plans e catalogo publico da plataforma: nenhum tenant_id, entao nao ha o
-- que isolar. A role da aplicacao so pode ler -- criar/alterar plano e
-- operacao administrativa fora do escopo desta fase, feita por migration.
-- Deliberadamente SEM grant para petflow_bootstrap: o fluxo de login nunca
-- precisa ler a tabela de planos, e "so conceder o que o modulo usa" e a
-- mesma logica que ja vale para users/sessions nessa role.
GRANT SELECT ON plans TO petflow_app;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant_isolation ON subscriptions
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON subscriptions TO petflow_app;

-- ---------------------------------------------------------------------------
-- Seed dos planos oficiais
-- ---------------------------------------------------------------------------

INSERT INTO plans (code, name, price_cents, currency, billing_period, trial_hours, limits, features, active)
VALUES
  (
    'TRIAL',
    'Teste gratuito',
    0,
    'BRL',
    NULL,
    48,
    '{"customers": 10, "pets": 15, "appointments": 10, "services": 5, "users": 2}'::jsonb,
    '[]'::jsonb,
    true
  ),
  (
    'PRO',
    'Pro',
    9990,
    'BRL',
    'MONTHLY',
    NULL,
    '{"customers": null, "pets": null, "appointments": null, "services": null, "users": 10}'::jsonb,
    '["advanced_reports", "automation", "unlimited_retention_window"]'::jsonb,
    true
  )
ON CONFLICT (code) DO NOTHING;
