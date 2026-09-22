# API

Base: `/api`. Requisicoes e respostas em JSON. Autenticacao por cookie de sessao.

## Contrato comum

**Toda rota protegida valida, nesta ordem:** sessao valida -> CSRF (se for
mutacao) -> permissao -> payload -> existencia e propriedade das entidades
relacionadas.

**Erros** sempre no mesmo envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Alguns campos precisam ser corrigidos.",
    "fields": [{ "field": "email", "message": "Informe um email valido." }],
    "requestId": "9f2c..."
  }
}
```

O cliente deve programar contra `code` (estavel), nunca contra `message` (pode ser
reescrita). `message` ja vem em portugues, pronta para exibicao.

| Status | Quando |
|--------|--------|
| 400 | Requisicao malformada |
| 401 | Sem sessao, sessao expirada, credencial invalida |
| 403 | Sem permissao, conta desativada, CSRF invalido |
| 404 | Nao existe **ou pertence a outro tenant** |
| 409 | Conflito: email em uso, horario ocupado, ultimo proprietario |
| 422 | Falha de validacao ou de regra de negocio |
| 429 | Rate limit |
| 500 | Erro interno (detalhes so no log) |

Codigos: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`,
`INSUFFICIENT_PERMISSION`, `INVALID_CSRF_TOKEN`, `SUBSCRIPTION_REQUIRED`,
`NOT_FOUND`, `EMAIL_ALREADY_USED`, `TIME_SLOT_TAKEN`, `INVALID_STATUS_TRANSITION`,
`LIMIT_REACHED`, `VALIDATION_ERROR`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMITED`,
`INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`.

`SUBSCRIPTION_REQUIRED` (403) e `LIMIT_REACHED` (409) sao os dois codigos do
sistema de planos -- ver [BILLING.md](BILLING.md). O primeiro significa "o plano
nao permite usar o sistema agora" (trial vencido, assinatura cancelada); o
segundo, "voce atingiu a cota deste recurso no seu plano atual". Ambos vem com
`message` pronta para exibir ao usuario.

**CSRF.** Em `POST`/`PUT`/`PATCH`/`DELETE`, envie o header `X-CSRF-Token` com o
valor do cookie `petflow_csrf`.

**Paginacao.** `?page=1&pageSize=20` (maximo 100):

```json
{
  "data": [...],
  "pagination": { "page": 1, "pageSize": 20, "total": 37, "totalPages": 2,
                  "hasNext": true, "hasPrevious": false }
}
```

---

## Autenticacao — `/api/auth`

Rotas com limite de **10 requisicoes / 5 minutos**.

### `POST /register` — 201

Cria o pet shop e o seu primeiro OWNER numa unica transacao. Emite a sessao.

```json
{ "tenantName": "Pet Shop Amigo Fiel", "userName": "Marcos Lima",
  "email": "marcos@amigofiel.com.br", "password": "minhaSenha1" }
```

`slug` e opcional -- derivado do nome e desambiguado automaticamente.
Erros: `409 EMAIL_ALREADY_USED`, `422 VALIDATION_ERROR`.

### `POST /login` — 200

```json
{ "email": "owner@demo.com", "password": "petflow123" }
```

Define `petflow_session` (httpOnly) e `petflow_csrf` (legivel).
Erros: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_INACTIVE`.

### `POST /logout` — 204
Revoga a sessao e limpa os cookies. Requer autenticacao.

### `GET /me` — 200

Payload unico de inicializacao do app: uma chamada, nenhum waterfall.

```json
{
  "user": { "id": "...", "tenantId": "...", "name": "Marcos Proprietario",
            "email": "owner@demo.com", "role": "OWNER", "active": true },
  "tenant": { "id": "...", "name": "Pet Shop Amigo Fiel", "slug": "petflow-demo",
              "logoUrl": null, "primaryColor": "#2F6BFF",
              "timezone": "America/Sao_Paulo" },
  "permissions": ["dashboard:read", "customers:read", "..."],
  "onboarding": { "completed": false,
                  "steps": [{ "key": "services", "label": "Cadastre seus servicos",
                              "done": true }] },
  "billing": { "plan": { "code": "TRIAL", "limits": { "customers": 10, "...": null } },
               "subscription": { "status": "TRIALING", "trialEndsAt": "..." },
               "usage": { "customers": { "used": 3, "limit": 10 }, "...": {} },
               "trial": { "active": true, "hoursRemaining": 41, "endsAt": "..." },
               "access": { "blocked": false, "reason": null } }
}
```

`billing` e o mesmo objeto devolvido por `GET /api/billing/status` -- ver secao
Billing abaixo. Esta copia existe para o app pintar o aviso de trial e decidir o
redirecionamento inicial sem uma segunda chamada; telas que precisam de numeros
atualizados (apos criar um cliente, por exemplo) consultam o endpoint dedicado.

### `POST /forgot-password` — **202 sempre**

```json
{ "email": "owner@demo.com" }
```

Resposta identica exista o email ou nao. Com `MAIL_PROVIDER=console` o link so
aparece no log do servidor.

### `POST /reset-password` — 200
`{ "token": "...", "password": "...", "passwordConfirmation": "..." }`
Token de uso unico. Revoga todas as sessoes do usuario. `401` se invalido ou
expirado.

### `POST /change-password` — 200
`{ "currentPassword": "...", "password": "...", "passwordConfirmation": "..." }`
Requer autenticacao. `401` se a senha atual estiver errada.

---

## Pet shop — `/api/tenants`

Nao existe `/tenants/:id` nem listagem. Apenas o tenant da sessao.

| Rota | Permissao |
|------|-----------|
| `GET /current` | `settings:read` |
| `PATCH /current` | `settings:write` |
| `GET /current/onboarding` | `dashboard:read` |

`PATCH /current` aceita, todos opcionais: `name`, `logoUrl`, `primaryColor`,
`phone`, `whatsapp`, `email`, `address`, `timezone`, `settings`.

```json
{ "primaryColor": "#0F766E",
  "settings": { "inactiveCustomerDays": 60, "automationEnabled": false } }
```

`settings.automationEnabled` e **false por padrao**: nenhuma mensagem sai
automaticamente sem autorizacao explicita do tenant.

---

## Usuarios — `/api/users`

| Rota | Permissao |
|------|-----------|
| `GET /` | `users:read` (OWNER) |
| `GET /:id` | `users:read` |
| `POST /` | `users:write` (OWNER) |
| `PATCH /:id` | `users:write` |
| `DELETE /:id` | `users:write` |

`GET /` aceita `search`, `role`, `active`, alem da paginacao.

`POST /` — `{ "name", "email", "password", "role": "STAFF" }`

`PATCH /:id` — `{ "name"?, "role"?, "active"?, "password"? }`.
Desativar ou trocar a senha revoga as sessoes abertas do alvo.

`DELETE /:id` — exclusao **logica**: `active = false`, `deleted_at` preenchido,
email liberado para reuso. O historico de atendimentos permanece.

Regras aplicadas no backend (todas com teste):

- 403 ao gerenciar papel superior ao seu
- 403 ao alterar o proprio papel, desativar-se ou excluir-se
- 409 se a acao deixasse o pet shop sem OWNER ativo
- **404** para usuario de outro tenant
- 422 se o payload trouxer campo desconhecido (schemas `.strict()`)

---

## Dashboard — `/api/dashboard`

### `GET /overview` — permissao `dashboard:read`

Query opcional: `date=YYYY-MM-DD` (padrao: hoje no fuso do tenant).

```json
{
  "referenceDate": "2026-09-22",
  "timezone": "America/Sao_Paulo",
  "today": { "total": 5, "scheduled": 2, "confirmed": 1, "inProgress": 1,
             "completed": 1, "cancelled": 0, "noShow": 0,
             "expectedRevenue": 360, "receivedRevenue": 70 },
  "customers": { "total": 12, "newThisMonth": 12, "inactive": 0,
                 "inactiveThresholdDays": 45 },
  "pendingReturns": 1,
  "upcoming": [{ "id": "...", "startsAt": "2026-09-22T17:00:00.000Z",
                 "status": "CONFIRMED", "customerName": "Joao Batista Silva",
                 "customerWhatsapp": "11985550101", "petName": "Thor",
                 "serviceName": "Banho e Tosa", "price": 95 }],
  "revenueSeries": [{ "date": "2026-09-09", "expected": 420, "received": 350 }]
}
```

- `expectedRevenue` ignora cancelados e faltas.
- `inactive` = ja foi atendido, nao tem agendamento futuro e o ultimo atendimento
  passou do limite configurado em `settings.inactiveCustomerDays`.
- `pendingReturns` = ja atendido, sem proximo agendamento.
- `revenueSeries` cobre 14 dias, **com os dias sem movimento preenchidos com
  zero** -- um grafico com buracos mente sobre a tendencia.

---

## Auditoria — `/api/audit-logs`

`GET /` — permissao `audit:read` (OWNER). Filtros: `action`, `entity`, `entityId`,
`userId`, `from`, `to`, alem da paginacao. Retorno paginado de `AuditLogDto`.

---

## Planos — `/api/plans`

### `GET /` — **publico, sem autenticacao**

Catalogo dos planos ativos, para a pagina de precos funcionar para visitante sem
sessao. `{ "data": [PlanDto, ...] }`, ordenado por preco.

---

## Billing — `/api/billing`

Ver [BILLING.md](BILLING.md) para o modelo completo (ciclo de vida da
assinatura, entitlements, webhook).

| Rota | Permissao |
|------|-----------|
| `GET /status` | `billing:read` (OWNER) |
| `POST /checkout` | `billing:write` (OWNER) |

| Rota (fora de `/api/billing`) | Permissao |
|---|---|
| `POST /api/webhooks/cakto` | nenhuma -- autenticacao pendente, ver abaixo |

`GET /status` devolve o mesmo `BillingStatusDto` do campo `billing` de `/me`
(plano, assinatura, uso por recurso, trial, bloqueio de acesso).

`POST /checkout` — `{ "planCode": "PRO" }` → `200`:
```json
{ "checkoutUrl": null, "message": "O checkout de pagamento ainda nao foi configurado..." }
```
Com o `CaktoProvider` configurado, devolve
`{ "checkoutUrl": "https://pay.cakto.com.br/...", "message": "..." }` -- o
mesmo link para qualquer tenant (ver [CAKTO.md](CAKTO.md)).

`POST /api/webhooks/cakto` — responde `503` para qualquer requisicao ate a
conta Cakto fornecer o mecanismo real de autenticacao do webhook (assinatura,
token, ou outro). Ver [CAKTO.md](CAKTO.md) para o estado exato e o que falta.

---

## Clientes — `/api/customers`

| Rota | Permissao |
|------|-----------|
| `GET /` | `customers:read` |
| `GET /:id` | `customers:read` |
| `POST /` | `customers:write` |
| `PATCH /:id` | `customers:write` (`active: false` exige `customers:delete`) |

`GET /` aceita `search` (nome/telefone/whatsapp/email), `active`, `sort`
(`name`/`createdAt`/`lastVisitAt`), `order`, alem da paginacao. Cada item vem
com `petsCount`, `lastVisitAt`, `nextAppointmentAt`, `appointmentsCount`,
`totalSpent` -- calculados no banco, sem N+1.

`POST /` valida limite do plano (`LIMIT_REACHED`, 409) e acesso ativo
(`SUBSCRIPTION_REQUIRED`, 403) antes de criar. CPF, quando informado, e unico
por tenant.

Nao ha `DELETE`: desativacao e sempre `PATCH { "active": false }` --
soft delete, preserva o historico de agendamentos.

---

## Pets — `/api/pets`

| Rota | Permissao |
|------|-----------|
| `GET /` | `pets:read` |
| `GET /:id` | `pets:read` |
| `POST /` | `pets:write` |
| `PATCH /:id` | `pets:write` (`active: false` exige `pets:delete`) |

`POST /` exige `customerId` de um cliente do mesmo tenant -- `404` (nunca
`403`) se o cliente pertencer a outro tenant, para nao confirmar a existencia
de um registro alheio. `GET /` filtra por `customerId`, `species`, `search`
(nome do pet ou do tutor).

---

## Servicos — `/api/services`

| Rota | Permissao |
|------|-----------|
| `GET /` | `services:read` |
| `GET /:id` | `services:read` |
| `POST /` | `services:write` |
| `PATCH /:id` | `services:write` |

Nome unico por tenant (case-insensitive). Alterar o preco de um servico NAO
reescreve o preco dos agendamentos ja criados -- eles congelam o preco no
momento em que foram marcados.

---

## Agenda — `/api/appointments`

| Rota | Permissao |
|------|-----------|
| `GET /` | `appointments:read` |
| `GET /:id` | `appointments:read` |
| `POST /` | `appointments:write` |
| `PATCH /:id` | `appointments:write` (so em SCHEDULED/CONFIRMED/IN_PROGRESS) |
| `PATCH /:id/status` | `appointments:write`; cancelar exige tambem `appointments:cancel` |

`GET /` filtra por `from`, `to`, `status` (um ou varios), `customerId`, `petId`,
`serviceId`, `professionalId`, `search` (nome de cliente/pet/servico). Cada item
e um `AppointmentDetailDto` com nomes ja resolvidos.

`POST /` valida, nesta ordem: acesso ativo do plano, limite de agendamentos,
cliente existe, pet pertence ao cliente, servico esta ativo e pertence ao
tenant, profissional (se informado) pertence ao tenant, horario nao esta no
passado (salvo `allowPast: true`), e **conflito de horario** -- via
`pg_advisory_xact_lock` na mesma transacao, o que fecha a janela de corrida
entre duas requisicoes simultaneas para o mesmo profissional (ou para "a loja",
quando nenhum profissional e informado). Conflito devolve `409 TIME_SLOT_TAKEN`.

`PATCH /:id/status` segue a maquina de estados
(`SCHEDULED → CONFIRMED/IN_PROGRESS/CANCELLED/NO_SHOW → ...`); uma transicao
fora da ordem devolve `409 INVALID_STATUS_TRANSITION`. Cancelar e a UNICA
escrita permitida mesmo com o acesso do plano bloqueado (trial vencido) -- o
pet shop precisa conseguir desmarcar sem plano ativo.

---

## Recuperacao de clientes — `/api/retention`

`GET /` — permissao `retention:read`. Query `days` (7-365; se omitido, usa
`settings.inactiveCustomerDays` do tenant), alem da paginacao. Devolve clientes
que ja foram atendidos, nao tem agendamento futuro em aberto, e o ultimo
atendimento passou do limite de dias -- com `daysSinceLastVisit` e os nomes dos
pets, para montar a mensagem sugerida no frontend.

---

## Mensagens — `/api/messages`

| Rota | Permissao |
|------|-----------|
| `GET /` | `messages:read` |
| `POST /` | `messages:send` |

`POST /` registra que uma mensagem foi preparada e enviada por FORA do sistema
(o usuario clicou no link do WhatsApp e confirmou o envio pelo proprio
aplicativo) -- nasce com `status: "OPENED_EXTERNALLY"`, ja que
`WHATSAPP_PROVIDER=link` nao tem como confirmar entrega. `GET /` filtra por
`type`, `status`, `customerId`.

---

## Relatorios — `/api/reports`

### `GET /overview` — permissao `reports:read`

Query obrigatoria: `from`, `to` (YYYY-MM-DD).

```json
{
  "from": "2026-09-01", "to": "2026-09-30", "advanced": false,
  "appointments": { "total": 40, "completed": 32, "cancelled": 5, "noShow": 3 },
  "revenue": { "expected": 3200, "received": 2800 },
  "customers": { "new": 6, "recurring": 9, "inactive": 4 },
  "topServices": null
}
```

`advanced` reflete se o plano do tenant tem o recurso `advanced_reports` (ver
BILLING.md). Quando `false`, `topServices` vem `null` -- o frontend mostra um
cartao de upgrade contextual no lugar, nunca esconde a secao sem explicacao.

---

## Saude

`GET /health` — publico. `{ "status": "ok", "timestamp": "..." }`

---

## O que ainda nao existe

- **`/api/payments`** — o schema (`payments`) e usado internamente para calcular
  `totalSpent` do cliente e `revenue.received` dos relatorios, mas nao ha
  endpoint para registrar um pagamento manualmente ainda.
- **`/api/campaigns`** — schema existe, sem endpoint. Recuperacao de clientes
  hoje e sob demanda (`/api/retention` + `/api/messages`), nao por campanha
  agendada.
- **Checkout com gateway real** — `POST /billing/checkout` funciona e e testado,
  mas so devolve `checkoutUrl` quando um `BillingProvider` real for implementado
  (ver [BILLING.md](BILLING.md)).
