# Arquitetura

## Principio organizador

Uma unica regra explica quase todas as decisoes deste repositorio:

> **O tenant vem da sessao. Nunca do payload.**

Nao existe endpoint que aceite `tenant_id` no corpo, na query ou na URL. Nao existe
funcao de servico que receba `tenantId: string` solto. O que circula e um
`TenantContext`, e esse objeto so pode ser construido pelo plugin de autenticacao,
a partir de um cookie de sessao valido.

## Camadas

```
  Navegador
     |  cookie httpOnly + header X-CSRF-Token
     v
  Rota (Fastify)          valida o payload com Zod; nao conhece o banco
     |
  Guarda                  requireAuth / requirePermission; monta o TenantContext
     |
  withTenant(...)         abre transacao, assume a role petflow_app,
     |                    define app.tenant_id
  Servico                 regra de negocio; recebe (tx, context, input)
     |
  Drizzle                 consultas tipadas, sempre filtradas por tenant_id
     |
  PostgreSQL + RLS        ultima barreira: policies por linha
```

Duas proibicoes que sustentam o desenho:

1. **Rota nao acessa banco.** Se um handler importa uma tabela do Drizzle, a
   regra vazou para a camada errada.
2. **Componente React nao contem regra de negocio.** A interface exibe o que a
   API decidiu. `hasPermission` no frontend decide o que **mostrar**; quem decide o
   que **pode** e o backend.

## Isolamento multi-tenant: tres camadas

| Camada | Onde | O que impede |
|--------|------|--------------|
| 1. HTTP | `src/http/plugins/auth.ts` | Um cliente escolher qual tenant quer acessar |
| 2. Dominio | `withTenant` + `WHERE tenant_id` nos repositorios | Uma consulta mal escrita cruzar a fronteira |
| 3. Banco | Policies de RLS (`0002_row_level_security.sql`) | Um bug nas camadas 1 e 2 vazar dados |

A terceira camada e a que importa quando as outras falham. Um `SELECT * FROM
customers` **sem nenhum filtro**, executado dentro de `withTenant`, devolve apenas
as linhas daquele tenant -- isso e verificado por teste automatizado em
`src/tests/tenant-isolation.test.ts`.

O mecanismo:

```sql
SET LOCAL ROLE petflow_app;
SELECT set_config('app.tenant_id', $1, true);
-- policy: USING (tenant_id = app_current_tenant())
```

Se o GUC nao for definido, `app_current_tenant()` devolve `NULL`, a comparacao
`tenant_id = NULL` nao casa com nada e a consulta retorna zero linhas. **Falha
fechado, nunca aberto.**

### As tres portas de acesso ao banco

Nao existe handle de banco exportado. Todo acesso passa por uma destas funcoes
(`src/db/context.ts`):

| Funcao | Role | Enxerga | Uso permitido |
|--------|------|---------|---------------|
| `withTenant(id, fn)` | `petflow_app` | So o tenant informado | Todo o resto do sistema |
| `withBootstrap(fn)` | `petflow_bootstrap` | `users`, `sessions`, `password_reset_tokens` de todos os tenants -- **nenhum dado de negocio** | Somente `src/modules/auth` |
| `withSystem(fn)` | conexao crua, sem RLS | Tudo | Cadastro publico, migrations, seed, webhook de billing (Cakto), catalogo publico de planos |

`withBootstrap` existe porque o login recebe apenas um email e precisa descobrir a
qual tenant ele pertence -- um problema de ovo e galinha real. A resposta nao foi
abrir o banco, e sim criar uma role com privilegios cirurgicos: `SELECT` em
`users`, `UPDATE` em exatamente tres colunas, e zero acesso a clientes, pets ou
agenda. Isso e verificado por teste (`schema-drift.test.ts`).

`withSystem` tem cinco usos legitimos e documentados no proprio codigo (ver o
comentario da funcao em `context.ts`). Qualquer sexto uso e bug de arquitetura.

## Decisoes (ADRs)

### ADR-001 — API separada do frontend, e nao fullstack

**Contexto.** React + Vite + Tailwind eram requisitos. Restava decidir entre um
framework fullstack (Next.js) e uma API dedicada.

**Decisao.** API Fastify independente, consumida por um SPA Vite.

**Por que.** O briefing exige que regra de negocio, validacao, autorizacao e acesso
a dados fiquem separados da interface. Num framework fullstack a fronteira entre
"server component" e "regra de negocio" e convidativa demais para ser furada. Uma
API separada torna a fronteira fisica: o frontend so alcanca o dominio por HTTP.
Como efeito colateral util, o mesmo backend atende um app nativo futuro.

**Custo aceito.** Dois processos em desenvolvimento e um proxy no Vite. Em troca,
o cookie de sessao funciona em mesma origem sem afrouxar `SameSite`.

### ADR-002 — Fastify em vez de Express

**Decisao.** Fastify 5.

**Por que.** Tipagem de verdade (Express exige `@types` e ainda assim `req.body` e
`any`), hooks de ciclo de vida que permitem montar autenticacao e CSRF como
plugins, e encapsulamento por escopo. Express nao oferece nada disso sem
bibliotecas extras.

### ADR-003 — Migrations em SQL escrito a mao, com migrador proprio

**Contexto.** O caminho padrao seria `drizzle-kit generate`.

**Decisao.** Arquivos `.sql` versionados em `apps/api/migrations/`, aplicados por
um migrador de ~60 linhas (`src/db/migrator.ts`) que registra o que ja rodou numa
tabela `_migrations`.

**Por que.** O schema de seguranca -- `CREATE ROLE`, `ENABLE ROW LEVEL SECURITY`,
policies, `GRANT UPDATE (coluna)`, FKs compostas `(id, tenant_id)`, indices
parciais -- nao e representavel no schema do ORM. Um gerador nao enxerga esses
objetos e, na geracao seguinte, os apaga em silencio. Perder uma policy de RLS sem
perceber e exatamente o tipo de falha que nao podemos correr.

**Custo aceito.** O SQL e o schema do Drizzle podem divergir. Esse custo e cobrado
automaticamente: `src/tests/schema-drift.test.ts` compara cada tabela e coluna
declarada no ORM com o `information_schema` do banco real, incluindo nulidade, e
ainda verifica que toda tabela tem RLS ligado e policy associada.

Aplicar a migration e registra-la acontecem na **mesma transacao**: em caso de
falha o Postgres converte o `COMMIT` em `ROLLBACK` e nada fica pela metade.

### ADR-004 — PGlite em desenvolvimento e testes

**Contexto.** A maquina alvo nao tem Docker nem PostgreSQL instalado.

**Decisao.** `DB_DRIVER=pglite` por padrao; `postgres` obrigatorio em producao
(o boot recusa qualquer outra coisa quando `NODE_ENV=production`).

**Por que.** PGlite e o PostgreSQL 16 compilado para WebAssembly -- nao e um
emulador nem um SQLite disfarcado. Roda as mesmas migrations, as mesmas
constraints e as **mesmas policies de RLS**. Um teste de isolamento contra um banco
falso nao provaria nada; contra PGlite, prova.

**Limite conhecido.** Extensoes nativas nao disponiveis no PGlite estao fora do
nosso alcance -- por isso a deteccao de conflito de horario usa
`pg_advisory_xact_lock` (portavel) e nao uma exclusion constraint com `btree_gist`.

### ADR-005 — Sessao opaca em cookie httpOnly, e nao JWT

**Decisao.** Token aleatorio de 256 bits, guardado **hasheado** (SHA-256) na tabela
`sessions`, entregue em cookie `httpOnly; SameSite=Lax; Secure` (em producao).

**Por que.**
- **Revogavel de imediato.** Desativar um usuario, trocar a senha ou fazer logout
  derruba o acesso no mesmo instante. Um JWT continua valido ate expirar.
- **Imune a exfiltracao por XSS.** `httpOnly` coloca o token fora do alcance do
  JavaScript da pagina, ao contrario de um JWT no `localStorage`.
- **Um vazamento do banco nao concede sessoes**, porque so o hash e persistido.

**Custo aceito.** Uma consulta por requisicao para resolver a sessao. E uma busca
por indice unico; em troca ganhamos revogacao real.

CSRF e tratado por **double submit**: junto da sessao emitimos um segundo cookie,
esse legivel por JavaScript, cujo valor o frontend devolve no header
`X-CSRF-Token`. Um site de terceiros consegue disparar um POST, mas nao consegue
ler nosso cookie nem definir header customizado sem passar pelo CORS.

### ADR-006 — scrypt do `node:crypto` para derivar senhas

**Decisao.** `scrypt` da biblioteca padrao, com os parametros embutidos no proprio
hash (`scrypt$N$r$p$salt$hash`).

**Por que.** argon2 e bcrypt exigem compilacao nativa, que falha em Windows sem
build tools -- e "nao consigo instalar" e uma pressao real para alguem trocar por
algo pior. scrypt e memory-hard, faz parte da stdlib e nao adiciona dependencia. O
formato carrega os parametros, entao introduzir argon2id depois e adicionar um novo
prefixo: os hashes antigos continuam verificaveis.

### ADR-007 — Email unico globalmente (um email = um usuario = um tenant)

**Decisao.** Indice unico em `users(email)` para todo o banco.

**Por que.** Permite login direto por email, sem a tela "selecione a empresa", e
mantem a sessao inequivocamente ligada a um tenant.

**Quando isso mudar.** Uma tabela `memberships (user_id, tenant_id, role)` e a
sessao passando a carregar o tenant ativo. O restante da arquitetura nao muda,
porque tudo ja resolve o tenant a partir da sessao.

### ADR-008 — Enums como TEXT + CHECK, nao tipos ENUM nativos

**Decisao.** `status text NOT NULL CHECK (status IN (...))`, com a tipagem forte no
TypeScript via `$type<AppointmentStatus>()`.

**Por que.** `ALTER TYPE ... ADD VALUE` nao roda dentro de transacao em versoes do
Postgres ainda em uso, o que trava migrations em producao. Alterar um CHECK e uma
operacao comum. A seguranca de tipos que importa no dia a dia -- autocompletar,
switch exaustivo -- vem do TypeScript de qualquer forma.

### ADR-009 — Chaves estrangeiras compostas com `tenant_id`

**Decisao.** Toda FK entre entidades de negocio inclui `tenant_id`:

```sql
FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id)
```

**Por que.** Torna **fisicamente impossivel** ligar o pet de um tenant ao cliente de
outro, ou marcar um agendamento com servico alheio -- mesmo que a aplicacao tenha
um bug, mesmo que alguem escreva SQL a mao no console de producao. E a diferenca
entre "confiamos que o codigo valida" e "o banco nao aceita".

Requer PostgreSQL >= 15, por conta do `ON DELETE SET NULL (coluna)` usado onde
anular a FK inteira violaria o `NOT NULL` de `tenant_id`.

### ADR-010 — Paleta de graficos independente da cor da marca

**Decisao.** As series dos graficos usam `--color-chart-1` / `--color-chart-2`,
fixos. Apenas `--color-brand` e substituido pelo tenant.

**Por que.** Se as series herdassem a cor do pet shop, um tenant com marca
amarelo-claro teria um grafico ilegivel e toda a verificacao de contraste e de
daltonismo iria por agua abaixo. O par atual foi validado: separacao OKLab de 27,7
sob protanopia (minimo aceitavel: 8), 31,5 em visao normal (minimo: 15) e contraste
>= 3:1 sobre a superficie.

### ADR-011 — `plans` como catalogo global, sem `tenant_id`

**Contexto.** Toda outra tabela de negocio deste sistema carrega `tenant_id`.
Precisavamos decidir se `plans` seguiria o mesmo padrao ou seria uma excecao.

**Decisao.** `plans` NAO tem `tenant_id` e NAO tem RLS. E uma tabela global,
como a lista de precos de qualquer SaaS -- igual para todos os pet shops.
`subscriptions`, essa sim, e por tenant e segue a mesma politica de RLS das
demais.

**Por que.** Aplicar RLS a uma tabela sem chave de isolamento nao faz sentido
(nao ha o que isolar), e forcar um `tenant_id` falso so para manter o padrao
adicionaria uma coluna sem significado. `schema-drift.test.ts` trata `plans`
como excecao explicita (`GLOBAL_CATALOG_TABLES`), documentada no proprio teste
-- assim, se uma tabela futura tambem for global, a decisao de exclui-la do
RLS e deliberada e visivel, nao um vazamento silencioso.

### ADR-012 — Entitlements calculados sob demanda, sem job agendado

**Contexto.** Quando o trial de 48h vence, ou quando uma assinatura cancelada
chega ao fim do periodo pago, algo precisa "perceber" isso e bloquear o acesso.
A abordagem obvia seria um job agendado que varre `subscriptions` e atualiza o
`status` periodicamente.

**Decisao.** Nao ha job nenhum. `computeAccess()` (em `billing.service.ts`)
compara `trialEndsAt`/`currentPeriodEnd` com `now()` **a cada chamada** de
`getBillingStatus()` ou `assertActiveAccess()`. O `status` no banco
(`TRIALING`, `CANCELLED`) so muda por acao explicita: registro no cadastro,
webhook do gateway, ou cancelamento.

**Por que.** Um job agendado e mais infraestrutura (scheduler, retry, alerta se
falhar) para resolver um calculo que e trivial de fazer na hora. O trial vence
exatamente no segundo certo para qualquer requisicao que chegar depois --
nao ha janela de ate um ciclo de job em que o acesso deveria estar bloqueado
mas ainda nao foi. Ver BILLING.md para a tabela de status x bloqueio completa.

**Custo aceito.** Uma consulta um pouco mais cara a cada chamada de billing
(compara datas em vez de ler um enum). Irrelevante na escala de um pet shop.

### ADR-013 — Checkout Cakto com webhook reservado ate a conta fornecer os dados

**Contexto.** O briefing pede a arquitetura de cobranca completa, e depois pede
a integracao com a Cakto usando um link de checkout real -- mas e explicito:
nao inventar credenciais, IDs, endpoints, eventos ou configuracoes da Cakto.

**Decisao.** `BillingProvider` (`integrations/billing/billing.provider.ts`)
tem duas implementacoes: `NullBillingProvider` (`configured = false`, sem
checkout) e `CaktoProvider` (`configured = true` quando
`CAKTO_PRO_CHECKOUT_URL` esta definida, devolvendo esse link estatico -- a
Cakto nao expoe uma API para gerar sessoes dinamicas). O webhook
(`POST /api/webhooks/cakto`) autentica de verdade (`secret` no corpo,
confirmado com a conta Cakto -- `403` se nao bater, `503` sem
`CAKTO_WEBHOOK_SECRET` configurada) e registra qualquer evento autentico de
forma idempotente em `billing_events` -- mas ainda NAO chama
`applyBillingWebhookEvent` para nenhum evento, porque faltam: os nomes/formato
reais dos eventos alem de `purchase_approved`, e uma forma de correlacionar o
evento ao tenant comprador (ver [CAKTO.md](CAKTO.md)).

**Por que.** A alternativa -- adivinhar nomes de evento nao confirmados ou
assumir uma forma de identificar o tenant -- arriscaria aplicar uma mudanca de
assinatura ao tenant errado, ou nunca reconhecer um cancelamento/reembolso
real. Autenticar de verdade (em vez de aceitar qualquer POST) ja foi possivel
porque a conta Cakto confirmou o mecanismo; gravar o evento tambem, porque
idempotencia nao depende de conhecer o significado do evento. Aplicar a uma
assinatura, porem, continua bloqueado ate os dois itens que faltam: isso e uma
resposta honesta -- o sistema sabe o que ainda nao pode fazer com seguranca, e
nao finge.

## Tratamento de erros

`AppError` (`src/core/errors.ts`) e a unica forma de erro previsto. Cada subclasse
carrega o codigo estavel, o status HTTP e a mensagem **ja escrita para o usuario
final** em portugues. O handler global traduz para o envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": [...], "requestId": "..." } }
```

Stack trace, SQL e nome de constraint ficam no log do servidor. O `requestId`
correlaciona o que o usuario viu com o que foi registrado.

**404 para recurso de outro tenant, nunca 403.** Um 403 confirmaria que o registro
existe e permitiria enumeracao entre tenants. 403 fica reservado para falta de
permissao **dentro** do proprio tenant.

## Integracoes externas

Cada integracao entra como interface com implementacao explicita sobre o que faz e
o que nao faz:

- `MailProvider` — `ConsoleMailProvider` (padrao) escreve no log e **nao envia
  email**. `smtp` ainda nao existe e o processo **falha no boot** se configurado,
  em vez de falhar na primeira recuperacao de senha de um cliente real.
- `WhatsAppProvider` — fase 4. O comportamento atual e gerar links `wa.me` com a
  mensagem pronta; quem envia e a pessoa. Nao existe integracao simulada.

## Performance

- Paginacao obrigatoria em toda listagem (`page`, `pageSize`, teto de 100).
- Joins no lugar de consultas em laco: o dashboard resolve proximos atendimentos
  com cliente, pet e servico num unico `SELECT`.
- Janelas de tempo lidas de uma vez e agregadas em memoria quando o volume e
  limitado e conhecido (14 dias, com `LIMIT` de seguranca), em vez de varias
  varreduras do mesmo indice.
- Indices desenhados para os acessos reais: `(tenant_id, starts_at)`,
  `(tenant_id, status, starts_at)`, e um indice parcial de conflito que cobre
  apenas os status que ocupam a agenda.
