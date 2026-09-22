# Fase 2 — o que foi entregue

Escopo: transformar a fundacao tecnica da Fase 1 num produto SaaS completo,
visual, funcional e vendavel -- com trial, limites de plano e paywall reais,
controlados pelo backend do inicio ao fim.

## Verificacao

| Passo | Resultado |
|-------|-----------|
| `npm run lint` | Sem avisos (backend + frontend + testes) |
| `npm run typecheck` | Sem erros (contracts + api + web, TypeScript strict) |
| `npm test` | **92 testes de backend + 23 de frontend = 115**, todos passando |
| `npm run build` | Os tres pacotes compilam; bundle web ~176 kB gzip |
| Fluxo de aceitacao completo | Verificado via HTTP real (curl) de ponta a ponta -- ver abaixo |

## Auditoria inicial (o que a Fase 1 realmente tinha)

Antes de codificar, o estado real foi conferido no codigo, nao presumido a
partir do prompt original:

- **Existia de verdade:** auth, sessoes, tenants, usuarios/RBAC, audit log,
  dashboard -- com API completa e testada.
- **Nao existia:** `customers`, `pets`, `services`, `appointments` (so schema e
  contratos Zod, zero API). E, mais importante: **plans, subscriptions, trial e
  entitlements nao existiam em lugar nenhum** -- o prompt original da Fase 1
  dizia explicitamente "cobranca fica para depois", entao essa fundacao
  precisou ser construida do zero nesta fase, antes de qualquer coisa que
  dependesse dela (paywall, limites, indicadores de uso).

Essa lacuna foi resolvida com uma migration nova (`0003_billing.sql`: tabelas
`plans` e `subscriptions`, RLS, seed dos planos oficiais) e um modulo de
entitlements completo -- ver [BILLING.md](../BILLING.md) para o modelo inteiro.

## Backend construido nesta fase

- **Billing/entitlements**: `plans`, `subscriptions`, `getBillingStatus`,
  `assertActiveAccess`, `assertWithinLimit`, checkout via `BillingProvider`
  (sem gateway real), webhook autenticado por HMAC, catalogo publico de planos.
- **Clientes** (`/api/customers`): CRUD, busca, soft delete, resumo agregado
  (pets, ultima visita, proximo agendamento, total gasto) sem N+1.
- **Pets** (`/api/pets`): CRUD, propriedade cruzada validada (pet so pode
  pertencer a cliente do mesmo tenant, verificado no banco por FK composta e
  na aplicacao).
- **Servicos** (`/api/services`): CRUD, nome unico por tenant, preco congelado
  no agendamento.
- **Agenda** (`/api/appointments`): CRUD, maquina de estados
  (`SCHEDULED → CONFIRMED/IN_PROGRESS → COMPLETED`, cancelamento e falta a
  qualquer momento antes de concluido), deteccao de conflito de horario via
  `pg_advisory_xact_lock` na mesma transacao -- fecha a janela de corrida entre
  duas criacoes simultaneas.
- **Recuperacao** (`/api/retention`): clientes sumidos, janela configuravel.
- **Mensagens** (`/api/messages`): registro de mensagens preparadas e enviadas
  manualmente pelo WhatsApp (link, nao API oficial).
- **Relatorios** (`/api/reports`): agregados de atendimentos/receita/clientes,
  com secao avancada (servicos mais usados) gated pelo recurso `advanced_reports`
  do plano.

Todos os modulos novos reusam os padroes ja estabelecidos na Fase 1 (RLS,
`TenantContext`, `recordAudit`, `buildPagination`) -- nenhuma arquitetura
paralela foi criada.

## Frontend construido nesta fase

Landing publica, pricing (publica e autenticada), cadastro redirecionando para
onboarding, wizard de 6 passos (todos pulaveis), dashboard com barra de trial
global, clientes (lista + perfil + drawer), pets (lista + perfil + drawer),
servicos, agenda (dia/semana/lista + drawer com tratamento de conflito),
recuperacao (com composer de mensagem), mensagens (historico), relatorios (com
bloqueio contextual do PRO), billing (plano/uso/status), paywall (`/upgrade`),
equipe (pagina dedicada) e configuracoes (Empresa, WhatsApp, Automacao,
Aparencia).

Componentes novos de design system: `Drawer`, `Pagination`, `TrialBanner`,
`LimitBanner`, `UsageIndicator`. Sidebar reorganizada em grupos (`Gestao`,
`Conta`) conforme a estrutura pedida.

## Prova de que os limites sao reais (nao so visuais)

Testado via HTTP direto, sem passar pela UI:

```
92 testes de backend, incluindo:
- criar 10 clientes num tenant TRIAL -> sucesso; o 11o -> 409 LIMIT_REACHED
- criar 5 servicos -> sucesso; o 6o -> 409 LIMIT_REACHED
- criar 2 usuarios (OWNER + 1) -> sucesso; o 3o -> 409 LIMIT_REACHED
- forcar trialEndsAt no passado -> access.blocked=true, POST /customers -> 403
- mesmo bloqueado, GET /dashboard/overview continua 200 (leitura nunca bloqueia)
- mesmo bloqueado, cancelar um agendamento existente continua permitido
- POST /billing/checkout sem provider -> checkoutUrl: null, nunca finge sucesso
- webhook sem BILLING_WEBHOOK_SECRET -> 503
```

## Fluxo de aceitacao verificado manualmente

Com a API e o Vite dev server rodando, o fluxo completo do briefing foi
percorrido via curl, ponta a ponta, contra dados reais:

```
landing (200) -> POST /auth/register (TRIALING, 48h) -> PATCH /tenants/current
-> POST /services -> POST /customers -> POST /pets -> POST /appointments
(status SCHEDULED, preco herdado do servico) -> GET /dashboard/overview
(mostra o agendamento) -> GET /retention (200) -> GET /messages (200)
-> GET /reports/overview (200) -> GET /billing/status
(usage.customers = 1/10, usage.appointments = 1/10, ...)
```

E, separadamente: um segundo tenant criado do zero confirma `customers.total: 0`
(isolamento entre tenants preservado nos modulos novos), `GET /api/plans`
funciona sem sessao, e `POST /billing/checkout` responde honestamente sem
provider configurado.

## O que foi declarado, nao escondido

- **Sem gateway de pagamento real.** Checkout e webhook existem e funcionam,
  mas sem uma implementacao de `BillingProvider` alem do `NullBillingProvider`.
  Ver BILLING.md para o que falta (e e pouco: uma classe nova).
- **Sem E2E de navegador.** Testes de frontend cobrem logica pura e componentes
  isolados (Vitest + Testing Library); os fluxos completos foram verificados
  via HTTP direto durante o desenvolvimento, nao por um navegador automatizado.
  Playwright e o proximo passo natural, declarado e nao fingido.
- **`/api/payments` e `/api/campaigns` nao tem endpoint.** O schema existe
  (usado internamente para `totalSpent` e relatorios); a API dedicada fica para
  uma proxima fase.
- **Bundle de ~176 kB gzip.** Aceitavel para o tamanho atual do produto; o
  primeiro lugar a olhar se crescer e a exportacao dos schemas Zod junto com os
  tipos em `packages/contracts`.

## Proximo passo natural

Conectar um `BillingProvider` real (Stripe, Mercado Pago ou similar) -- a
arquitetura ja esta pronta para receber essa implementacao sem tocar em regra
de negocio, rota ou frontend (ver ADR-013 em ARCHITECTURE.md). Em paralelo,
`/api/payments` para registro manual de recebimento, e uma suite Playwright
para os fluxos criticos de conversao.
