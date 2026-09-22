# Banco de dados

PostgreSQL >= 15 (usa `ON DELETE SET NULL (coluna)`). Em desenvolvimento e testes,
PGlite -- o mesmo PostgreSQL 16 compilado para WebAssembly.

## Convencoes

| Assunto | Regra |
|---------|-------|
| Identificadores | `uuid` com `gen_random_uuid()` |
| Dinheiro | `numeric(10,2)`. **Nunca** float |
| Data com fuso | `timestamptz` |
| Data pura | `date` (nascimento) |
| Enums | `text` + `CHECK` (ver ADR-008) |
| Telefones | Somente digitos, normalizados na validacao, com `CHECK (~ '^[0-9]{10,11}$')` |
| Exclusao | `deleted_at` + `active` para dados com historico |
| Isolamento | `tenant_id NOT NULL` em toda tabela de negocio |

## Tabelas

| Tabela | Papel | Exclusao |
|--------|-------|----------|
| `tenants` | O pet shop. Raiz do isolamento | soft |
| `users` | Equipe. Papel OWNER / ADMIN / STAFF | soft |
| `sessions` | Sessoes ativas, token hasheado | hard (purge) |
| `password_reset_tokens` | Recuperacao de senha, uso unico | hard (purge) |
| `customers` | Tutores | soft |
| `pets` | Animais, ligados ao tutor | soft |
| `services` | Catalogo: duracao e preco | soft |
| `appointments` | Agendamentos e atendimentos | sem exclusao (status `CANCELLED`) |
| `payments` | Recebimentos | sem exclusao (status `REFUNDED`/`CANCELLED`) |
| `messages` | Mensagens enviadas ou preparadas | sem exclusao |
| `campaigns` | Campanhas de relacionamento | sem exclusao |
| `reminders` | Fila de lembretes | sem exclusao |
| `audit_logs` | Trilha de auditoria | **append-only** |

`audit_logs` e append-only por privilegio, nao por convencao: a role da aplicacao
recebe apenas `SELECT, INSERT`. Nem a propria API consegue alterar ou apagar um
registro de auditoria.

## Integridade entre tenants

Toda FK entre entidades de negocio e **composta com `tenant_id`**:

```sql
CONSTRAINT pets_customer_same_tenant
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id)
```

Cada tabela tem, para isso, um indice unico auxiliar `(id, tenant_id)`.

O efeito: nao existe combinacao de INSERT ou UPDATE -- pela API, por um script ou
por SQL digitado a mao -- capaz de ligar o pet de um pet shop ao cliente de outro.
O banco recusa. Verificado em `tenant-isolation.test.ts`.

### Politica de ON DELETE

| Relacao | Politica | Motivo |
|---------|----------|--------|
| `tenants` -> tudo | `CASCADE` | Encerrar o contrato remove os dados do cliente |
| `customers` -> `pets` | `RESTRICT` | Nao se apaga um tutor com animais cadastrados |
| `customers`/`pets`/`services` -> `appointments` | `RESTRICT` | Historico operacional nao se reescreve |
| `appointments` -> `payments` | `RESTRICT` | Historico financeiro nao se reescreve |
| `users` -> `appointments.professional_id` | `SET NULL (professional_id)` | O atendimento continua existindo sem o profissional |
| `pets`/`campaigns` -> `messages`/`reminders` | `SET NULL (coluna)` | A mensagem enviada continua no historico |

A sintaxe `SET NULL (coluna)` e necessaria porque anular a FK composta inteira
violaria o `NOT NULL` de `tenant_id`. Exige PostgreSQL >= 15.

## Indices

Todos criados em `0001_initial_schema.sql`.

**Isolamento e busca**

```
customers_tenant_id_idx          (tenant_id)               WHERE deleted_at IS NULL
customers_tenant_name_idx        (tenant_id, lower(name))  WHERE deleted_at IS NULL
customers_tenant_phone_idx       (tenant_id, phone)        WHERE deleted_at IS NULL
customers_tenant_whatsapp_idx    (tenant_id, whatsapp)     WHERE deleted_at IS NULL
pets_customer_id_idx             (customer_id)             WHERE deleted_at IS NULL
pets_tenant_name_idx             (tenant_id, lower(name))  WHERE deleted_at IS NULL
```

**Agenda**

```
appointments_tenant_starts_idx         (tenant_id, starts_at)
appointments_tenant_status_starts_idx  (tenant_id, status, starts_at)
appointments_customer_starts_idx       (customer_id, starts_at DESC)
appointments_pet_starts_idx            (pet_id, starts_at DESC)
appointments_conflict_idx              (tenant_id, professional_id, starts_at, ends_at)
                                       WHERE status IN ('SCHEDULED','CONFIRMED','IN_PROGRESS')
```

O indice de conflito e **parcial de proposito**: agendamentos cancelados e faltas
nao disputam horario, entao nao precisam ocupar o indice. Num pet shop com anos de
historico, isso mantem pequeno justamente o indice consultado a cada novo
agendamento.

**Unicidade**

```
tenants_slug_unique          (slug)                       WHERE deleted_at IS NULL
users_email_unique           (email)                      WHERE deleted_at IS NULL
services_tenant_name_unique  (tenant_id, lower(btrim(name))) WHERE deleted_at IS NULL
customers_tenant_cpf_unique  (tenant_id, cpf)             WHERE cpf IS NOT NULL AND deleted_at IS NULL
sessions_token_hash_unique   (token_hash)
```

Todos parciais em `deleted_at IS NULL`: um registro removido libera o valor para
reuso sem apagar o historico.

## Row Level Security

Definido em `0002_row_level_security.sql`. Duas roles:

```sql
CREATE ROLE petflow_app        NOLOGIN NOINHERIT;  -- toda requisicao autenticada
CREATE ROLE petflow_bootstrap  NOLOGIN NOINHERIT;  -- so o caminho de login
```

Policy padrao das tabelas de negocio:

```sql
CREATE POLICY <tabela>_tenant_isolation ON <tabela>
  FOR ALL TO petflow_app
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
```

`app_current_tenant()` le o GUC `app.tenant_id`. Quando ausente devolve `NULL`, e
`tenant_id = NULL` nao casa com nenhuma linha -- **falha fechado**.

`USING` filtra a leitura; `WITH CHECK` bloqueia a escrita. Por isso um INSERT com
`tenant_id` alheio e recusado com `new row violates row-level security policy`, e
nao apenas ignorado.

Privilegios de `petflow_bootstrap`, deliberadamente minimos:

```sql
GRANT SELECT ON users TO petflow_bootstrap;
GRANT UPDATE (password_hash, last_login_at, updated_at) ON users TO petflow_bootstrap;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, password_reset_tokens TO petflow_bootstrap;
```

Nenhum acesso a `customers`, `pets`, `appointments` ou `payments`. Um teste
automatizado falha se essa lista crescer.

### Producao

As policies nao se aplicam a superusuarios nem ao dono da tabela. Portanto:

```sql
CREATE USER petflow_app_user WITH PASSWORD '...';   -- SEM SUPERUSER, SEM BYPASSRLS
GRANT petflow_app, petflow_bootstrap TO petflow_app_user;
```

`DATABASE_URL` deve apontar para esse usuario. Migrations rodam com um usuario
separado, com privilegio de DDL.

## Migrations

```bash
npm run db:migrate   # aplica as pendentes
npm run db:reset     # DESTRUTIVO -- apaga o banco de desenvolvimento
npm run db:seed      # popula dois tenants ficticios
```

Para criar uma nova: adicione `apps/api/migrations/000N_descricao.sql`. O migrador
aplica em ordem de nome e registra em `_migrations`. Cada arquivo roda dentro de
`BEGIN`/`COMMIT` junto com o proprio registro -- falhou, nada fica pela metade.

**Toda migration que cria tabela precisa, no mesmo arquivo:** habilitar RLS,
declarar a policy de isolamento e conceder os privilegios. Nao usamos
`GRANT ... ON ALL TABLES`, justamente para que uma tabela nova exija uma decisao
consciente. O teste `schema-drift.test.ts` falha se alguem esquecer.

## Seed

Cria **dois** pet shops de proposito. Com um so, e facil escrever codigo que
"funciona" porque nunca existiu um segundo tenant para vazar dados.

| Tenant | Slug | Contas |
|--------|------|--------|
| Pet Shop Amigo Fiel | `petflow-demo` | `owner@demo.com`, `admin@demo.com`, `staff@demo.com` |
| Mundo Animal Centro | `mundo-animal` | `owner@mundoanimal.com`, `admin@…`, `staff@…` |

Senha: `petflow123`. Volume: 6 servicos, 12 e 6 clientes, 30 pets, ~318
agendamentos de -45 a +10 dias, ~200 pagamentos.

Os dados sao inteiramente ficticios -- nomes e telefones foram inventados para o
arquivo de seed. Nenhum dado pessoal real. O gerador usa semente fixa: rodar duas
vezes produz a mesma agenda, o que torna qualquer bug reproduzivel.
