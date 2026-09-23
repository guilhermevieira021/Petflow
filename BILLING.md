# Billing, planos e trial

## Modelo mental

Tres conceitos, cada um com uma tabela e um servico proprios:

| Conceito | Tabela | O que e |
|----------|--------|---------|
| **Plano** | `plans` | Catalogo global (TRIAL, PRO): limites, recursos e preco |
| **Assinatura** | `subscriptions` | Um registro por tenant, ligando-o a um plano com um status |
| **Uso** | calculado, nao guardado | Contagem em tempo real de clientes/pets/etc do tenant |

Nao existe `if (plan === 'PRO')` em lugar nenhum do codigo. Toda decisao passa por
`hasFeature(plan, FeatureKey.X)` ou `assertWithinLimit(tx, context, LimitKey.Y)`, em
`apps/api/src/modules/billing/billing.service.ts`. Trocar um numero de limite ou
ativar um recurso para o PRO e uma mudanca na migration (ou, no futuro, numa tabela
administravel) -- nunca uma mudanca espalhada pelo React.

## Planos de hoje

Seedados pela propria migration (`0003_billing.sql`), nao pelo script de
desenvolvimento -- existem em qualquer ambiente, inclusive producao.

| | TRIAL | PRO |
|---|---|---|
| Preco | Gratis | R$ 99,90/mes |
| Duracao | 48 horas | Recorrente |
| Clientes | 10 | Ilimitado |
| Pets | 15 | Ilimitado |
| Agendamentos | 10 (total, nao por mes) | Ilimitado |
| Servicos | 5 | Ilimitado |
| Usuarios | 2 | 10 |
| Relatorios avancados | Nao | Sim |
| Automacao de mensagens | Nao | Sim |
| Recuperacao sem limite de janela | Nao | Sim |

O limite de **agendamentos no TRIAL e vitalicio, nao mensal**: e uma cota de
experimentacao (10 agendamentos para conhecer o produto), nao um teto de agenda
ativa. Cancelar um agendamento nao devolve a cota -- ver o comentario em
`computeUsage()` no servico de billing.

## Ciclo de vida da assinatura

```
TRIALING --(pagamento aprovado)--> ACTIVE
TRIALING --(48h sem pagamento)---> [bloqueado, mesmo status] -- ver "Acesso" abaixo
ACTIVE   --(falha de cobranca)--->  PAST_DUE
PAST_DUE --(pagamento resolvido)-> ACTIVE
PAST_DUE --(cancelamento)-------->  CANCELLED
ACTIVE   --(cancelamento)-------->  CANCELLED
CANCELLED (apos current_period_end) -> [bloqueado]
qualquer -> EXPIRED (encerramento definitivo, ex.: falha de pagamento por tempo demais)
```

`TRIALING` e `CANCELLED` **nao mudam de status automaticamente** quando vencem --
`getBillingStatus()` calcula `access.blocked` comparando `trialEndsAt`/
`currentPeriodEnd` com `now()` a cada chamada. Isso evita depender de um job
agendado so para "arrumar" o status; o efeito e sempre o mesmo, calculado sob
demanda.

## Acesso bloqueado

`access.blocked` e `true` quando:

| Status | Bloqueado quando |
|--------|-------------------|
| `TRIALING` | `trialEndsAt` no passado |
| `ACTIVE` | nunca |
| `PAST_DUE` | nunca -- periodo de graca, o pet shop continua usando enquanto a cobranca e reprocessada |
| `CANCELLED` | `currentPeriodEnd` no passado (antes disso, continua usando ate o fim do periodo pago) |
| `EXPIRED` | sempre |

`assertActiveAccess()` e chamado no INICIO de toda escrita de negocio (criar
cliente, pet, servico, agendamento, usuario). **Leitura nunca e bloqueada** -- e
assim que a tela de upgrade consegue dizer "seus dados continuam salvos", e e
assim que o dashboard e a lista de clientes continuam funcionando mesmo com o
trial vencido. A unica excecao de escrita permitida quando bloqueado e
**cancelar um agendamento** (`changeAppointmentStatus` com `status: CANCELLED`) --
o pet shop precisa conseguir desmarcar mesmo sem plano ativo.

## Entitlements: as duas barreiras

```ts
await assertActiveAccess(tx, context);        // 1. o plano permite usar o sistema?
await assertWithinLimit(tx, context, LimitKey.CUSTOMERS); // 2. ha cota para este recurso?
```

Ambas rodam **dentro da mesma transacao** da escrita. Isso fecha a janela de
corrida: duas requisicoes simultaneas criando o 10o e o 11o cliente do TRIAL
serializam pela mesma conexao, e a segunda ve o efeito da primeira antes de
decidir. Nao ha como criar 11 clientes chamando a API em paralelo.

`assertWithinLimit` conta o uso ATUAL do banco a cada chamada -- nao ha contador
cacheado que possa ficar dessincronizado.

## O frontend nunca decide

- `GET /api/billing/status` e a fonte de verdade para plano, uso e bloqueio.
  `GET /api/auth/me` carrega uma copia no campo `billing`, para o app pintar o
  TrialBanner e o paywall sem uma chamada extra logo no boot.
- `session.billing.usage.X.limit` e `.used` vem sempre do backend. Nao existe
  `10` ou `15` escrito em nenhum componente React -- um grep por numero
  hardcoded no frontend nao encontra nada.
- Tentar criar o 11o cliente pelo DevTools, sem passar pela UI, ainda resulta em
  `409 LIMIT_REACHED` -- o backend recusa independentemente do que o frontend
  mostrou.
- `localStorage` nao guarda nada sobre plano ou assinatura. Editar o
  `localStorage` nao libera nada: o proximo `GET /billing/status` sobrescreve
  qualquer estado local.

## Checkout e o BillingProvider

```ts
interface BillingProvider {
  readonly name: string;
  readonly configured: boolean;
  createCheckoutSession(params): Promise<{ checkoutUrl: string }>;
}
```

Definido em `apps/api/src/integrations/billing/billing.provider.ts`. Hoje existem
duas implementacoes: `NullBillingProvider` (`configured = false`, usada quando
nenhum checkout esta configurado) e `CaktoProvider` (`configured = true` quando
`CAKTO_PRO_CHECKOUT_URL` esta definida). `POST /api/billing/checkout` NUNCA
inventa uma URL de checkout: sem provider configurado, devolve
`{ checkoutUrl: null, message: "..." }` e o frontend mostra essa mensagem
honestamente, sem fingir que o pagamento esta disponivel.

O `CaktoProvider` e deliberadamente simples: a Cakto expoe um link de checkout
hospedado e estatico (nao uma API que gera sessoes dinamicas), entao
`createCheckoutSession()` so devolve esse link -- o MESMO link para qualquer
tenant. Ver [CAKTO.md](CAKTO.md) para o detalhe completo da integracao,
incluindo a lacuna que isso cria (correlacao de tenant no webhook).

Trocar de provider ou adicionar outro:

1. Implementar uma classe que satisfaz `BillingProvider`.
2. Ajustar `getBillingProvider()` para escolher essa classe conforme variavel
   de ambiente.
3. Nenhuma outra linha muda -- nem `billing.service.ts`, nem as rotas, nem o
   frontend, que ja sabe lidar com `checkoutUrl` presente (redireciona) ou
   ausente (mostra a mensagem).

## Webhook

`POST /api/webhooks/cakto` e a rota reservada para a Cakto notificar mudancas
de assinatura. Nao ha rota que o frontend chame para "confirmar" um pagamento
-- o retorno do checkout so mostra "Estamos confirmando seu pagamento..." e
consulta `GET /billing/status`, nunca assume sucesso sozinho (ver
`BillingPage.tsx`/`UpgradePage.tsx`/`PricingPage.tsx` e `lib/checkout.ts`).

O webhook ja autentica de verdade (`secret` no corpo, confirmado com a conta
Cakto) e ja grava com seguranca qualquer evento autentico em `billing_events`.
O que falta e o nomes/formato dos eventos alem de `purchase_approved` e como o
payload identifica o tenant -- sem isso, o webhook ainda nao chama
`applyBillingWebhookEvent` (nao aplica nada a uma assinatura). Ver
[CAKTO.md](CAKTO.md) para o que falta exatamente e onde encontrar cada dado no
painel da Cakto -- este arquivo nao antecipa nenhum desses detalhes.

A infraestrutura de idempotencia ja existe e esta testada, independente do
gateway: toda notificacao recebida e gravada em `billing_events`
(`provider`, `event_id`, `event_type`, `payload`, `status`) com uma constraint
unica em `(provider, event_id)` -- reentrega do mesmo evento nunca reprocessa
nem duplica assinatura/pagamento. Quando os dados da Cakto chegarem, o webhook
passa a: validar a autenticidade, gravar o evento (`recordBillingEvent`),
mapear o tipo de evento real para um status de assinatura, e aplicar via
`applyBillingWebhookEvent` -- reaproveitando o servico de billing existente,
nao um caminho paralelo.

## Sincronizacao do frontend

Apos qualquer acao que possa mudar o estado do plano (criar cliente, iniciar
checkout, etc.), o frontend invalida `['billing']` e `['session']` no React
Query -- nunca assume que o numero antigo continua certo. Apos iniciar um
checkout sem confirmacao imediata, a UI mostra "Estamos aguardando a confirmacao
do pagamento" (ver `BillingPage.tsx`/`UpgradePage.tsx`) em vez de marcar o PRO
como ativo.

## O que falta para cobranca de verdade

O checkout ja usa o link real da Cakto. O que falta e exclusivamente do lado
do webhook, e depende de dados que so existem na conta/painel Cakto -- ver
[CAKTO.md](CAKTO.md) para a lista exata e onde encontrar cada um:

1. Mecanismo de autenticacao do webhook (assinatura, token, ou outro).
2. Nomes/formato reais dos eventos da Cakto (pagamento aprovado, recorrencia
   falhou, cancelamento, reembolso).
3. Como correlacionar um evento de webhook ao tenant que comprou (o link de
   checkout hoje e o mesmo para todos os tenants).

Nenhuma mudanca de schema, de regra de negocio ou de frontend adicional e
necessaria depois que esses tres dados forem fornecidos -- a tabela
`billing_events`, o `BillingProvider`, e o servico de billing ja estao
prontos para recebe-los.
