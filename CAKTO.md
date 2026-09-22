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

**Estado atual: responde `503` para toda requisicao, de proposito.** Isso nao
e uma pendencia esquecida -- e a unica opcao segura enquanto os tres dados
abaixo nao forem confirmados. Aceitar e processar um POST sem poder validar
sua origem, ou sem saber o que os campos do payload significam, seria pior do
que nao ter webhook nenhum.

### O que falta -- AGUARDANDO CONFIGURACAO DO PROJETO

**1. Mecanismo de autenticacao do webhook**

- **Por que e necessario:** sem validar a origem da requisicao, qualquer
  pessoa poderia enviar um POST fabricado para `/api/webhooks/cakto` e tentar
  ativar um plano PRO de graca. Isso violaria diretamente o isolamento entre
  tenants.
- **Onde encontrar na Cakto:** no painel da Cakto, na secao de configuracao
  de Webhooks do produto/checkout (normalmente ao lado de onde se cadastra a
  URL de notificacao). A Cakto pode usar um header de assinatura (tipo
  HMAC), um token fixo (em header ou querystring), ou outro mecanismo -- isso
  nao foi adivinhado.
- **O que enviar:** o nome exato do header (se houver), o algoritmo de
  assinatura (se for HMAC, qual hash e como o corpo e serializado antes de
  assinar), e o valor do segredo -- que vai para a variavel de ambiente
  `CAKTO_WEBHOOK_SECRET` (ja existe em `apps/api/src/config/env.ts` e em
  `.env.example`, vazia).

**2. Nomes e formato reais dos eventos**

- **Por que e necessario:** o sistema precisa mapear cada evento da Cakto
  para um dos status internos (`TRIALING`, `ACTIVE`, `PAST_DUE`,
  `CANCELLED`, `EXPIRED`). Inventar nomes de evento ("subscription.paid" foi
  usado apenas como EXEMPLO de payload num teste, nunca como valor real)
  arriscaria nunca bater com o que a Cakto de fato envia, silenciosamente
  quebrando a ativacao do PRO.
- **Onde encontrar na Cakto:** documentacao de Webhooks da Cakto (se
  publica) ou um payload de exemplo/teste enviado pelo proprio painel da
  Cakto (muitos gateways tem um botao "enviar evento de teste").
- **O que enviar:** para cada situacao -- pagamento aprovado, cobranca
  recorrente falhou (past due), assinatura cancelada, reembolso -- o nome
  exato do evento e um payload de exemplo (pode ser o de teste da propria
  Cakto).

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

### O que ja funciona, independente desses dados

- **Idempotencia.** Toda notificacao recebida (quando o processamento for
  ativado) e gravada em `billing_events`
  (`apps/api/migrations/0004_billing_events.sql`) com uma constraint unica em
  `(provider, event_id)`. Reentrega do mesmo evento -- comportamento normal
  de qualquer gateway, que reenvia ate receber `2xx` -- nunca cria uma
  assinatura ou pagamento duplicado. Testado em `cakto.test.ts`.
- **Isolamento entre tenants na propria tabela de eventos.** RLS ativo em
  `billing_events`, no mesmo padrao de todas as tabelas de negocio. Testado
  em `cakto.test.ts` com o mesmo padrao usado em `tenant-isolation.test.ts`
  (consulta deliberadamente sem filtro de tenant, dependendo so da policy).
- **Reuso do servico de billing existente.** Quando os tres itens acima
  forem fornecidos, o webhook passa a chamar `recordBillingEvent()` e depois
  `applyBillingWebhookEvent()` -- as MESMAS funcoes que ja existem em
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
uma liberacao global. Hoje isso e garantido pelo webhook responder `503` a
qualquer evento (ninguem vira PRO por engano porque nada e processado). Uma
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
link independente do tenant), o webhook respondendo `503` para qualquer
payload sem `CAKTO_WEBHOOK_SECRET`, idempotencia de `billing_events`
(evento duplicado gravado uma unica vez) e isolamento entre tenants na mesma
tabela.

Mocks sao usados **somente nesses testes automatizados**, nunca no produto
real -- nao ha nenhum caminho no codigo de producao que simule um pagamento
aprovado.

## Resumo do que falta

| Item | Status |
|------|--------|
| Link de checkout | Configurado (`CAKTO_PRO_CHECKOUT_URL`) |
| Variavel de ambiente do checkout | Configurada em `.env` / documentada em `.env.example` |
| Rota de webhook | Registrada, responde 503 de proposito |
| Tabela de idempotencia (`billing_events`) | Pronta e testada |
| Mecanismo de autenticacao do webhook | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| Nomes/formato reais dos eventos | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| Correlacao evento -> tenant | **AGUARDANDO CONFIGURACAO DO PROJETO** |
| `CAKTO_WEBHOOK_SECRET` | Vazia em `.env.example`, aguardando valor real |
