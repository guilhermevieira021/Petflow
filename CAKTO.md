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
| `secret` correto e payload com `event`/`data.id` | `200` -- evento gravado em `billing_events` de forma idempotente, com `tenantId: null` |

Ou seja: o endpoint ja recusa qualquer requisicao que nao consiga autenticar,
e ja registra com seguranca qualquer evento autentico que receber -- mas
ainda NAO chama `applyBillingWebhookEvent()` (ainda nao muda o status de
nenhuma assinatura), porque faltam os dois itens abaixo. Um evento aceito
fica disponivel em `billing_events` para reconciliacao manual ate la.

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

**3. Correlacao entre o evento de webhook e o tenant do nosso sistema**

- **Por que e necessario:** como o link de checkout e o mesmo link estatico
  para todos os pet shops (ver acima), o payload do webhook precisa trazer
  alguma informacao que identifique QUAL tenant comprou. Sem isso, nao ha
  como atualizar "so o tenant que pagou" sem arriscar atualizar o errado --
  e o requisito de isolamento entre tenants e explicito e inegociavel aqui.
- **Onde encontrar na Cakto:** depende de qual recurso a Cakto oferece.
  Possibilidades comuns em checkouts hospedados (nenhuma confirmada ainda
  para esta conta):
  - um parametro de referencia externa que pode ser anexado ao link de
    checkout (ex.: `?ref=` ou `?external_id=`) e que a Cakto ecoa de volta
    no payload do webhook;
  - o e-mail do comprador no checkout, correlacionado ao e-mail do OWNER do
    tenant (mais fragil -- exige e-mails identicos e sem duplicidade);
  - um identificador de produto/oferta por tenant, se a Cakto permitir criar
    um link de checkout distinto por cliente.
- **O que enviar:** se a Cakto suportar um parametro de referencia
  externa que retorna no webhook, esse e o nome do parametro. Caso contrario,
  como a Cakto sugere identificar o comprador no payload recebido.

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
- **Reuso do servico de billing existente.** Quando os itens 2 e 3 acima
  forem fornecidos, o webhook passa a mapear `eventType` para um status e
  chamar `applyBillingWebhookEvent()` -- a MESMA funcao que ja existe em
  `apps/api/src/modules/billing/billing.service.ts` desde a Fase 2. Nao havera
  um sistema de assinatura paralelo.

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
uma liberacao global. Hoje isso e garantido porque o webhook, mesmo aceitando
e gravando um evento autentico, nunca chama `applyBillingWebhookEvent()`
(ninguem vira PRO por engano porque nenhuma assinatura e alterada). Uma
vez que o item 3 acima ("Correlacao de tenant") for resolvido, a garantia
passa a ser: o `tenantId` usado para atualizar `subscriptions` vem
exclusivamente do que o evento do webhook permitir identificar -- nunca de um
`tenantId` enviado pelo cliente/frontend. `applyBillingWebhookEvent` ja roda
com esse principio (recebe o tenant como parametro explicito, nao infere de
sessao).

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

Cobre: `CaktoProvider` (link configurado devolvido sem chamada de rede; mesmo
link independente do tenant); o webhook respondendo `503` sem
`CAKTO_WEBHOOK_SECRET` configurada, `403` com secret ausente/incorreto, `400`
com secret correto mas payload incompleto, e `200` com evento autentico
gravado; idempotencia de `billing_events` (evento duplicado gravado uma unica
vez, inclusive reentregue via HTTP real) e isolamento entre tenants na mesma
tabela.

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
| Nomes dos demais eventos (past due, cancelamento, reembolso, chargeback) | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| Correlacao evento -> tenant | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| Mapeamento evento -> status de assinatura | Nao implementado -- depende das duas linhas acima |
| `CAKTO_WEBHOOK_SECRET` em producao | Vazia em `.env.example`, aguardando confirmacao do valor real salvo no painel Cakto |
| URL publica do webhook (para cadastrar na Cakto) | **AGUARDANDO** -- projeto ainda sem dominio de producao definido |
