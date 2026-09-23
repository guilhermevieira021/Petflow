# Integracao Cakto

Este arquivo documenta o estado real da integracao com a Cakto: o que ja
funciona, o que esta preparado mas inativo, e exatamente quais dados faltam
para ativar cada parte. Nada aqui foi inventado -- onde um dado da conta
Cakto e necessario e ainda nao foi fornecido, isso esta marcado
**AGUARDANDO CONFIGURACAO DO PROJETO**.

Modelo adotado: TRIAL (48h) -> upgrade -> checkout hospedado da Cakto ->
assinatura recorrente **gerenciada pela Cakto** (nunca por nos) -> webhook ->
assinatura `ACTIVE` -> PRO liberado. O sistema nunca processa nem guarda dado
de cartao, e nunca implementa cobranca recorrente propria.

## Checkout -- funcionando

A Cakto expoe um link de checkout **hospedado e estatico** (nao uma API que
gera uma sessao por compra). Por isso a integracao do lado do checkout e
deliberadamente simples:

| Item | Valor |
|------|-------|
| Variavel de ambiente | `CAKTO_PRO_CHECKOUT_URL` |
| Valor configurado | `https://pay.cakto.com.br/upofina_1130180` |
| Onde e usado | `CaktoProvider` (`apps/api/src/integrations/billing/billing.provider.ts`) |
| Como e exposto ao frontend | `POST /api/billing/checkout` devolve `{ checkoutUrl }`; o botao "Assinar PRO" redireciona para ele |

Nenhum segredo trafega para o frontend -- o link e publico por natureza (e um
checkout hospedado), e mesmo assim so sai do backend via essa rota, nunca
hardcoded em componente React.

**Limitacao conhecida, por design da Cakto:** o link e o **mesmo para
qualquer tenant** -- verificado em teste
(`apps/api/src/tests/cakto.test.ts`, "o link devolvido e sempre o mesmo,
independente do tenant"). Isso significa que, sozinho, o retorno do checkout
nao diz qual pet shop comprou. Ver "Correlacao de tenant" abaixo.

## Webhook -- preparado, aguardando configuracao

Rota registrada: `POST /api/webhooks/cakto`
(`apps/api/src/http/routes/cakto-webhook.routes.ts`, montada em
`apps/api/src/http/server.ts`).

**Estado atual: autenticacao real implementada; aplicacao a uma assinatura
ainda nao.** A conta Cakto confirmou (painel "Adicionar Webhook") que a
autenticidade do evento vem de um campo `secret` DENTRO do corpo JSON,
comparado com o valor configurado no painel -- nao e assinatura HMAC em
header. Isso ja esta implementado com comparacao em tempo constante
(`timingSafeEqual`). Hoje o endpoint:

| Situacao | Resposta |
|---|---|
| `CAKTO_WEBHOOK_SECRET` nao configurada nesta instalacao | `503` |
| `secret` do corpo ausente ou nao bate com o configurado | `403` |
| `secret` correto, mas falta `event` ou `data.id` no corpo | `400` |
| `secret` correto e payload com `event`/`data.id` | `200` -- evento gravado em `billing_events` de forma idempotente |

O que acontece depois de gravar o evento depende do `event`:

| `event` | Comportamento |
|---|---|
| `purchase_approved`, `data.paidAt` valido, `data.customer.email` bate com um OWNER ativo | Calcula o novo periodo (`data.paidAt` + 30 dias) e chama `applyBillingWebhookEvent()` -- PRO/ACTIVE de verdade. |
| `purchase_approved`, `data.paidAt` valido, mas email nao identifica um tenant unico | Evento fica `RECEIVED`, pendente de reconciliacao manual -- nunca adivinha. |
| `purchase_approved`, sem `data.paidAt` valido | Evento marcado `FAILED` em `billing_events.status`, com o motivo em `errorMessage`. Ainda responde `200` (para a Cakto nao reentregar para sempre algo que nunca vai ficar valido). |
| Qualquer outro `event` (nomes ainda nao confirmados) | Gravado, mas nunca aplicado -- o sistema so age sobre eventos cujo significado foi confirmado. |

Ou seja: o endpoint ja recusa qualquer requisicao que nao consiga autenticar,
ja registra com seguranca qualquer evento autentico que receber, e ja sabe
CALCULAR corretamente o novo periodo de uma compra aprovada -- mas ainda NAO
consegue aplicar isso a NENHUMA assinatura real, porque falta o item 3
abaixo (correlacao de tenant). Um evento aceito mas nao aplicado fica
disponivel em `billing_events` (status `RECEIVED`) para reconciliacao manual.

### O que falta -- AGUARDANDO CONFIGURACAO DO PROJETO

**1. Confirmar o valor real do segredo**

- **Por que e necessario:** o valor visto no campo "Chave secreta do
  webhook" do painel da Cakto e o que precisa ir para `CAKTO_WEBHOOK_SECRET`
  em producao. O JSON de exemplo mostrado no proprio painel ("Modelo") tem um
  `secret` fixo, ilustrativo -- nao e o segredo real da instalacao, e nao
  deve ser usado como se fosse.
- **O que enviar:** o valor exato salvo no campo "Chave secreta do webhook".

**2. Nomes e formato reais dos eventos**

- **Confirmado ate agora:** `purchase_approved` -- payload completo
  documentado abaixo em "Payload confirmado: purchase_approved".
- **Por que ainda falta:** o sistema precisa mapear cada evento da Cakto
  para um dos status internos (`TRIALING`, `ACTIVE`, `PAST_DUE`,
  `CANCELLED`, `EXPIRED`). So temos o evento de compra aprovada -- faltam os
  de cobranca recorrente falhou (past due), assinatura cancelada, reembolso e
  chargeback. Mapear so o que ja sabemos e deixar os outros sem tratamento
  arriscaria uma assinatura ficar presa em `ACTIVE` mesmo apos cancelamento
  ou reembolso real.
- **Onde encontrar na Cakto:** no painel "Adicionar Webhook", o campo acima
  do "Tipo de disparo" (mostrando "Compra aprov...") -- abrir esse dropdown
  deve listar os demais eventos disponiveis para assinar.
- **O que enviar:** a lista completa de opcoes desse dropdown, ou o nome
  exato de cada evento (idealmente com um payload de exemplo, como o que ja
  temos para `purchase_approved`).

**3. Correlacao entre o evento de webhook e o tenant do nosso sistema -- RESOLVIDO**

`resolveTenantIdFromCaktoEvent()` (`cakto-events.ts`) casa `data.customer.email`
(normalizado) contra `users.email` (globalmente unico, `users_email_unique`)
restrito a `role = 'OWNER'` e `active = true`. So aplica quando o resultado e
INEQUIVOCO (exatamente um match); zero ou mais de um -> `null`, evento fica
`RECEIVED` para reconciliacao manual, nada e alterado. Testado ponta a ponta
via HTTP real em `cakto.test.ts`, incluindo o caso critico: pagamento do
Tenant A nunca ativa o Tenant B.

**Limite conhecido, nao escondido:** se a pessoa usar no checkout da Cakto um
email DIFERENTE do que usa para logar no PetFlow, a correlacao falha (com
seguranca -- fica pendente, nunca adivinha). Se a Cakto no futuro confirmar
que `refId` pode ser definido por nos (parametro no link de checkout, ecoado
no webhook), essa seria uma correlacao mais robusta -- mas nao e mais um
bloqueador: o sistema funciona hoje para o caso comum (mesmo email).

### Payload confirmado: `purchase_approved`

Exemplo de documentacao fornecido pela propria Cakto (painel "Adicionar
Webhook", caixa "Modelo") -- valores como `"John Doe"`, `example.com` e
`checkoutUrl` terminando em `EXAMPLE` confirmam que e ilustrativo, nao um
evento real capturado. A FORMA dos campos, essa sim, e real:

```json
{
  "secret": "<segredo configurado no painel>",
  "event": "purchase_approved",
  "data": {
    "id": "uuid -- id do evento/transacao, usado como eventId em billing_events",
    "refId": "string curta -- candidato a correlacao de tenant, ainda nao confirmado",
    "customer": { "name": "...", "email": "...", "phone": "...", "docNumber": "...", "docType": "cpf" },
    "offer": { "id": "...", "name": "...", "price": 100 },
    "product": { "id": "uuid", "name": "...", "type": "unique" },
    "subscription": null,
    "subscription_period": 1,
    "status": "paid",
    "baseAmount": 100,
    "discount": 10,
    "amount": 90,
    "paymentMethod": "credit_card",
    "paidAt": "2026-06-26T12:00:00.000000+00:00",
    "createdAt": "2026-06-26T12:00:00.000000+00:00",
    "refundedAt": null,
    "chargedbackAt": null,
    "canceledAt": null
  }
}
```

Pontos relevantes para quando o mapeamento de eventos for implementado:

- `subscription: null` neste exemplo porque e um produto `"type": "unique"`
  (compra unica). Para o plano PRO (recorrente), uma compra real deve trazer
  esse campo preenchido -- vale confirmar o formato quando a primeira compra
  real acontecer.
- `refundedAt` / `chargedbackAt` / `canceledAt` aparecem no MESMO formato de
  evento (`purchase_approved`, campo `status`/`data.*_At` mudando) ou sao
  eventos `event` diferentes (`refund_approved`, `chargeback`, etc.)? Ainda
  nao confirmado -- e exatamente o item 2 acima.
- `data.id` e usado hoje como `eventId` (chave de idempotencia em
  `billing_events`); `event` e usado como `eventType`.

### Ativacao do PRO e os 30 dias

Quando um `purchase_approved` puder ser aplicado (assim que a correlacao de
tenant existir), a ativacao segue exatamente esta regra, implementada em
`apps/api/src/modules/billing/cakto-events.ts` e testada com datas fixas em
`cakto-events.test.ts` (sem esperar 30 dias de verdade):

```
startedAt  = data.paidAt                      (NUNCA data de cadastro, criacao
                                                de conta ou abertura do checkout)
expiresAt  = startedAt + 30 dias               (computeProPeriodEnd)
```

`expiresAt` e gravado na coluna JA EXISTENTE `subscriptions.current_period_end`
-- a mesma que ja alimenta "Renova em..." na tela de billing e que
`applyBillingWebhookEvent` ja sabia atualizar desde a Fase 2. Nao foi criada
nenhuma coluna nova (`started_at`/`expires_at`); reaproveitar
`current_period_end` evita duplicar o mesmo dado sob dois nomes.

**Uma renovacao** (uma segunda compra aprovada, com `eventId` diferente e
`paidAt` mais recente) recalcula `expiresAt` a partir do NOVO `paidAt` --
testado em `cakto.test.ts` ("renovacao: uma SEGUNDA compra aprovada..."),
provando que o periodo estende a partir da data certa, sem somar dias ao
valor anterior.

**Sobre a "expiracao" apos os 30 dias:** hoje, uma assinatura `ACTIVE` NUNCA
se autobloqueia so por `current_period_end` ter passado --
`computeAccess()` (`billing.service.ts`) devolve `blocked: false` para
`ACTIVE` incondicionalmente. Isso e proposital e preexistente a esta tarefa:
como e a Cakto quem gerencia a cobranca recorrente, o sistema espera um
evento explicito dela (cobranca falhou, cancelamento) para mudar o acesso --
nunca decide sozinho que "30 dias se passaram, corta o acesso", porque isso
poderia derrubar um cliente cuja renovacao a Cakto ja processou mas cujo
webhook ainda nao chegou. `current_period_end` e informativo ("Renova em..."),
nao um portao de acesso para `ACTIVE`. Ver "O que falta" acima -- os nomes de
evento para atraso/cancelamento sao exatamente o que falta para o `PAST_DUE`/
`CANCELLED` acontecerem de verdade.

### O que ja funciona, independente desses dados

- **Autenticacao real.** `secret` do corpo comparado em tempo constante com
  `CAKTO_WEBHOOK_SECRET`. Testado em `cakto.test.ts` (secret errado -> 403;
  secret ausente -> 403; sem `CAKTO_WEBHOOK_SECRET` configurada -> 503).
- **Idempotencia.** Toda notificacao autenticada e gravada em
  `billing_events` (`apps/api/migrations/0004_billing_events.sql`) com uma
  constraint unica em `(provider, event_id)`. Reentrega do mesmo evento --
  comportamento normal de qualquer gateway, que reenvia ate receber `2xx` --
  nunca cria uma assinatura ou pagamento duplicado. Testado via HTTP real em
  `cakto.test.ts`.
- **Isolamento entre tenants na propria tabela de eventos.** RLS ativo em
  `billing_events`, no mesmo padrao de todas as tabelas de negocio. Testado
  em `cakto.test.ts` com o mesmo padrao usado em `tenant-isolation.test.ts`
  (consulta deliberadamente sem filtro de tenant, dependendo so da policy).
- **Calculo do periodo de 30 dias.** `computeProPeriodEnd()` em
  `cakto-events.ts`, puro e testado com datas fixas (virada de mes/ano,
  limite exato do prazo).
- **Ativacao completa, ja testada ponta a ponta contra o banco real.**
  `cakto.test.ts` ("Ativacao da assinatura") chama `applyBillingWebhookEvent`
  com um tenant real criado no teste e confirma: status TRIALING -> ACTIVE,
  plano TRIAL -> PRO, `current_period_end` = `paidAt` + 30 dias,
  `GET /billing/status` reflete PRO com limites liberados (`null` =
  ilimitado) e `trial.active = false`. Isso E o caminho que o webhook usa
  internamente -- so falta o passo anterior (identificar o tenant) para o
  webhook chamar isso sozinho.
- **Idempotencia tambem no nivel de assinatura, nao so na tabela de
  eventos.** Reentregar o MESMO evento (mesmo `eventId`) nao soma 30 dias de
  novo -- testado explicitamente em "idempotencia real" em `cakto.test.ts`.
- **Reuso do servico de billing existente.** O webhook nao duplica logica de
  entitlements/limites: `applyBillingWebhookEvent()` e `getBillingStatus()`
  sao as MESMAS funcoes que ja existem em
  `apps/api/src/modules/billing/billing.service.ts` desde a Fase 2. So falta
  o item 3 acima (correlacao de tenant) para o webhook poder chama-las
  sozinho, sem intervencao manual.

## Trial

Sem mudanca de comportamento: 48h, mesmos 5 limites (clientes, pets,
agendamentos, servicos, usuarios). Tornar-se PRO remove os limites; dados
criados durante o trial nunca sao apagados na transicao.

## Retorno do checkout

O retorno do checkout **nunca** libera o PRO sozinho -- so
`GET /billing/status` (atualizado pelo webhook) decide isso. Implementado com
um sinal proprio em `sessionStorage`
(`apps/web/src/lib/checkout.ts`), que nao depende de conhecer a URL de
retorno que a Cakto usa:

1. `markCheckoutStarted()` roda antes do redirecionamento para o checkout, em
   `BillingPage.tsx`, `UpgradePage.tsx` e `PricingPage.tsx`.
2. Ao voltar para `/billing` (ou `/upgrade`), `isReturningFromCheckout()`
   (valido por 30 minutos) ativa o banner "Estamos confirmando seu
   pagamento..." e passa a consultar `GET /billing/status` a cada 4s.
3. Consulta por no maximo 60s (`CONFIRMATION_TIMEOUT_MS`) -- nunca fica
   consultando para sempre. Se `subscription.status` virar `ACTIVE` durante
   esse tempo, mostra "Plano PRO ativado." e limpa o sinal.
4. Sem confirmacao dentro do prazo, a pessoa pode atualizar a pagina mais
   tarde -- o estado real nunca depende da aba continuar aberta.

`PricingPage.tsx` usa o mesmo sinal para trocar o botao "Assinar PRO" por um
botao desabilitado "Pagamento em processamento" enquanto aguarda.

## Isolamento entre tenants (critico)

Se o Tenant A pagar, so o Tenant A vira PRO -- nunca todos os tenants, nunca
uma liberacao global. O `tenantId` usado para atualizar `subscriptions` vem
exclusivamente de `resolveTenantIdFromCaktoEvent()` (email do OWNER, ver
acima) -- nunca de um `tenantId` enviado pelo cliente/frontend, e nunca de um
palpite quando o resultado nao e inequivoco. Testado explicitamente em
`cakto.test.ts` ("CRITICO: pagamento com o email do OWNER do Tenant A nunca
ativa o Tenant B") -- dois tenants criados, pagamento de um, o outro
confirmado intocado no banco.

## Seguranca

- O frontend nunca pode alterar `subscription.status`, o plano, ou liberar o
  PRO -- essas colunas so mudam via `applyBillingWebhookEvent`, chamado a
  partir do webhook autenticado (quando ativo) ou em teste via `withSystem`
  direto no banco.
- Nao existe rota que aceite um `tenantId` arbitrario do cliente para marcar
  uma assinatura como paga.
- Nenhum dado de cartao e processado ou armazenado por este sistema em nenhum
  momento -- todo o fluxo de pagamento acontece inteiramente na Cakto.

## Como testar hoje

```bash
npm test -w @petflow/api -- cakto
```

Roda `cakto.test.ts` (integracao HTTP + banco real) e `cakto-events.test.ts`
(unidades puras). Cobre: `CaktoProvider` (link configurado devolvido sem
chamada de rede; mesmo link independente do tenant); o webhook respondendo
`503` sem `CAKTO_WEBHOOK_SECRET` configurada, `403` com secret
ausente/incorreto, `400` com secret correto mas payload incompleto, e `200`
com evento autentico gravado (aplicado ou nao, conforme a tabela acima);
eventos de tipo nao mapeado e `purchase_approved` sem `paidAt` valido;
idempotencia de `billing_events` E de assinatura (evento duplicado nao soma
dias); isolamento entre tenants; calculo dos 30 dias com datas fixas
(inclusive limite exato do prazo); ativacao completa TRIALING -> ACTIVE/PRO
contra o banco real; e renovacao (segunda compra estende o periodo a partir
da nova data).

Mocks sao usados **somente nesses testes automatizados**, nunca no produto
real -- nao ha nenhum caminho no codigo de producao que simule um pagamento
aprovado.

## Resumo do que falta

| Item | Status |
|------|--------|
| Link de checkout | Configurado (`CAKTO_PRO_CHECKOUT_URL`) |
| Variavel de ambiente do checkout | Configurada em `.env` / documentada em `.env.example` |
| Rota de webhook | Registrada; autenticacao real implementada (403/400/200 conforme o payload) |
| Mecanismo de autenticacao do webhook | Implementado (`secret` no corpo, comparacao em tempo constante) -- falta so confirmar o VALOR real em producao |
| Tabela de idempotencia (`billing_events`) | Pronta e testada, inclusive via HTTP real |
| Evento `purchase_approved` | Payload completo confirmado e documentado acima |
| Calculo dos 30 dias (`paidAt` + 30 dias -> `current_period_end`) | Implementado e testado (`cakto-events.ts`, `cakto-events.test.ts`) |
| Ativacao ACTIVE/PRO via `applyBillingWebhookEvent`, ponta a ponta via HTTP | **Implementada e testada** (inclusive isolamento entre tenants) |
| Correlacao evento -> tenant (`resolveTenantIdFromCaktoEvent`, por email do OWNER) | **Implementada e testada** -- limite conhecido: exige mesmo email no checkout e no login |
| Idempotencia (tabela de eventos E assinatura, nao soma dias em reentrega) | Implementada e testada |
| Nomes dos demais eventos (past due, cancelamento, reembolso, chargeback) | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| `CAKTO_WEBHOOK_SECRET` em producao | Valor real fornecido -- falta configurar como variavel de ambiente no host publico da API (ainda nao definido) |
| API publicada externamente | **NAO PUBLICADA** -- nenhum host (Railway/Render/Fly/etc.) configurado ainda |
| URL publica do webhook (para cadastrar na Cakto) | **AGUARDANDO** -- ver secao de teste em producao |
