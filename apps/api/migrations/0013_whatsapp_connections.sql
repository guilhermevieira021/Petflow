-- =============================================================================
-- 0013 - WhatsApp Business por pet shop (multi-tenant).
--
-- Cada pet shop conecta o PROPRIO numero (WhatsApp Business Platform / Cloud
-- API oficial da Meta). Nada de WhatsApp Web, QR Code ou sessao simulada.
--
-- O token de acesso fica CRIPTOGRAFADO (AES-256-GCM, chave so no servidor:
-- WHATSAPP_TOKEN_ENCRYPTION_KEY). A API nunca o devolve -- so os 4 ultimos
-- caracteres, para o dono reconhecer qual token esta em uso.
--
-- Incremental e idempotente. Nao edita migrations anteriores.
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  status                 text        NOT NULL DEFAULT 'CONNECTED',
  connection_method      text        NOT NULL,
  -- Identificadores publicos da Meta (nao sao segredo).
  waba_id                text        NOT NULL,
  phone_number_id        text        NOT NULL,
  display_phone_number   text,
  verified_name          text,
  -- Numero pronto para a Cloud API (platform_type = CLOUD_API na Meta).
  cloud_api_ready        boolean     NOT NULL DEFAULT false,
  access_token_ciphertext text,
  token_last4            text,
  connected_by           uuid,
  connected_at           timestamptz,
  disconnected_at        timestamptz,
  last_checked_at        timestamptz,
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_connections_status_valid CHECK (status IN ('CONNECTED', 'DISCONNECTED', 'ERROR')),
  CONSTRAINT whatsapp_connections_method_valid CHECK (connection_method IN ('EMBEDDED_SIGNUP', 'MANUAL')),
  CONSTRAINT whatsapp_connections_ids_format CHECK (waba_id ~ '^[0-9]{5,32}$' AND phone_number_id ~ '^[0-9]{5,32}$'),
  -- Conectado exige token guardado; desconectado nao guarda token.
  CONSTRAINT whatsapp_connections_token_when_connected CHECK (
    (status = 'DISCONNECTED' AND access_token_ciphertext IS NULL) OR (status <> 'DISCONNECTED' AND access_token_ciphertext IS NOT NULL)
  ),
  CONSTRAINT whatsapp_connections_last_error_length CHECK (last_error IS NULL OR length(last_error) <= 500),
  CONSTRAINT whatsapp_connections_connected_by_same_tenant
    FOREIGN KEY (connected_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (connected_by)
);

-- Uma conexao por pet shop.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_tenant_unique ON whatsapp_connections (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_id_tenant_unique ON whatsapp_connections (id, tenant_id);
-- Um numero ativo pertence a UM pet shop so: a mensagem do A nunca sai pelo numero do B.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_phone_active_unique
  ON whatsapp_connections (phone_number_id) WHERE status <> 'DISCONNECTED';

DROP TRIGGER IF EXISTS whatsapp_connections_set_updated_at ON whatsapp_connections;
CREATE TRIGGER whatsapp_connections_set_updated_at
  BEFORE UPDATE ON whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON whatsapp_connections TO petflow_app;

ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_connections_tenant_isolation ON whatsapp_connections;
CREATE POLICY whatsapp_connections_tenant_isolation ON whatsapp_connections FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- Webhook: a Meta informa o phone_number_id que recebeu/enviou. Esta funcao
-- devolve APENAS o tenant dono desse numero (conexao ativa) -- mesmo desenho
-- de message_tenant_by_provider_id (0012).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION whatsapp_tenant_by_phone_number_id(p_phone_number_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.tenant_id
  FROM whatsapp_connections c
  WHERE c.phone_number_id = p_phone_number_id AND c.status <> 'DISCONNECTED'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION whatsapp_tenant_by_phone_number_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_tenant_by_phone_number_id(text) TO petflow_app;
