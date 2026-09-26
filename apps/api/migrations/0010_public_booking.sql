-- =============================================================================
-- 0010 - Agendamento publico
--
-- O tutor, SEM sessao, envia uma SOLICITACAO. Ela nao vira agendamento
-- sozinha: o pet shop aceita (criando o agendamento pelo fluxo normal, com
-- checagem de conflito e limites) ou recusa. Assim o link publico nunca
-- escreve na agenda nem le dado de cliente.
--
-- Resolucao do tenant sem sessao e SEM withSystem: a funcao abaixo e
-- SECURITY DEFINER e devolve APENAS o id do pet shop cujo slug foi pedido e
-- cujo agendamento publico esta ligado. A requisicao publica roda como
-- petflow_app com app.tenant_id definido a partir dela -- ou seja, sob as
-- mesmas policies de RLS de qualquer outra requisicao.
-- =============================================================================

CREATE TABLE IF NOT EXISTS booking_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  service_id        uuid        NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  customer_name     text        NOT NULL,
  customer_phone    text        NOT NULL,
  pet_name          text        NOT NULL,
  pet_species       text        NOT NULL,
  notes             text,
  status            text        NOT NULL DEFAULT 'PENDING',
  -- Preenchidos quando o pet shop aceita:
  appointment_id    uuid,
  customer_id       uuid,
  pet_id            uuid,
  decided_at        timestamptz,
  decided_by        uuid,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_requests_status_valid CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  CONSTRAINT booking_requests_interval_valid CHECK (ends_at > starts_at),
  CONSTRAINT booking_requests_name_not_blank CHECK (length(btrim(customer_name)) >= 2),
  CONSTRAINT booking_requests_pet_name_not_blank CHECK (length(btrim(pet_name)) >= 1),
  CONSTRAINT booking_requests_phone_digits CHECK (customer_phone ~ '^[0-9]{10,11}$'),
  CONSTRAINT booking_requests_species_valid CHECK (
    pet_species IN ('DOG', 'CAT', 'BIRD', 'RODENT', 'REPTILE', 'OTHER')
  ),
  CONSTRAINT booking_requests_decision_consistent CHECK (
    (status = 'PENDING') = (decided_at IS NULL)
  ),
  CONSTRAINT booking_requests_accepted_has_appointment CHECK (
    status <> 'ACCEPTED' OR appointment_id IS NOT NULL
  ),
  CONSTRAINT booking_requests_service_same_tenant
    FOREIGN KEY (service_id, tenant_id) REFERENCES services (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_requests_appointment_same_tenant
    FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments (id, tenant_id) ON DELETE SET NULL (appointment_id),
  CONSTRAINT booking_requests_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE SET NULL (customer_id),
  CONSTRAINT booking_requests_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE SET NULL (pet_id),
  CONSTRAINT booking_requests_decided_by_same_tenant
    FOREIGN KEY (decided_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (decided_by)
);

CREATE INDEX IF NOT EXISTS booking_requests_tenant_status_idx
  ON booking_requests (tenant_id, status, starts_at);
CREATE INDEX IF NOT EXISTS booking_requests_pending_window_idx
  ON booking_requests (tenant_id, starts_at, ends_at) WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS booking_requests_set_updated_at ON booking_requests;
CREATE TRIGGER booking_requests_set_updated_at
  BEFORE UPDATE ON booking_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON booking_requests TO petflow_app;

ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_requests_tenant_isolation ON booking_requests;
CREATE POLICY booking_requests_tenant_isolation ON booking_requests
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- Resolucao publica do tenant pelo slug
--
-- Devolve somente o UUID -- nenhum outro dado -- e somente quando o pet shop
-- ligou o agendamento publico nas configuracoes. Para qualquer outro slug
-- (inexistente, removido ou com o recurso desligado) devolve NULL, sem
-- distinguir os casos: o link publico nao serve para descobrir quais pet
-- shops existem.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public_booking_tenant(p_slug text) RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id
  FROM tenants
  WHERE slug = lower(btrim(p_slug))
    AND deleted_at IS NULL
    AND COALESCE((settings -> 'publicBooking' ->> 'enabled')::boolean, false)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_booking_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_booking_tenant(text) TO petflow_app;
