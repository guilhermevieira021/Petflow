-- =============================================================================
-- 0002 - Row Level Security (terceira e ultima camada de isolamento)
--
-- Camadas de isolamento multi-tenant, da mais externa para a mais interna:
--   1. HTTP    - tenant_id vem SEMPRE da sessao, nunca do body/query/param.
--   2. Dominio - todo repositorio exige TenantContext e filtra por tenant_id.
--   3. Banco   - estas policies. Se 1 e 2 falharem por bug, o Postgres ainda
--                devolve zero linhas.
--
-- Como funciona: cada request roda dentro de uma transacao que executa
--   SET LOCAL ROLE petflow_app;
--   SET LOCAL app.tenant_id = '<uuid>';
-- Se o GUC nao for definido, app_current_tenant() retorna NULL e a comparacao
-- `tenant_id = NULL` nao casa com nenhuma linha -- ou seja, falha FECHADO.
--
-- Importante: policies NAO se aplicam a superusuarios nem ao dono da tabela
-- (nao usamos FORCE ROW LEVEL SECURITY de proposito). Por isso o unico caminho
-- para obter uma conexao e atraves de withTenant/withBootstrap/withSystem --
-- nao existe handle "cru" exportado pela aplicacao.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Role usada por TODA requisicao autenticada. Enxerga somente o tenant ativo.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'petflow_app') THEN
    CREATE ROLE petflow_app NOLOGIN NOINHERIT;
  END IF;

  -- Role do caminho de autenticacao, que precisa consultar usuario/sessao
  -- ANTES de existir um tenant conhecido. Privilegios deliberadamente minimos.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'petflow_bootstrap') THEN
    CREATE ROLE petflow_bootstrap NOLOGIN NOINHERIT;
  END IF;
END;
$$;

-- Permite que o usuario da aplicacao assuma essas roles via SET ROLE.
DO $$
BEGIN
  EXECUTE format('GRANT petflow_app TO %I', current_user);
  EXECUTE format('GRANT petflow_bootstrap TO %I', current_user);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

GRANT USAGE ON SCHEMA public TO petflow_app, petflow_bootstrap;
GRANT EXECUTE ON FUNCTION app_current_tenant() TO petflow_app, petflow_bootstrap;

-- ---------------------------------------------------------------------------
-- Grants -- explicitos por tabela. Nada de "ALL TABLES": tabelas futuras
-- precisam de uma decisao consciente na sua propria migration.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON tenants TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pets TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO petflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON reminders TO petflow_app;
-- Auditoria e append-only: sem UPDATE, sem DELETE, para ninguem.
GRANT SELECT, INSERT ON audit_logs TO petflow_app;

-- O caminho de autenticacao le o usuario pelo email e gerencia sessoes.
-- Nao pode ler clientes, pets, agenda -- nada de negocio.
GRANT SELECT ON users TO petflow_bootstrap;
GRANT UPDATE (password_hash, last_login_at, updated_at) ON users TO petflow_bootstrap;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO petflow_bootstrap;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO petflow_bootstrap;

-- ---------------------------------------------------------------------------
-- Policies das tabelas de negocio (coluna tenant_id)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
  tenant_tables text[] := ARRAY[
    'users',
    'sessions',
    'password_reset_tokens',
    'customers',
    'pets',
    'services',
    'appointments',
    'payments',
    'campaigns',
    'messages',
    'reminders',
    'audit_logs'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
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

-- ---------------------------------------------------------------------------
-- TENANTS: a chave de isolamento e a propria PK
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON tenants
  FOR ALL TO petflow_app
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- Policies do caminho de autenticacao
--
-- petflow_bootstrap enxerga users e sessions de TODOS os tenants -- e
-- inevitavel, porque o login recebe apenas um email e precisa descobrir a qual
-- tenant ele pertence. Por isso os privilegios sao cirurgicos: SELECT em users,
-- UPDATE apenas em tres colunas, e nenhum acesso a dado de negocio.
-- O uso desta role e restrito ao modulo src/modules/auth.
-- ---------------------------------------------------------------------------

CREATE POLICY users_bootstrap_lookup ON users
  FOR SELECT TO petflow_bootstrap
  USING (true);

CREATE POLICY users_bootstrap_credentials_update ON users
  FOR UPDATE TO petflow_bootstrap
  USING (true)
  WITH CHECK (true);

CREATE POLICY sessions_bootstrap_manage ON sessions
  FOR ALL TO petflow_bootstrap
  USING (true)
  WITH CHECK (true);

CREATE POLICY password_reset_bootstrap_manage ON password_reset_tokens
  FOR ALL TO petflow_bootstrap
  USING (true)
  WITH CHECK (true);
