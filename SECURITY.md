# Seguranca

## Modelo de ameaca

O risco que define este produto: **um pet shop enxergar os dados de outro.** Nao e
um bug comum -- e o fim da confianca comercial na plataforma. Todo o resto vem
depois disso.

| Ameaca | Defesa |
|--------|--------|
| Tenant A acessa dados do Tenant B | Tres camadas independentes (abaixo) |
| Escalonamento de privilegio | RBAC no backend + travas contra auto-promocao |
| Roubo de sessao via XSS | Token em cookie `httpOnly` |
| CSRF | Double submit + `SameSite=Lax` + CORS de origem unica |
| Forca bruta de senha | Rate limit por rota + scrypt memory-hard |
| Enumeracao de contas | Resposta e tempo identicos para email existente ou nao |
| Vazamento do banco | Senhas em scrypt; tokens guardados hasheados |
| SQL injection | Consultas parametrizadas em 100% dos casos |
| Vazamento por log | `redact` no logger; auditoria sem credenciais |

## Isolamento multi-tenant

### Camada 1 — o tenant vem da sessao

```ts
context: {
  tenantId: resolved.tenantId,   // da sessao, sempre
  userId: resolved.user.id,
}
```

Nenhum endpoint aceita `tenant_id` no corpo, na query ou na URL. Os schemas de
entrada sao `.strict()`: enviar `tenantId` no payload produz **422**, nao e
ignorado em silencio. Ha teste para isso.

Nao existe rota `/tenants/:id` -- apenas `/tenants/current`. Aceitar um id na URL
seria criar superficie de enumeracao de graca.

### Camada 2 — o dominio exige contexto

Todo servico recebe `(tx, context, input)`. Nao ha assinatura que aceite
`tenantId` avulso, e todo repositorio filtra por `tenant_id` mesmo sob RLS --
redundancia deliberada.

### Camada 3 — o banco recusa

```sql
USING (tenant_id = app_current_tenant())
WITH CHECK (tenant_id = app_current_tenant())
```

Esta camada existe para o dia em que as outras duas falharem. Um
`SELECT * FROM customers` sem filtro nenhum, dentro de `withTenant`, devolve apenas
as linhas daquele tenant. Isso e testado.

### Resposta a acesso cruzado

**404, nunca 403.** Um 403 confirmaria a existencia do registro. 403 fica para
falta de permissao dentro do proprio tenant.

## Autenticacao

**Senhas.** scrypt (`node:crypto`), N=2^15, r=8, p=1, salt de 16 bytes aleatorio
por senha. Formato `scrypt$N$r$p$salt$hash` -- os parametros viajam com o hash,
entao migrar para argon2id depois nao invalida as senhas existentes.

**Sessoes.** Token aleatorio de 256 bits, guardado **hasheado** (SHA-256). O valor
em claro existe apenas no cookie do usuario: um dump do banco nao permite sequestrar
sessoes. Expiracao deslizante de 7 dias, com escrita no maximo a cada 5 minutos.

Cookie: `httpOnly`, `SameSite=Lax`, `Secure` em producao, `Path=/`.

**Revogacao imediata.** Derrubam todas as sessoes do usuario: logout, troca de
senha, redefinicao por link, desativacao pelo administrador, exclusao. E o
principal motivo de nao usarmos JWT -- um token assinado continuaria valido ate
expirar.

**Recuperacao de senha.** Token de uso unico, hasheado, com validade de 60
minutos. Pedir um novo invalida os anteriores. A API responde **202 sempre**, com
corpo identico, exista o email ou nao.

> Com `MAIL_PROVIDER=console` (padrao) **nenhum email e enviado**. O link aparece
> no log do servidor. Configurar `MAIL_PROVIDER=smtp` sem a implementacao pronta
> **derruba o boot**, em vez de falhar silenciosamente com um cliente real.

**Anti-enumeracao no login.** Quando o email nao existe, ainda executamos uma
verificacao de senha descartavel (`wasteTimeLikeAVerification`). Sem isso, a
diferenca de latencia entrega quais emails estao cadastrados.

## Autorizacao

Matriz unica em `packages/contracts/src/rbac.ts`, consumida pelos dois lados.

| Permissao | OWNER | ADMIN | STAFF |
|-----------|:-----:|:-----:|:-----:|
| Dashboard | sim | sim | sim |
| Clientes / pets / agenda (ler e escrever) | sim | sim | sim |
| Pagamentos, mensagens | sim | sim | sim |
| Excluir cliente ou pet | sim | sim | **nao** |
| Servicos (escrever) | sim | sim | **nao** |
| Campanhas, relatorios | sim | sim | **nao** |
| Configuracoes (ler) | sim | sim | **nao** |
| **Configuracoes (escrever)** | sim | **nao** | **nao** |
| **Gerenciar usuarios** | sim | **nao** | **nao** |
| **Auditoria** | sim | **nao** | **nao** |

O frontend usa essa matriz apenas para decidir **o que mostrar**. A decisao que
vale e o `preHandler` de cada rota. Esconder um botao e cortesia de interface, nao
autorizacao -- e os testes chamam a API diretamente, como faria alguem com o
DevTools aberto.

**Travas contra escalonamento:**

- Ninguem cria, edita ou remove usuario de papel superior ao seu (`canManageRole`).
- Ninguem altera o proprio papel.
- Ninguem desativa nem exclui o proprio usuario.
- O pet shop nunca fica sem ao menos um OWNER ativo.

## CSRF

Double submit. Junto da sessao emitimos um segundo cookie, legivel por JavaScript,
que o frontend devolve no header `X-CSRF-Token`. O servidor compara com o segredo
guardado na sessao, usando comparacao resistente a timing.

Exigido em `POST`, `PUT`, `PATCH` e `DELETE`. Leituras nao exigem.

Funciona porque um site de terceiros consegue disparar a requisicao, mas nao
consegue ler nosso cookie (origem diferente) nem definir header customizado sem
aprovacao do CORS.

## CORS

```ts
origin: env.APP_URL,   // origem unica e explicita
credentials: true,
```

Nunca refletimos o header `Origin` recebido. Combinado com `credentials: true`,
refletir a origem libera a API para qualquer site da internet.

## Rate limiting

| Escopo | Limite |
|--------|--------|
| Global | 300 req / minuto (configuravel) |
| `/auth/login`, `/register`, `/forgot-password`, `/reset-password` | 10 req / 5 minutos |

Chave: id do usuario quando autenticado, IP quando anonimo -- assim um usuario
legitimo nao e punido por compartilhar IP com um atacante.

Desligado sob `NODE_ENV=test` (a suite dispara centenas de requisicoes em
segundos). O comportamento de producao nao muda.

## Protecao de dados

**SQL injection.** Toda consulta usa parametros, inclusive dentro de templates
`sql` do Drizzle. O unico ponto que concatena SQL e o migrador, que le arquivos do
proprio repositorio -- e ainda assim escapa o nome do arquivo.

`execScript` (protocolo simples, multi-instrucao) existe apenas para migrations e
esta documentado como proibido em codigo de aplicacao.

**XSS.** React escapa por padrao. Nao usamos `dangerouslySetInnerHTML` em lugar
nenhum. Mensagens de erro da API sao texto puro.

**Hash de senha nunca sai.** A projecao publica de usuario (`PUBLIC_COLUMNS`) nao
inclui `password_hash` -- nao ha caminho acidental para ele chegar a uma resposta.
Um teste varre as respostas procurando `passwordHash`, `password_hash` e `scrypt$`.

**Log sem segredo.** O logger declara `redact` para cookie, authorization,
`x-csrf-token`, `set-cookie` e qualquer campo de senha ou token. Mesmo que alguem
logue o objeto inteiro da requisicao por engano, sai `[REDACTED]`.

**Erros nao vazam.** O cliente recebe `{ error: { code, message, requestId } }`.
Stack trace, SQL e nome de constraint ficam no servidor.

## Auditoria

`audit_logs` registra login, falha de login, logout, recuperacao e troca de senha,
criacao de tenant, e todo CRUD de usuarios e configuracoes.

Tres propriedades:

1. **Mesma transacao da operacao auditada.** Se a operacao falha, o log some -- nao
   existe registro de algo que nao aconteceu. Se o log falha, a operacao falha
   junto.
2. **Append-only por privilegio.** A role da aplicacao tem apenas `SELECT, INSERT`.
   Nem a API consegue alterar a trilha.
3. **Sem dado sensivel.** Registramos *quais campos* mudaram, nunca valores de
   credencial.

Visivel apenas para OWNER, em `GET /api/audit-logs`.

## Planos, trial e billing

Ver [BILLING.md](BILLING.md) para o modelo completo. Aqui, so as garantias de
seguranca:

- **O frontend nunca decide o plano.** `session.billing` e `GET /billing/status`
  sao leitura; nenhuma rota aceita o cliente dizendo "meu plano e PRO" ou "meu
  trial nao venceu". Editar `localStorage` ou o estado do React nao muda nada
  no proximo request -- o backend recalcula a partir de `subscriptions` e
  `plans` a cada chamada.
- **Duas barreiras em toda escrita de negocio.** `assertActiveAccess()` (o
  plano permite usar o sistema agora?) e `assertWithinLimit()` (ha cota para
  este recurso?) rodam DENTRO da transacao da escrita, antes do INSERT. Isso
  fecha a corrida entre duas requisicoes simultaneas tentando criar o ultimo
  registro permitido pelo plano -- a segunda enxerga o efeito da primeira.
- **`GET /api/plans` e o unico endpoint publico que expoe dado de negocio**
  (a tabela de precos). Deliberado: uma pagina de precos precisa funcionar sem
  sessao. Nao expoe nada alem do que um site de precos comum ja mostra.
- **Webhook nunca aceita POST sem poder validar a origem.** `POST
  /api/webhooks/cakto` nao tem cookie -- o gateway de pagamento externo nao
  carrega um. Enquanto o mecanismo de autenticacao real da Cakto (assinatura,
  token, ou outro) nao for confirmado, o endpoint responde `503` para
  qualquer requisicao, em vez de aceitar e processar um POST nao verificado.
  Ver [CAKTO.md](CAKTO.md) para o estado atual e o que falta.
- **Checkout nunca finge sucesso.** Sem um `BillingProvider` real configurado,
  `POST /billing/checkout` devolve `checkoutUrl: null` e uma mensagem honesta.
  Nao ha caminho para uma assinatura virar `ACTIVE` sem passar pelo webhook.
- **Idempotencia de webhook por banco, nao por logica de aplicacao.**
  `billing_events` tem uma constraint unica em `(provider, event_id)`; uma
  reentrega do mesmo evento (comportamento normal de qualquer gateway) nunca
  reprocessa nem duplica assinatura -- a segunda tentativa de INSERT falha por
  violacao de unicidade e e descartada silenciosamente (`isUniqueViolation`).

## Secrets

Somente em variaveis de ambiente. `.env` esta no `.gitignore`; `.env.example` nao
contem valor real.

`AUTH_SECRET` exige no minimo 32 caracteres, e em producao o boot recusa o valor de
exemplo. Nenhum segredo chega ao frontend: as chamadas passam pelo proprio backend.

## Checklist de producao

- [ ] `NODE_ENV=production`
- [ ] `AUTH_SECRET` gerado com `randomBytes(48)`
- [ ] `DB_DRIVER=postgres` com `DATABASE_URL` para um usuario **sem** `SUPERUSER` e
      **sem** `BYPASSRLS` (caso contrario o RLS nao se aplica)
- [ ] Migrations executadas por usuario separado, com privilegio de DDL
- [ ] HTTPS obrigatorio (o cookie so viaja com `Secure`)
- [ ] `APP_URL` apontando para a origem real do frontend
- [ ] Proxy reverso configurado (a API usa `trustProxy` em producao para obter o IP
      real no rate limit e na auditoria)
- [ ] `MAIL_PROVIDER` implementado antes de prometer recuperacao de senha por email
- [ ] Rotina periodica chamando `purgeStaleSessions` e `purgeExpiredResetTokens`
- [ ] `CAKTO_WEBHOOK_SECRET` (ou equivalente) configurado e o mapeamento de
      eventos reais da Cakto implementado antes de prometer cobranca aos
      clientes (ver CAKTO.md -- webhook responde 503 ate la, de proposito)

## Limites conhecidos

Declarados abertamente, para nao serem confundidos com pendencias esquecidas:

- **Sem bloqueio de conta por tentativas.** Ha rate limit por IP e por rota, mas
  nao contador de falhas por conta.
- **Sem 2FA.**
- **Sem rotacao de token de sessao apos login** (mitigacao de fixation). O risco e
  baixo porque o token e gerado no servidor a cada login e nao aceitamos token
  vindo do cliente.
- **Upload de logo por URL**, nao por arquivo. Nao ha validacao do conteudo
  remoto -- o campo e apenas uma URL exibida em `<img>`.
- **`withSystem` nao tem imposicao tecnica de uso restrito.** A restricao e por
  documentacao e revisao de codigo.
