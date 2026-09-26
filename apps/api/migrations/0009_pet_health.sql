-- =============================================================================
-- 0009 - Historico clinico do pet
--
-- Vacinas, vermifugos, medicamentos e observacoes clinicas em ordem
-- cronologica. `next_due_on` alimenta os alertas de vencimento e os retornos.
-- Datas de calendario puras (DATE), sem fuso: "vacina aplicada em 10/05" nao
-- muda de dia conforme o fuso de quem olha.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pet_health_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  pet_id      uuid        NOT NULL,
  type        text        NOT NULL,
  title       text        NOT NULL,
  occurred_on date        NOT NULL,
  next_due_on date,
  notes       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  CONSTRAINT pet_health_records_type_valid CHECK (
    type IN ('VACCINE', 'DEWORMER', 'MEDICATION', 'CLINICAL_NOTE')
  ),
  CONSTRAINT pet_health_records_title_not_blank CHECK (length(btrim(title)) >= 2),
  CONSTRAINT pet_health_records_due_after_occurrence CHECK (next_due_on IS NULL OR next_due_on >= occurred_on),
  CONSTRAINT pet_health_records_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT pet_health_records_created_by_same_tenant
    FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by)
);

CREATE INDEX IF NOT EXISTS pet_health_records_pet_idx
  ON pet_health_records (tenant_id, pet_id, occurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pet_health_records_due_idx
  ON pet_health_records (tenant_id, next_due_on) WHERE next_due_on IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS pet_health_records_set_updated_at ON pet_health_records;
CREATE TRIGGER pet_health_records_set_updated_at
  BEFORE UPDATE ON pet_health_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON pet_health_records TO petflow_app;

ALTER TABLE pet_health_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pet_health_records_tenant_isolation ON pet_health_records;
CREATE POLICY pet_health_records_tenant_isolation ON pet_health_records
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
