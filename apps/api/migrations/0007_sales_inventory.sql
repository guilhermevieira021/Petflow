-- =============================================================================
-- 0007 - Vendas, recebimentos e estoque (FLUXO 1: dinheiro do pet shop)
--
-- Tudo aqui e o dinheiro que o PET SHOP recebe dos PROPRIOS clientes. Nada
-- nesta migration toca plans/subscriptions/billing_events (FLUXO 2: a
-- assinatura do Petflow via Cakto), e nenhuma tabela nova referencia aquelas.
--
-- Idempotente: pode ser reaplicada sem erro (IF NOT EXISTS / DROP ... IF
-- EXISTS antes de recriar policies e triggers).
--
-- Convencoes herdadas da 0001: tenant_id NOT NULL, FKs COMPOSTAS com
-- tenant_id, dinheiro NUMERIC(10,2), quantidades NUMERIC(12,3) (racao a
-- granel e vendida por kg), enums como TEXT + CHECK.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name           text           NOT NULL,
  -- Codigo interno do pet shop.
  sku            text,
  -- Codigo de barras (EAN/GTIN ou interno). Coluna propria e unica por
  -- tenant para que um leitor de codigo de barras possa ser plugado depois
  -- sem migration: a busca por codigo ja tem indice.
  barcode        text,
  category       text,
  unit           text           NOT NULL DEFAULT 'UN',
  sale_price     numeric(10, 2) NOT NULL,
  cost_price     numeric(10, 2),
  stock_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  min_stock      numeric(12, 3) NOT NULL DEFAULT 0,
  -- Servicos embalados, brindes etc. podem ser vendidos sem controlar saldo.
  track_stock    boolean        NOT NULL DEFAULT true,
  active         boolean        NOT NULL DEFAULT true,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT products_name_not_blank CHECK (length(btrim(name)) >= 2),
  CONSTRAINT products_unit_valid CHECK (unit IN ('UN', 'KG', 'L')),
  CONSTRAINT products_sale_price_non_negative CHECK (sale_price >= 0),
  CONSTRAINT products_cost_price_non_negative CHECK (cost_price IS NULL OR cost_price >= 0),
  CONSTRAINT products_min_stock_non_negative CHECK (min_stock >= 0),
  -- Saldo negativo so e possivel quando o produto NAO controla estoque.
  CONSTRAINT products_stock_non_negative CHECK (NOT track_stock OR stock_quantity >= 0),
  CONSTRAINT products_sku_format CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9._/-]{1,64}$'),
  CONSTRAINT products_barcode_format CHECK (barcode IS NULL OR barcode ~ '^[0-9A-Za-z-]{4,64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS products_id_tenant_unique ON products (id, tenant_id);
CREATE INDEX IF NOT EXISTS products_tenant_idx ON products (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_tenant_name_idx ON products (tenant_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique
  ON products (tenant_id, lower(sku)) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_unique
  ON products (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- SALES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sales (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Numero sequencial POR pet shop ("Venda #12"), atribuido sob advisory
  -- lock no servico.
  number              integer        NOT NULL,
  -- Opcional: venda de balcao para quem nao e cliente cadastrado.
  customer_id         uuid,
  pet_id              uuid,
  appointment_id      uuid,
  status              text           NOT NULL DEFAULT 'OPEN',
  subtotal            numeric(10, 2) NOT NULL,
  discount            numeric(10, 2) NOT NULL DEFAULT 0,
  total               numeric(10, 2) NOT NULL,
  sold_at             timestamptz    NOT NULL DEFAULT now(),
  notes               text,
  created_by          uuid,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),

  -- OPEN = registrada, ainda nao recebida por completo; PAID = quitada.
  CONSTRAINT sales_status_valid CHECK (status IN ('OPEN', 'PAID', 'CANCELLED')),
  CONSTRAINT sales_number_positive CHECK (number > 0),
  CONSTRAINT sales_subtotal_non_negative CHECK (subtotal >= 0),
  CONSTRAINT sales_discount_valid CHECK (discount >= 0 AND discount <= subtotal),
  CONSTRAINT sales_total_consistent CHECK (total = subtotal - discount),
  CONSTRAINT sales_cancelled_has_timestamp CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT sales_pet_requires_customer CHECK (pet_id IS NULL OR customer_id IS NOT NULL),
  CONSTRAINT sales_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sales_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sales_appointment_same_tenant
    FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sales_created_by_same_tenant
    FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_id_tenant_unique ON sales (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_number_unique ON sales (tenant_id, number);
CREATE INDEX IF NOT EXISTS sales_tenant_sold_idx ON sales (tenant_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS sales_tenant_status_idx ON sales (tenant_id, status);
CREATE INDEX IF NOT EXISTS sales_customer_idx ON sales (customer_id, sold_at DESC);

DROP TRIGGER IF EXISTS sales_set_updated_at ON sales;
CREATE TRIGGER sales_set_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- SALE ITEMS  (imutaveis depois de gravados: a venda e cancelada, nao editada)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sale_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  sale_id     uuid           NOT NULL,
  product_id  uuid,
  service_id  uuid,
  -- Descricao congelada no momento da venda: renomear o produto depois nao
  -- reescreve o historico.
  description text           NOT NULL,
  quantity    numeric(12, 3) NOT NULL,
  unit_price  numeric(10, 2) NOT NULL,
  total       numeric(10, 2) NOT NULL,
  created_at  timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT sale_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sale_items_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT sale_items_total_non_negative CHECK (total >= 0),
  CONSTRAINT sale_items_single_reference CHECK (product_id IS NULL OR service_id IS NULL),
  CONSTRAINT sale_items_description_not_blank CHECK (length(btrim(description)) >= 1),
  CONSTRAINT sale_items_sale_same_tenant
    FOREIGN KEY (sale_id, tenant_id) REFERENCES sales (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT sale_items_product_same_tenant
    FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_service_same_tenant
    FOREIGN KEY (service_id, tenant_id) REFERENCES services (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_idx ON sale_items (product_id);

-- ---------------------------------------------------------------------------
-- STOCK MOVEMENTS  (append-only: o historico nao se edita)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  product_id    uuid           NOT NULL,
  type          text           NOT NULL,
  -- Variacao ASSINADA do saldo: positiva entra, negativa sai.
  quantity      numeric(12, 3) NOT NULL,
  -- Saldo do produto logo apos esta movimentacao (trilha auditavel).
  balance_after numeric(12, 3) NOT NULL,
  unit_cost     numeric(10, 2),
  reason        text,
  sale_id       uuid,
  user_id       uuid,
  created_at    timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT stock_movements_type_valid CHECK (
    type IN ('IN', 'OUT', 'ADJUSTMENT', 'SALE', 'SALE_CANCELLATION')
  ),
  CONSTRAINT stock_movements_quantity_not_zero CHECK (quantity <> 0),
  CONSTRAINT stock_movements_direction_valid CHECK (
    (type IN ('IN', 'SALE_CANCELLATION') AND quantity > 0)
    OR (type IN ('OUT', 'SALE') AND quantity < 0)
    OR type = 'ADJUSTMENT'
  ),
  CONSTRAINT stock_movements_unit_cost_non_negative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT stock_movements_product_same_tenant
    FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_sale_same_tenant
    FOREIGN KEY (sale_id, tenant_id) REFERENCES sales (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_user_same_tenant
    FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (user_id)
);

CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_idx ON stock_movements (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_sale_idx ON stock_movements (sale_id);

-- ---------------------------------------------------------------------------
-- PAYMENTS: vinculo com a venda
--
-- Um recebimento pode nascer de uma venda de balcao sem cliente cadastrado.
-- customer_id deixa de ser obrigatorio, MAS o pagamento precisa estar ligado
-- a um cliente OU a uma venda -- nunca solto.
-- ---------------------------------------------------------------------------

ALTER TABLE payments ADD COLUMN IF NOT EXISTS sale_id uuid;
ALTER TABLE payments ALTER COLUMN customer_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_sale_same_tenant') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_sale_same_tenant
      FOREIGN KEY (sale_id, tenant_id) REFERENCES sales (id, tenant_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_customer_or_sale') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_customer_or_sale
      CHECK (customer_id IS NOT NULL OR sale_id IS NOT NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments (sale_id);

-- Correcao de um bug da 0001: `(status = 'PAID') = (paid_at IS NOT NULL)`
-- impedia qualquer ESTORNO (PAID -> REFUNDED mantem a data em que o dinheiro
-- entrou, e a constraint recusava) -- a transicao existia na maquina de
-- estados mas sempre falhava com erro 500. Um estorno so nasce de um
-- pagamento PAGO (PAYMENT_TRANSITIONS), entao exigir paid_at para PAID e
-- REFUNDED e a regra correta. Nenhuma linha existente viola a nova regra.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_paid_has_timestamp;
ALTER TABLE payments ADD CONSTRAINT payments_paid_has_timestamp
  CHECK ((status IN ('PAID', 'REFUNDED')) = (paid_at IS NOT NULL));

-- ---------------------------------------------------------------------------
-- RLS + grants (mesmo padrao da 0002: grant explicito por tabela)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON products TO petflow_app;
GRANT SELECT, INSERT, UPDATE ON sales TO petflow_app;
GRANT SELECT, INSERT ON sale_items TO petflow_app;
-- Historico de estoque e append-only: sem UPDATE, sem DELETE.
GRANT SELECT, INSERT ON stock_movements TO petflow_app;

DO $$
DECLARE
  target text;
  tenant_tables text[] := ARRAY['products', 'sales', 'sale_items', 'stock_movements'];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_tenant_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO petflow_app '
      'USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())',
      target || '_tenant_isolation',
      target
    );
  END LOOP;
END;
$$;
