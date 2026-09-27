-- =============================================================================
-- 0011 - Estoque profissional (marcas, leitor de codigo de barras, origem das
-- movimentacoes) e WhatsApp (reagendamento, pos-atendimento, lembretes).
--
-- Complementa a 0007/0008 SEM edita-las. Idempotente: IF NOT EXISTS, DROP ...
-- IF EXISTS antes de recriar CHECKs/policies/triggers, e INSERT ... ON
-- CONFLICT DO NOTHING no catalogo de referencia.
--
-- Nada aqui toca plans/subscriptions/billing_events (assinatura Petflow).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BRANDS
--
-- Uma unica tabela com dois tipos de linha:
--   tenant_id IS NULL  -> marca de REFERENCIA do catalogo Petflow (so leitura
--                         para os pet shops; mantida por migration).
--   tenant_id = X      -> marca cadastrada pelo pet shop X (editavel por ele).
-- Marcas de referencia sao apenas nomes: nenhum produto, preco ou codigo de
-- barras e criado junto.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        REFERENCES tenants (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  -- Segmento principal, so para agrupar/filtrar na tela.
  segment    text        NOT NULL DEFAULT 'GENERAL',
  active     boolean     NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brands_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT brands_segment_valid CHECK (
    segment IN ('FOOD', 'HEALTH', 'HYGIENE', 'ACCESSORIES', 'LITTER', 'AQUARIUM_BIRDS', 'GENERAL')
  ),
  CONSTRAINT brands_created_by_same_tenant
    FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS brands_reference_name_unique
  ON brands (lower(btrim(name))) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brands_tenant_name_unique
  ON brands (tenant_id, lower(btrim(name))) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS brands_tenant_idx ON brands (tenant_id);

DROP TRIGGER IF EXISTS brands_set_updated_at ON brands;
CREATE TRIGGER brands_set_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON brands TO petflow_app;

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
-- Leitura: catalogo de referencia + as marcas do proprio tenant.
DROP POLICY IF EXISTS brands_read ON brands;
CREATE POLICY brands_read ON brands FOR SELECT TO petflow_app
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
-- Escrita: somente linhas do proprio tenant. Referencia (tenant_id NULL) nunca.
DROP POLICY IF EXISTS brands_tenant_insert ON brands;
CREATE POLICY brands_tenant_insert ON brands FOR INSERT TO petflow_app
  WITH CHECK (tenant_id = app_current_tenant());
DROP POLICY IF EXISTS brands_tenant_update ON brands;
CREATE POLICY brands_tenant_update ON brands FOR UPDATE TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Catalogo de referencia: marcas conhecidas do mercado pet brasileiro.
-- Apenas nomes. Duplicatas de grafia (ex.: "Premier" x "Premier Pet") foram
-- unificadas em um nome so.
INSERT INTO brands (tenant_id, name, segment) VALUES
  -- Alimentacao / racoes / petiscos
  (NULL, 'Special Dog', 'FOOD'),
  (NULL, 'Premier Pet', 'FOOD'),
  (NULL, 'Granvita', 'FOOD'),
  (NULL, 'Gran Plus', 'FOOD'),
  (NULL, 'Golden', 'FOOD'),
  (NULL, 'Fórmula Natural', 'FOOD'),
  (NULL, 'Biofresh', 'FOOD'),
  (NULL, 'Guabi Natural', 'FOOD'),
  (NULL, 'Magnus', 'FOOD'),
  (NULL, 'Farmina', 'FOOD'),
  (NULL, 'N&D', 'FOOD'),
  (NULL, 'Royal Canin', 'FOOD'),
  (NULL, 'Hill''s', 'FOOD'),
  (NULL, 'Purina', 'FOOD'),
  (NULL, 'Pro Plan', 'FOOD'),
  (NULL, 'Dog Chow', 'FOOD'),
  (NULL, 'Cat Chow', 'FOOD'),
  (NULL, 'Pedigree', 'FOOD'),
  (NULL, 'Whiskas', 'FOOD'),
  (NULL, 'Three Cats', 'FOOD'),
  (NULL, 'Baw Waw', 'FOOD'),
  (NULL, 'Keldog', 'FOOD'),
  (NULL, 'Equilíbrio', 'FOOD'),
  (NULL, 'Cobasi', 'GENERAL'),
  (NULL, 'Zee.Dog', 'ACCESSORIES'),
  (NULL, 'Adimax', 'FOOD'),
  (NULL, 'Quatree', 'FOOD'),
  (NULL, 'Monello', 'FOOD'),
  (NULL, 'Dreamies', 'FOOD'),
  -- Saude / antiparasitarios / medicamentos veterinarios
  (NULL, 'NexGard', 'HEALTH'),
  (NULL, 'Bravecto', 'HEALTH'),
  (NULL, 'Simparic', 'HEALTH'),
  (NULL, 'Frontline', 'HEALTH'),
  (NULL, 'Advocate', 'HEALTH'),
  (NULL, 'Seresto', 'HEALTH'),
  (NULL, 'Revolution', 'HEALTH'),
  (NULL, 'Credeli', 'HEALTH'),
  (NULL, 'Drontal', 'HEALTH'),
  (NULL, 'Zoetis', 'HEALTH'),
  (NULL, 'MSD Saúde Animal', 'HEALTH'),
  (NULL, 'Boehringer Ingelheim', 'HEALTH'),
  (NULL, 'Elanco', 'HEALTH'),
  (NULL, 'Ceva', 'HEALTH'),
  (NULL, 'Virbac', 'HEALTH'),
  (NULL, 'Vetoquinol', 'HEALTH'),
  (NULL, 'Ourofino', 'HEALTH'),
  (NULL, 'Vetnil', 'HEALTH'),
  (NULL, 'König', 'HEALTH'),
  (NULL, 'Agener União', 'HEALTH'),
  (NULL, 'Syntec', 'HEALTH'),
  -- Higiene / banho e tosa
  (NULL, 'Sanol Dog', 'HYGIENE'),
  (NULL, 'Pet Clean', 'HYGIENE'),
  (NULL, 'Pet Society', 'HYGIENE'),
  (NULL, 'Perigot', 'HYGIENE'),
  (NULL, 'Super Secão', 'HYGIENE'),
  -- Areia sanitaria
  (NULL, 'Pipicat', 'LITTER'),
  (NULL, 'Kelco', 'LITTER'),
  (NULL, 'Viva Verde', 'LITTER'),
  -- Brinquedos / acessorios
  (NULL, 'Chalesco', 'ACCESSORIES'),
  (NULL, 'Furacão Pet', 'ACCESSORIES'),
  (NULL, 'Jambo Pet', 'ACCESSORIES'),
  (NULL, 'São Pet', 'ACCESSORIES'),
  (NULL, 'Kong', 'ACCESSORIES'),
  (NULL, 'Chuckit!', 'ACCESSORIES'),
  (NULL, 'Nylabone', 'ACCESSORIES'),
  -- Aquarismo / aves / roedores
  (NULL, 'Alcon', 'AQUARIUM_BIRDS'),
  (NULL, 'Tetra', 'AQUARIUM_BIRDS'),
  (NULL, 'Nutrópica', 'AQUARIUM_BIRDS'),
  (NULL, 'Megazoo', 'AQUARIUM_BIRDS')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- PRODUCTS: marca e descricao
-- ---------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id uuid;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_fk') THEN
    ALTER TABLE products ADD CONSTRAINT products_brand_fk
      FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_description_length') THEN
    ALTER TABLE products ADD CONSTRAINT products_description_length
      CHECK (description IS NULL OR length(description) <= 1000);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS products_brand_idx ON products (brand_id) WHERE brand_id IS NOT NULL;

-- A FK simples nao sabe de tenant (marcas de referencia tem tenant_id NULL,
-- entao nao da para usar FK composta). Esta trigger garante que um produto so
-- aponte para marca de referencia ou do PROPRIO pet shop. Roda como a role da
-- sessao: sob RLS, a marca de outro tenant simplesmente nao e encontrada.
CREATE OR REPLACE FUNCTION products_brand_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands b
    WHERE b.id = NEW.brand_id AND (b.tenant_id IS NULL OR b.tenant_id = NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION 'brand % does not belong to tenant %', NEW.brand_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_brand_same_tenant ON products;
CREATE TRIGGER products_brand_same_tenant
  BEFORE INSERT OR UPDATE OF brand_id ON products
  FOR EACH ROW EXECUTE FUNCTION products_brand_same_tenant();

-- ---------------------------------------------------------------------------
-- STOCK_MOVEMENTS: devolucao de cliente, origem e codigo lido
-- ---------------------------------------------------------------------------

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL';
-- Codigo de barras do produto no momento da movimentacao (ou o codigo lido
-- pelo leitor). Congelado: trocar o codigo do produto depois nao reescreve.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS barcode text;

-- Movimentacoes de venda anteriores a esta migration vieram do modulo de vendas.
UPDATE stock_movements SET source = 'SALE'
WHERE type IN ('SALE', 'SALE_CANCELLATION') AND source = 'MANUAL';

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source_valid
  CHECK (source IN ('MANUAL', 'BARCODE', 'SALE', 'PRODUCT_CREATION'));

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_valid CHECK (
  type IN ('IN', 'OUT', 'ADJUSTMENT', 'SALE', 'SALE_CANCELLATION', 'RETURN')
);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_direction_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_direction_valid CHECK (
  (type IN ('IN', 'SALE_CANCELLATION', 'RETURN') AND quantity > 0)
  OR (type IN ('OUT', 'SALE') AND quantity < 0)
  OR type = 'ADJUSTMENT'
);

CREATE INDEX IF NOT EXISTS stock_movements_tenant_source_idx ON stock_movements (tenant_id, source, created_at DESC);

-- ---------------------------------------------------------------------------
-- MENSAGENS: reagendamento e pos-atendimento
-- ---------------------------------------------------------------------------

ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_type_valid;
ALTER TABLE message_templates ADD CONSTRAINT message_templates_type_valid CHECK (
  type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION',
           'APPOINTMENT_RESCHEDULE', 'POST_SERVICE_FOLLOWUP', 'RETURN_INVITE', 'CUSTOM')
);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_valid;
ALTER TABLE messages ADD CONSTRAINT messages_type_valid CHECK (
  type IN ('APPOINTMENT_REMINDER', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_CANCELLATION',
           'APPOINTMENT_RESCHEDULE', 'POST_SERVICE_FOLLOWUP', 'RETURN_INVITE', 'WINBACK', 'MANUAL')
);

-- Geracao de lembretes e idempotente por agendamento: esta busca precisa ser barata.
CREATE INDEX IF NOT EXISTS messages_appointment_type_idx ON messages (appointment_id, type)
  WHERE appointment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- REMINDERS (tabela da 0001, ate aqui sem uso): fila de lembretes.
--
-- GERACAO: ao criar/remarcar um agendamento, uma linha PENDING e agendada
-- para (inicio - antecedencia configurada). ENVIO: um processamento separado
-- (worker/cron no futuro, ou o botao "Processar lembretes") pega as linhas
-- vencidas, gera a mensagem e registra o resultado REAL:
--   SENT       -> aceita pela WhatsApp Business API
--   REGISTERED -> mensagem gerada, mas NAO enviada (API nao configurada)
--   FAILED     -> a API recusou / falhou
--   SKIPPED    -> nao gerada (template desativado, agendamento ja passou...)
--   CANCELLED  -> agendamento cancelado ou remarcado antes do processamento
-- ---------------------------------------------------------------------------

-- Alvo da FK composta abaixo (mesmo padrao das demais tabelas de negocio).
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_tenant_unique ON messages (id, tenant_id);

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS message_id uuid;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_message_same_tenant') THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_message_same_tenant
      FOREIGN KEY (message_id, tenant_id) REFERENCES messages (id, tenant_id) ON DELETE SET NULL (message_id);
  END IF;
END;
$$;

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_valid;
ALTER TABLE reminders ADD CONSTRAINT reminders_status_valid
  CHECK (status IN ('PENDING', 'SENT', 'REGISTERED', 'CANCELLED', 'FAILED', 'SKIPPED'));

-- No maximo UM lembrete pendente por agendamento: remarcar substitui o anterior.
CREATE UNIQUE INDEX IF NOT EXISTS reminders_appointment_pending_unique
  ON reminders (appointment_id) WHERE type = 'APPOINTMENT' AND status = 'PENDING';
