-- =============================================================================
-- 0008 - Mensagens: templates configuraveis e rastreio de envio
--
-- Templates: quando o pet shop nao personalizou um tipo, o servico usa o
-- texto padrao definido em @petflow/contracts (sem inserir linhas por tenant
-- aqui). So o que o tenant EDITOU vira linha nesta tabela.
--
-- messages ganha: template usado, destinatario (telefone em digitos no
-- momento do envio) e o provider que tentou enviar. Status continua o mesmo
-- conjunto da 0001 -- em particular, uma mensagem que NAO foi entregue a
-- nenhum provider permanece DRAFT, nunca SENT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type       text        NOT NULL,
  name       text        NOT NULL,
  body       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_templates_type_valid CHECK (
    type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION',
             'RETURN_INVITE', 'CUSTOM')
  ),
  CONSTRAINT message_templates_name_not_blank CHECK (length(btrim(name)) >= 2),
  CONSTRAINT message_templates_body_length CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_id_tenant_unique ON message_templates (id, tenant_id);
-- Um template por tipo automatico; CUSTOM pode ter varios.
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_tenant_type_unique
  ON message_templates (tenant_id, type) WHERE type <> 'CUSTOM';

DROP TRIGGER IF EXISTS message_templates_set_updated_at ON message_templates;
CREATE TRIGGER message_templates_set_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_template_same_tenant') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_template_same_tenant
      FOREIGN KEY (template_id, tenant_id) REFERENCES message_templates (id, tenant_id)
      ON DELETE SET NULL (template_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_recipient_digits') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_recipient_digits
      CHECK (recipient IS NULL OR recipient ~ '^[0-9]{10,13}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_provider_valid') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_provider_valid
      CHECK (provider IS NULL OR provider IN ('link', 'cloud_api'));
  END IF;
END;
$$;

-- Novo tipo: aviso de cancelamento. Recria o CHECK com o conjunto ampliado.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_valid;
ALTER TABLE messages ADD CONSTRAINT messages_type_valid CHECK (
  type IN ('APPOINTMENT_REMINDER', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_CANCELLATION',
           'POST_SERVICE_FOLLOWUP', 'RETURN_INVITE', 'WINBACK', 'MANUAL')
);

CREATE INDEX IF NOT EXISTS messages_appointment_idx ON messages (appointment_id);
-- Webhook de status do provider (futuro) localiza a mensagem por este id.
CREATE INDEX IF NOT EXISTS messages_provider_message_idx
  ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO petflow_app;

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_templates_tenant_isolation ON message_templates;
CREATE POLICY message_templates_tenant_isolation ON message_templates
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
