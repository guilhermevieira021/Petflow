-- =============================================================================
-- 0001 - Schema inicial
--
-- Requer PostgreSQL >= 15 (usa ON DELETE SET NULL com lista de colunas).
--
-- Convencoes:
--   * Toda tabela de negocio carrega tenant_id NOT NULL.
--   * Enums sao TEXT + CHECK (e nao tipos ENUM nativos): evoluir um CHECK e
--     trivial, evoluir um ENUM em producao nao e.
--   * Dinheiro sempre NUMERIC(10,2). Nunca float.
--   * Datas com fuso sempre TIMESTAMPTZ.
--   * ON DELETE RESTRICT para dados que compoem historico operacional;
--     CASCADE apenas onde o filho nao faz sentido sem o pai.
--   * Toda FK entre entidades de negocio e COMPOSTA com tenant_id. Isso torna
--     fisicamente impossivel ligar o pet de um tenant ao cliente de outro,
--     mesmo que a aplicacao tenha um bug.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Funcoes auxiliares
-- ---------------------------------------------------------------------------

-- Tenant da transacao corrente. Retorna NULL quando nao definido, o que faz
-- toda policy de RLS falhar fechado (comparacao com NULL = nenhuma linha).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- TENANTS
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  slug          text        NOT NULL,
  logo_url      text,
  primary_color text        NOT NULL DEFAULT '#2F6BFF',
  phone         text,
  whatsapp      text,
  email         text,
  address       jsonb,
  timezone      text        NOT NULL DEFAULT 'America/Sao_Paulo',
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT tenants_name_not_blank CHECK (length(btrim(name)) >= 2),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT tenants_color_format CHECK (primary_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$')
);

CREATE UNIQUE INDEX tenants_slug_unique ON tenants (slug) WHERE deleted_at IS NULL;

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'STAFF',
  active        boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT users_role_valid CHECK (role IN ('OWNER', 'ADMIN', 'STAFF')),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_email_format CHECK (email LIKE '%_@_%.__%')
);

-- Email globalmente unico: um email pertence a exatamente um tenant no MVP.
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_id_tenant_unique ON users (id, tenant_id);
CREATE INDEX users_tenant_id_idx ON users (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX users_tenant_role_idx ON users (tenant_id, role) WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- SESSIONS
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 do token. O token em claro so existe no cookie do usuario: um
  -- dump do banco nao permite sequestrar sessoes.
  token_hash   text        NOT NULL,
  csrf_secret  text        NOT NULL,
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- PASSWORD RESET
-- ---------------------------------------------------------------------------

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX password_reset_tokens_hash_unique ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  phone      text        NOT NULL,
  whatsapp   text,
  email      text,
  cpf        text,
  birth_date date,
  notes      text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT customers_name_not_blank CHECK (length(btrim(name)) >= 2),
  -- Telefones sao normalizados para somente digitos na camada de validacao.
  CONSTRAINT customers_phone_digits CHECK (phone ~ '^[0-9]{10,11}$'),
  CONSTRAINT customers_whatsapp_digits CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,11}$'),
  CONSTRAINT customers_cpf_digits CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$')
);

CREATE UNIQUE INDEX customers_id_tenant_unique ON customers (id, tenant_id);
CREATE INDEX customers_tenant_id_idx ON customers (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX customers_tenant_name_idx ON customers (tenant_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX customers_tenant_phone_idx ON customers (tenant_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX customers_tenant_whatsapp_idx ON customers (tenant_id, whatsapp) WHERE deleted_at IS NULL;
CREATE INDEX customers_tenant_created_idx ON customers (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
-- CPF, quando informado, e unico dentro do pet shop.
CREATE UNIQUE INDEX customers_tenant_cpf_unique
  ON customers (tenant_id, cpf) WHERE cpf IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- PETS
-- ---------------------------------------------------------------------------

CREATE TABLE pets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL,
  name        text        NOT NULL,
  species     text        NOT NULL,
  sex         text        NOT NULL DEFAULT 'UNKNOWN',
  breed       text,
  birth_date  date,
  weight_kg   numeric(6, 2),
  color       text,
  notes       text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  CONSTRAINT pets_species_valid CHECK (species IN ('DOG', 'CAT', 'BIRD', 'RODENT', 'REPTILE', 'OTHER')),
  CONSTRAINT pets_sex_valid CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN')),
  CONSTRAINT pets_weight_positive CHECK (weight_kg IS NULL OR weight_kg > 0),
  -- O pet SEMPRE pertence ao mesmo tenant do dono.
  CONSTRAINT pets_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX pets_id_tenant_unique ON pets (id, tenant_id);
CREATE INDEX pets_tenant_id_idx ON pets (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX pets_customer_id_idx ON pets (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX pets_tenant_name_idx ON pets (tenant_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TRIGGER pets_set_updated_at
  BEFORE UPDATE ON pets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- SERVICES
-- ---------------------------------------------------------------------------

CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name             text           NOT NULL,
  description      text,
  duration_minutes integer        NOT NULL,
  price            numeric(10, 2) NOT NULL,
  color            text,
  active           boolean        NOT NULL DEFAULT true,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  deleted_at       timestamptz,

  CONSTRAINT services_duration_range CHECK (duration_minutes BETWEEN 5 AND 600),
  CONSTRAINT services_price_non_negative CHECK (price >= 0)
);

CREATE UNIQUE INDEX services_id_tenant_unique ON services (id, tenant_id);
CREATE INDEX services_tenant_id_idx ON services (tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX services_tenant_name_unique
  ON services (tenant_id, lower(btrim(name))) WHERE deleted_at IS NULL;

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- APPOINTMENTS
-- ---------------------------------------------------------------------------

CREATE TABLE appointments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id         uuid           NOT NULL,
  pet_id              uuid           NOT NULL,
  service_id          uuid           NOT NULL,
  professional_id     uuid,
  starts_at           timestamptz    NOT NULL,
  ends_at             timestamptz    NOT NULL,
  status              text           NOT NULL DEFAULT 'SCHEDULED',
  -- Preco congelado no agendamento: alterar a tabela de precos NAO pode
  -- reescrever o historico financeiro.
  price               numeric(10, 2) NOT NULL,
  notes               text,
  cancelled_at        timestamptz,
  cancellation_reason text,
  completed_at        timestamptz,
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT appointments_status_valid CHECK (
    status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
  ),
  CONSTRAINT appointments_interval_valid CHECK (ends_at > starts_at),
  CONSTRAINT appointments_price_non_negative CHECK (price >= 0),
  CONSTRAINT appointments_cancelled_has_timestamp CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT appointments_completed_has_timestamp CHECK (
    status <> 'COMPLETED' OR completed_at IS NOT NULL
  ),
  CONSTRAINT appointments_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_service_same_tenant
    FOREIGN KEY (service_id, tenant_id) REFERENCES services (id, tenant_id) ON DELETE RESTRICT,
  -- O profissional tambem precisa ser do mesmo tenant.
  CONSTRAINT appointments_professional_same_tenant
    FOREIGN KEY (professional_id, tenant_id) REFERENCES users (id, tenant_id)
    ON DELETE SET NULL (professional_id)
);

CREATE UNIQUE INDEX appointments_id_tenant_unique ON appointments (id, tenant_id);
CREATE INDEX appointments_tenant_starts_idx ON appointments (tenant_id, starts_at);
CREATE INDEX appointments_tenant_status_starts_idx ON appointments (tenant_id, status, starts_at);
CREATE INDEX appointments_customer_starts_idx ON appointments (customer_id, starts_at DESC);
CREATE INDEX appointments_pet_starts_idx ON appointments (pet_id, starts_at DESC);
CREATE INDEX appointments_service_idx ON appointments (service_id);
-- Indice dedicado a deteccao de conflito: so os status que ocupam a agenda.
CREATE INDEX appointments_conflict_idx
  ON appointments (tenant_id, professional_id, starts_at, ends_at)
  WHERE status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS');

CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id uuid,
  customer_id    uuid           NOT NULL,
  amount         numeric(10, 2) NOT NULL,
  method         text           NOT NULL,
  status         text           NOT NULL DEFAULT 'PENDING',
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT payments_method_valid CHECK (
    method IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'PIX', 'TRANSFER', 'OTHER')
  ),
  CONSTRAINT payments_status_valid CHECK (status IN ('PENDING', 'PAID', 'REFUNDED', 'CANCELLED')),
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_paid_has_timestamp CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CONSTRAINT payments_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT payments_appointment_same_tenant
    FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX payments_tenant_paid_idx ON payments (tenant_id, paid_at DESC);
CREATE INDEX payments_appointment_idx ON payments (appointment_id);
CREATE INDEX payments_customer_idx ON payments (customer_id);
CREATE INDEX payments_tenant_status_idx ON payments (tenant_id, status);

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- CAMPAIGNS
-- ---------------------------------------------------------------------------

CREATE TABLE campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name             text        NOT NULL,
  type             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'DRAFT',
  message_template text        NOT NULL,
  filters          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_type_valid CHECK (type IN ('WINBACK', 'SEASONAL', 'BIRTHDAY', 'CUSTOM')),
  CONSTRAINT campaigns_status_valid CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'FINISHED'))
);

CREATE UNIQUE INDEX campaigns_id_tenant_unique ON campaigns (id, tenant_id);
CREATE INDEX campaigns_tenant_idx ON campaigns (tenant_id, created_at DESC);

CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- MESSAGES
-- ---------------------------------------------------------------------------

CREATE TABLE messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id         uuid        NOT NULL,
  pet_id              uuid,
  appointment_id      uuid,
  type                text        NOT NULL,
  channel             text        NOT NULL DEFAULT 'WHATSAPP',
  content             text        NOT NULL,
  status              text        NOT NULL DEFAULT 'DRAFT',
  provider_message_id text,
  failure_reason      text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_type_valid CHECK (
    type IN ('APPOINTMENT_REMINDER', 'APPOINTMENT_CONFIRMATION', 'POST_SERVICE_FOLLOWUP',
             'RETURN_INVITE', 'WINBACK', 'MANUAL')
  ),
  CONSTRAINT messages_channel_valid CHECK (channel IN ('WHATSAPP', 'SMS', 'EMAIL')),
  CONSTRAINT messages_status_valid CHECK (
    status IN ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'OPENED_EXTERNALLY')
  ),
  CONSTRAINT messages_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT messages_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE SET NULL (pet_id),
  CONSTRAINT messages_appointment_same_tenant
    FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments (id, tenant_id)
    ON DELETE SET NULL (appointment_id)
);

CREATE INDEX messages_tenant_created_idx ON messages (tenant_id, created_at DESC);
CREATE INDEX messages_customer_idx ON messages (customer_id, created_at DESC);
CREATE INDEX messages_tenant_status_idx ON messages (tenant_id, status);

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- REMINDERS
-- ---------------------------------------------------------------------------

CREATE TABLE reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_id    uuid        NOT NULL,
  pet_id         uuid,
  appointment_id uuid,
  campaign_id    uuid,
  type           text        NOT NULL,
  scheduled_at   timestamptz NOT NULL,
  sent_at        timestamptz,
  status         text        NOT NULL DEFAULT 'PENDING',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reminders_type_valid CHECK (type IN ('APPOINTMENT', 'FOLLOWUP', 'RETURN')),
  CONSTRAINT reminders_status_valid CHECK (status IN ('PENDING', 'SENT', 'CANCELLED', 'FAILED')),
  CONSTRAINT reminders_customer_same_tenant
    FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT reminders_pet_same_tenant
    FOREIGN KEY (pet_id, tenant_id) REFERENCES pets (id, tenant_id) ON DELETE SET NULL (pet_id),
  CONSTRAINT reminders_appointment_same_tenant
    FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT reminders_campaign_same_tenant
    FOREIGN KEY (campaign_id, tenant_id) REFERENCES campaigns (id, tenant_id)
    ON DELETE SET NULL (campaign_id)
);

-- Fila de envio: o worker le por (status, scheduled_at).
CREATE INDEX reminders_pending_idx ON reminders (scheduled_at) WHERE status = 'PENDING';
CREATE INDEX reminders_tenant_idx ON reminders (tenant_id, scheduled_at);
CREATE INDEX reminders_appointment_idx ON reminders (appointment_id);

CREATE TRIGGER reminders_set_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT LOGS  (append-only por contrato: nao ha rota de UPDATE/DELETE)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- NULL quando a acao e anonima (ex.: tentativa de login que falhou).
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action     text        NOT NULL,
  entity     text        NOT NULL,
  entity_id  uuid,
  metadata   jsonb,
  ip_address text,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_created_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (tenant_id, user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (tenant_id, action, created_at DESC);
