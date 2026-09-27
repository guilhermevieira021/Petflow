-- =============================================================================
-- 0012 - Fornecedores, tipos de saida (perda/avaria), marcas adicionais e
-- porta para o webhook de status do WhatsApp.
--
-- Incremental e idempotente (IF NOT EXISTS / DROP ... IF EXISTS / ON CONFLICT).
-- Nao edita migrations anteriores. Nada aqui toca plans/subscriptions/
-- billing_events (assinatura Petflow).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SUPPLIERS: fornecedores do pet shop (sempre do tenant).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  -- CPF (11) ou CNPJ (14), so digitos.
  document     text,
  phone        text,
  email        text,
  contact_name text,
  notes        text,
  active       boolean     NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT suppliers_name_not_blank CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT suppliers_document_digits CHECK (document IS NULL OR document ~ '^([0-9]{11}|[0-9]{14})$'),
  CONSTRAINT suppliers_phone_digits CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$'),
  CONSTRAINT suppliers_notes_length CHECK (notes IS NULL OR length(notes) <= 1000),
  CONSTRAINT suppliers_created_by_same_tenant
    FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_id_tenant_unique ON suppliers (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_name_unique ON suppliers (tenant_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers (tenant_id);

DROP TRIGGER IF EXISTS suppliers_set_updated_at ON suppliers;
CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON suppliers TO petflow_app;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_tenant_isolation ON suppliers;
CREATE POLICY suppliers_tenant_isolation ON suppliers FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Produto -> fornecedor (FK composta: nunca aponta para fornecedor de outro tenant).
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_supplier_same_tenant') THEN
    ALTER TABLE products ADD CONSTRAINT products_supplier_same_tenant
      FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers (id, tenant_id) ON DELETE SET NULL (supplier_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS products_supplier_idx ON products (supplier_id) WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- STOCK_MOVEMENTS: perda e avaria como tipos proprios (sempre saida).
-- ---------------------------------------------------------------------------

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_valid CHECK (
  type IN ('IN', 'OUT', 'ADJUSTMENT', 'SALE', 'SALE_CANCELLATION', 'RETURN', 'LOSS', 'DAMAGE')
);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_direction_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_direction_valid CHECK (
  (type IN ('IN', 'SALE_CANCELLATION', 'RETURN') AND quantity > 0)
  OR (type IN ('OUT', 'SALE', 'LOSS', 'DAMAGE') AND quantity < 0)
  OR type = 'ADJUSTMENT'
);

-- ---------------------------------------------------------------------------
-- BRANDS: marcas de referencia adicionais (somente nomes).
-- ---------------------------------------------------------------------------

INSERT INTO brands (tenant_id, name, segment) VALUES
  (NULL, 'Three Dogs', 'FOOD'),
  (NULL, 'Special Cat', 'FOOD'),
  (NULL, 'Origens', 'FOOD')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- WEBHOOK DE STATUS DO WHATSAPP
--
-- A Meta avisa "entregue/lida/falhou" informando so o id da mensagem
-- (wamid). Para atualizar a mensagem com RLS ligado, o servidor precisa
-- descobrir o tenant a partir desse id -- e SO isso. Mesmo desenho de
-- public_booking_tenant(): SECURITY DEFINER, devolve apenas o tenant_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION message_tenant_by_provider_id(p_provider_message_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.tenant_id
  FROM messages m
  WHERE m.provider_message_id = p_provider_message_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION message_tenant_by_provider_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION message_tenant_by_provider_id(text) TO petflow_app;
