-- =============================================================================
-- 0004 - Log de eventos de webhook de pagamento (idempotencia)
--
-- Append-only, como audit_logs. `(provider, event_id)` unico garante que
-- reentregas do mesmo evento (comportamento normal e esperado de qualquer
-- gateway de pagamento) nunca sejam processadas duas vezes -- a segunda
-- tentativa de INSERT falha por violacao de unicidade, sem precisar de
-- nenhuma logica extra de deduplicacao.
-- =============================================================================

CREATE TABLE billing_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text        NOT NULL,
  event_id       text        NOT NULL,
  event_type     text        NOT NULL,
  tenant_id      uuid REFERENCES tenants (id) ON DELETE SET NULL,
  payload        jsonb       NOT NULL,
  status         text        NOT NULL DEFAULT 'RECEIVED',
  error_message  text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,

  CONSTRAINT billing_events_status_valid CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
);

CREATE UNIQUE INDEX billing_events_provider_event_unique ON billing_events (provider, event_id);
CREATE INDEX billing_events_tenant_idx ON billing_events (tenant_id, received_at DESC);
CREATE INDEX billing_events_status_idx ON billing_events (status) WHERE status = 'RECEIVED';

-- RLS no mesmo padrao das demais tabelas de negocio. Na pratica, toda escrita
-- hoje acontece via `withSystem` (o webhook nao tem sessao de tenant -- ver
-- ADR do webhook em ARCHITECTURE.md), entao a policy nao entra em jogo agora,
-- mas deixa o caminho pronto para uma futura tela "historico de cobranca" por
-- tenant sem precisar de outra migration.
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_events_tenant_isolation ON billing_events
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON billing_events TO petflow_app;
