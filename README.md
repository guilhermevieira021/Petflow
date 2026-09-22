# PetFlow

**Ajude seu pet shop a organizar os atendimentos e fazer seus clientes voltarem.**

SaaS B2B multi-tenant de gestao e relacionamento para pet shops. Cada pet shop e um
tenant isolado: agenda, clientes, pets, servicos, historico e recuperacao de
clientes, com dados que nunca cruzam a fronteira entre um cliente e outro.

---

## Estado atual: Fase 2 concluida

| Fase | Escopo | Situacao |
|------|--------|----------|
| 1 | Setup, arquitetura, banco, migrations, autenticacao, multi-tenancy, usuarios, permissoes, seed, layout base, dashboard | **Pronta** |
| **2** | Clientes, pets, servicos, agenda, recuperacao, mensagens, relatorios, landing, onboarding, planos/trial/entitlements, billing, paywall | **Pronta** |
| 3+ | Gateway de pagamento real, campanhas agendadas, WhatsApp Cloud API, E2E de navegador | Pendente |

O produto inteiro -- da landing publica ao paywall -- funciona de ponta a ponta
com dados reais, sem mock. O que foi entregue nesta fase esta detalhado em
[`docs/FASE-2.md`](docs/FASE-2.md); a Fase 1 esta em
[`docs/FASE-1.md`](docs/FASE-1.md).

---

## Stack

| Camada | Escolha | Por que |
|--------|---------|---------|
| Frontend | React 19 + Vite 6 + TypeScript + Tailwind v4 | Exigencia do projeto; Tailwind v4 dispensa arquivo de config e le tokens direto do CSS |
| Estado servidor | TanStack Query | Cache, revalidacao e estados de carregamento sem reinventar |
| Backend | Fastify 5 + TypeScript | Tipagem real, hooks de ciclo de vida, encapsulamento por plugin |
| Banco | PostgreSQL >= 15 | Exigencia do projeto; usamos RLS, FK compostas e `ON DELETE SET NULL (coluna)` |
| ORM | Drizzle | SQL-first, sem binario de codegen, funciona identico com PGlite nos testes |
| Validacao | Zod | Schemas compartilhados entre API e web |
| Testes | Vitest + PGlite | Banco Postgres real em memoria: os testes exercitam as policies de RLS de verdade |

## Estrutura

```
packages/contracts/   Schemas Zod, tipos e matriz RBAC -- fonte unica de verdade
apps/api/             Fastify + Drizzle + PostgreSQL
  migrations/         SQL versionado (schema, indices, RLS, grants, planos)
  src/config/         Validacao do ambiente no boot
  src/core/           Erros, cripto, datas, serializacao, log
  src/db/             Client, contexto transacional, schema, migrador, CLIs
  src/modules/        Regra de negocio por dominio: auth, users, tenants, dashboard,
                       audit, billing, customers, pets, services, appointments,
                       retention, messages, reports
  src/integrations/   Provider abstractions (mail, whatsapp via link, billing)
  src/http/           Servidor, plugins, guardas, rotas
  src/tests/          Isolamento, autenticacao, RBAC, entitlements/trial,
                       CRUD/conflito de agenda, anti-drift de schema (92 testes)
apps/web/             React + Vite
  src/components/     UI reutilizavel, layout e componentes de billing
  src/features/       Telas por dominio (landing, onboarding, clientes, agenda,
                       billing, relatorios, etc.)
  src/lib/            Cliente HTTP, formatacao, utilitarios
  src/styles/         Tokens do design system
```

Regra estrutural: **componente visual nao contem regra de negocio, e rota nao fala
com o banco**. O caminho e sempre `rota -> guarda -> servico -> repositorio -> banco`.

## Comecando

Requisitos: Node >= 20.11. PostgreSQL **nao** e necessario em desenvolvimento.

```bash
npm install

cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# cole o valor gerado em AUTH_SECRET dentro do .env

npm run db:migrate
npm run db:seed
npm run dev
```

- API: http://localhost:3333
- Web: http://localhost:5173

Contas do seed (senha `petflow123`):

| Email | Papel | Plano |
|-------|-------|-------|
| `owner@demo.com` | Proprietario | **PRO ativo** -- sem limites, para explorar o produto inteiro |
| `admin@demo.com` | Administrador | (mesmo tenant) |
| `staff@demo.com` | Atendente | (mesmo tenant) |
| `owner@mundoanimal.com` | Proprietario de um **segundo** pet shop | **TRIAL a 5h do fim** -- da para ver o countdown e o paywall sem esperar 48h |

O segundo tenant existe de proposito: entre com ele e confirme que nenhum dado do
primeiro aparece -- inclusive a cor da marca, que muda de azul para verde.

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Contracts (watch) + API + Web |
| `npm run build` | Build de producao dos tres pacotes |
| `npm run typecheck` | `tsc` em todo o monorepo |
| `npm run lint` | ESLint |
| `npm test` | Suite da API (92 testes) + suite web (23 testes) |
| `npm run db:migrate` | Aplica migrations pendentes |
| `npm run db:seed` | Popula dois tenants ficticios |
| `npm run db:reset` | **Destrutivo.** Apaga o banco de desenvolvimento |

## Banco em desenvolvimento

O padrao e **PGlite**: PostgreSQL de verdade compilado para WebAssembly, rodando
dentro do processo Node. Mesmo dialeto, mesmas constraints, mesmo RLS -- sem
instalar nada. Para apontar para um PostgreSQL real:

```dotenv
DB_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@localhost:5432/petflow
```

Em producao `DB_DRIVER=postgres` e obrigatorio -- o boot recusa qualquer outra
configuracao.

## O que ainda NAO existe

Dito de forma direta, para ninguem vender o que nao foi construido:

- **Envio de WhatsApp.** Nenhuma mensagem sai automaticamente. A interface gera
  links `wa.me` com o texto pronto e quem envia e a pessoa.
- **Envio de email.** `MAIL_PROVIDER=console` escreve o link de recuperacao no log
  do servidor. Nenhum email e entregue.
- **Cobranca de verdade.** A arquitetura de billing (planos, assinaturas,
  entitlements, webhook) esta completa e testada, mas sem um gateway de
  pagamento real conectado -- `POST /billing/checkout` responde honestamente
  que o checkout nao esta configurado. Ver [BILLING.md](BILLING.md).
- **E2E de navegador.** Os fluxos completos foram verificados via chamadas HTTP
  diretas contra a API real; nao ha Playwright/Cypress nesta fase. Ver
  [FRONTEND.md](FRONTEND.md).
- **Pagamentos e campanhas agendadas.** O schema existe (`payments`,
  `campaigns`); os endpoints ainda nao.

## Documentacao

| Arquivo | Conteudo |
|---------|----------|
| [SETUP.md](SETUP.md) | Instalacao, ambiente, deploy |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Camadas, decisoes e ADRs |
| [DATABASE.md](DATABASE.md) | Modelo de dados, indices, migrations |
| [SECURITY.md](SECURITY.md) | Autenticacao, autorizacao, isolamento, ameacas |
| [API.md](API.md) | Endpoints, payloads, codigos de erro |
| [BILLING.md](BILLING.md) | Planos, trial, entitlements, checkout, webhook |
| [PRODUCT.md](PRODUCT.md) | Proposta, funil, ativacao, onboarding |
| [FRONTEND.md](FRONTEND.md) | Rotas, componentes, estado, testes |
| [USER-FLOWS.md](USER-FLOWS.md) | Fluxos de usuario ponta a ponta |
| [docs/FASE-1.md](docs/FASE-1.md) | O que foi entregue na Fase 1 |
| [docs/FASE-2.md](docs/FASE-2.md) | O que foi entregue na Fase 2 |
