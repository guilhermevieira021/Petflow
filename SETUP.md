# Instalacao e operacao

## Requisitos

- **Node >= 20.11** (desenvolvido em 24.12)
- **npm >= 10** (o monorepo usa workspaces)
- PostgreSQL >= 15 **apenas em producao** -- em desenvolvimento, PGlite resolve

## Desenvolvimento

```bash
npm install

cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# cole o valor em AUTH_SECRET dentro do .env

npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` sobe tres processos: contracts em watch, API (3333) e web (5173).
Abra http://localhost:5173 e entre com `owner@demo.com` / `petflow123`.

O Vite faz proxy de `/api` para a API, entao o navegador enxerga tudo na mesma
origem e o cookie `SameSite=Lax` funciona sem afrouxamento.

### Fluxo recomendado para testar isolamento

1. Entre com `owner@demo.com` (Pet Shop Amigo Fiel).
2. Anote os numeros do dashboard.
3. Saia e entre com `owner@mundoanimal.com`.
4. Confirme que nada do primeiro pet shop aparece -- inclusive a cor da marca,
   que muda de azul para verde.

## Scripts

| Comando | Efeito |
|---------|--------|
| `npm run dev` | Contracts (watch) + API + Web |
| `npm run dev:api` / `npm run dev:web` | Apenas um dos dois |
| `npm run build` | Build de producao (contracts -> api -> web, nessa ordem) |
| `npm run typecheck` | `tsc` em todos os pacotes |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm test` | Suite da API |
| `npm run db:migrate` | Aplica migrations pendentes |
| `npm run db:seed` | Popula dois tenants ficticios |
| `npm run db:reset` | **DESTRUTIVO.** Apaga o banco de desenvolvimento |

`db:reset` e `db:seed` recusam rodar com `NODE_ENV=production`.

## Variaveis de ambiente

Referencia completa e comentada em [`.env.example`](.env.example).

As que importam:

| Variavel | Padrao | Observacao |
|----------|--------|------------|
| `NODE_ENV` | `development` | Em `production` varias travas entram em vigor |
| `PORT` | `3333` | Porta da API |
| `APP_URL` | `http://localhost:5173` | Origem do frontend. Usada no CORS e no link de recuperacao |
| `DB_DRIVER` | `pglite` | `postgres` **obrigatorio** em producao |
| `DATABASE_URL` | -- | Exigido quando `DB_DRIVER=postgres` |
| `AUTH_SECRET` | -- | Minimo 32 caracteres. O valor de exemplo e recusado em producao |
| `SESSION_TTL_DAYS` | `7` | Expiracao deslizante |
| `MAIL_PROVIDER` | `console` | `console` **nao envia email** |
| `WHATSAPP_PROVIDER` | `link` | `link` **nao envia mensagem**; gera links `wa.me` |

O processo **nao sobe** com configuracao invalida. Falhar alto e cedo no boot e
melhor do que descobrir em producao que `AUTH_SECRET` estava vazio.

## Banco de dados

### Desenvolvimento (padrao)

PGlite grava em `apps/api/.data/pglite`, ignorado pelo git. Para um banco efemero
que some a cada execucao:

```dotenv
PGLITE_DATA_DIR=memory://
```

### PostgreSQL local ou remoto

```dotenv
DB_DRIVER=postgres
DATABASE_URL=postgres://petflow:senha@localhost:5432/petflow
```

```bash
npm run db:migrate
npm run db:seed        # opcional, so fora de producao
```

## Producao

### 1. Banco

Crie um usuario de aplicacao **sem** `SUPERUSER` e **sem** `BYPASSRLS` -- essas
propriedades fazem o Postgres ignorar as policies de RLS, desligando a terceira
camada de isolamento:

```sql
CREATE DATABASE petflow;
CREATE USER petflow_app_user WITH PASSWORD 'senha-forte';
-- roles criadas pela migration 0002
GRANT petflow_app, petflow_bootstrap TO petflow_app_user;
```

Migrations devem rodar com um usuario separado, com privilegio de DDL.

### 2. Build

```bash
npm ci
npm run build
```

Saida: `packages/contracts/dist`, `apps/api/dist`, `apps/web/dist`.

### 3. Migrations

```bash
NODE_ENV=production npm run db:migrate -w @petflow/api
```

Passo **deliberado** do deploy. Em producao o processo da API nao aplica migrations
sozinho: subir o servidor nao pode alterar o schema por conta propria.

### 4. API

```bash
NODE_ENV=production node apps/api/dist/index.js
```

Atras de um proxy reverso com HTTPS. Com `NODE_ENV=production` a API liga
`trustProxy` para obter o IP real -- garanta que o proxy envia `X-Forwarded-For`,
caso contrario o rate limit e a auditoria registram o IP do proxy.

### 5. Frontend

`apps/web/dist` e estatico. Sirva por CDN ou pelo proprio proxy, com duas regras:

- Fallback de SPA: qualquer rota nao encontrada devolve `index.html`.
- `/api/*` encaminhado para a API, **na mesma origem do frontend**. Origens
  diferentes exigiriam `SameSite=None`, o que enfraquece a protecao contra CSRF.

Exemplo (nginx):

```nginx
location /api/ { proxy_pass http://127.0.0.1:3333; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
location /     { try_files $uri $uri/ /index.html; }
```

### 6. Manutencao periodica

Agende uma rotina chamando `purgeStaleSessions()` e `purgeExpiredResetTokens()`
(ambas em `apps/api/src/modules/auth`) para limpar sessoes expiradas e tokens
vencidos.

## Testes

```bash
npm test
```

65 testes em 4 arquivos, contra um PostgreSQL real em memoria com as migrations e
as policies de RLS reais aplicadas. Nao ha mock de banco: um teste de isolamento
contra banco falso nao provaria nada.

| Arquivo | Cobertura |
|---------|-----------|
| `tenant-isolation.test.ts` | Isolamento em HTTP e no banco, integridade entre tenants |
| `auth.test.ts` | Cadastro, login, sessao, CSRF, recuperacao de senha |
| `rbac.test.ts` | Matriz de permissoes, escalonamento de privilegio, validacao |
| `schema-drift.test.ts` | ORM x banco real, RLS habilitado, grants corretos |

## Problemas comuns

**`Configuracao de ambiente invalida`** — falta `.env` ou `AUTH_SECRET` tem menos
de 32 caracteres. A mensagem lista exatamente o que esta errado.

**`ENOENT ... mkdir .data/pglite`** — resolvido automaticamente; se persistir,
verifique permissao de escrita em `apps/api/`.

**`O tenant demo ja existe`** — o seed nao sobrescreve. Rode `npm run db:reset`
antes.

**Erro de tipo `Plugin<any> is not assignable`** — duas copias de `vite` na arvore.
O `overrides` na raiz previne isso; se aparecer, apague `node_modules` e
`package-lock.json` e reinstale.

**Cookie nao persiste no navegador** — acesse pelo Vite (5173) e nao direto pela
API (3333). O proxy e o que mantem tudo na mesma origem.
