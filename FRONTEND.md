# Frontend

React 19 + Vite 6 + TypeScript + Tailwind v4 + TanStack Query + React Router 7.

## Principio

**O frontend apresenta, o backend autoriza.** Toda tela consulta `useSession()`
para decidir o que MOSTRAR (menu, botoes, campos); a decisao que VALE e sempre a
resposta HTTP. Esconder um botao de quem nao tem permissao e cortesia de
interface, nao seguranca -- e por isso o backend recusa a mesma acao mesmo que
alguem chame a API direto pelo DevTools (ver os 92 testes de integracao da API).

## Estrutura

```
src/components/
  ui/           Design system: Button, Field, Drawer, ConfirmDialog, Pagination,
                 Toast, primitives (Card, Badge, EmptyState, ErrorState, Skeleton...)
  billing/      TrialBanner, LimitBanner, UsageIndicator -- sempre alimentados
                 por session.billing ou por GET /billing/status, nunca por numero fixo
  layout/       AppLayout (sidebar + topbar + gate de paywall), navigation.ts

src/features/   Uma pasta por dominio. Cada uma tem sua(s) Page(s) e,
                quando aplicavel, um FormDrawer para criar/editar.
  auth/         session.tsx (contexto), guards.tsx (RequireAuth/Guest/Permission)
  landing/      Pagina publica
  pricing/      /planos -- publica e autenticada, mesmo componente
  onboarding/   Wizard de 6 passos
  dashboard/    Indicadores, grafico de receita, checklist de onboarding
  customers/    pets/  services/  appointments/  retention/  messages/  reports/
  billing/      BillingPage (/billing) e UpgradePage (/upgrade, paywall)
  equipe/       EquipePage -- casca fina sobre TeamSection (settings/TeamSection.tsx)
  settings/     Abas: Empresa, WhatsApp, Automacao, Aparencia

src/lib/
  api.ts        Cliente HTTP unico. Todo componente fala com a API por aqui.
  format.ts     Formatacao pt-BR (moeda, telefone, data, link do WhatsApp)
  cn.ts         Merge de classes Tailwind
```

## Rotas

Definidas em `src/router.tsx`. `/` e a landing publica -- o painel autenticado
vive em `/painel` (nao em `/`), porque a Fase 2 introduziu a landing como porta
de entrada do produto.

| Rota | Guarda | Observacao |
|------|--------|------------|
| `/` | publica | Landing |
| `/planos` | publica (com CTA contextual se logado) | Pricing |
| `/entrar`, `/criar-conta`, `/esqueci-senha` | `RequireGuest` | Redireciona quem ja esta logado |
| `/redefinir-senha` | nenhuma | Alguem logado pode precisar usar o link do email |
| `/onboarding` | `RequireAuth`, fora do `AppLayout` | Tela cheia, sem sidebar |
| `/upgrade` | `RequireAuth`, fora do `AppLayout` | Paywall, tela cheia |
| `/painel`, `/agenda`, `/clientes(/:id)`, `/pets(/:id)`, `/servicos`, `/recuperacao`, `/mensagens`, `/relatorios`, `/equipe`, `/billing`, `/configuracoes` | `RequireAuth` + `AppLayout` + `RequirePermission` por rota | Sidebar completa |

`AppLayout` tem um segundo gate, independente do `RequirePermission`: se
`session.billing.access.blocked`, qualquer rota fora de `/billing`,
`/configuracoes` ou `/upgrade` redireciona para `/upgrade`. Ver
`ALLOWED_WHEN_BLOCKED` em `AppLayout.tsx`. Isso e conveniencia de navegacao --
o bloqueio real esta em `assertActiveAccess()` no backend.

## Estado do servidor: TanStack Query

Sem Redux, sem Zustand. Todo dado do backend passa por `useQuery`/`useMutation`.
Convencoes:

- Chave de query = `['dominio', 'operacao', ...parametros]`, ex.:
  `['customers', 'list', { search, page }]`, `['billing', 'status']`.
- Toda mutacao que muda um recurso invalida as chaves relacionadas -- inclusive
  `['billing']` e `['session']` quando a acao consome uma cota do plano (criar
  cliente, pet, servico, agendamento, usuario). E assim que o `UsageIndicator`
  fica atualizado sem um refresh manual.
- `placeholderData: (previous) => previous` nas listas paginadas, para a troca
  de pagina nao mostrar um flash de skeleton.

## Sessao (`features/auth/session.tsx`)

`GET /api/auth/me` e a UNICA chamada de bootstrap: devolve usuario, marca do
tenant (white-label), permissoes e o `billing` completo (plano, assinatura, uso,
trial, bloqueio) numa unica resposta. `SessionProvider` disponibiliza:

- `session` -- `null` enquanto nao autenticado;
- `can(permission)` / `canAny([...])` -- consultam a mesma matriz RBAC do
  backend (`packages/contracts/src/rbac.ts`), para o menu e os botoes
  refletirem exatamente o que o backend vai aceitar;
- `refresh()` -- invalida a sessao (chamado apos qualquer PATCH em
  `/tenants/current`, por exemplo, para o white-label atualizar na hora).

A cor da marca (`--color-brand`) e sobrescrita em `document.documentElement` a
partir de `session.tenant.primaryColor` -- e assim que o white-label repinta o
app inteiro via `color-mix()`, sem tocar em nenhum componente individual.

## Formularios

Sem biblioteca de formularios: `<form>` nativo + `FormData` + `useMutation`.
Erros de campo vem do backend (`ApiError.fieldError(nome)`) e aparecem embaixo
do input correspondente; erros gerais viram toast. Nenhum formulario valida
"para valer" no frontend -- a validacao do Zod no backend e a que conta; o
frontend so evita um round-trip obvio (`required`, `type="email"`, etc.).

## Padrao de tela com lista

Toda `XxxListPage.tsx` segue a mesma forma: busca (opcional) + `LimitBanner`
(quando o recurso tem limite de plano) + `Card` com tabela desktop/lista mobile
+ `EmptyState` + `ErrorState` + `Skeleton` durante carregamento + `Pagination`.
Criacao abre um `Drawer` (`XxxFormDrawer.tsx`), nunca navega para outra pagina.

## Componentes de billing

- `TrialBanner` -- barra global no topo do `AppLayout`. So aparece quando ha algo
  a dizer (bloqueado, `PAST_DUE`, `CANCELLED` com data, ou trial ativo). Um
  plano PRO ativo e saudavel nao gera nenhum ruido visual.
- `LimitBanner` -- aviso persistente acima de uma lista, a partir de 80% de uso.
  Diferente de um toast: fica visivel ANTES da pessoa tentar criar o proximo
  registro.
- `UsageIndicator` -- barra "usado/limite" usada na pagina de Billing.

Todos os tres recebem o numero pronto do backend (`UsageEntry { used, limit }`);
nenhum componente calcula ou hardcoda um limite.

## Design system

Ver `src/styles/index.css`. Tokens CSS (`--color-*`, `--radius-*`, `--shadow-*`)
sao a unica fonte de cor/espacamento -- nenhum valor solto no meio de uma
classe Tailwind, exceto onde o proprio Tailwind ja e o token (`p-4`, `gap-2`).

As cores das series de grafico (`--color-chart-1/2`) sao **independentes** de
`--color-brand`: se herdassem a cor do tenant, um pet shop com marca clara teria
grafico ilegivel. O par foi validado por `dataviz`/`validate_palette.js`
(separacao OKLab 27.7 sob protanopia; minimo aceitavel e 8).

## Testes

`apps/web` usa Vitest + Testing Library (config separada em
`vitest.config.ts`, distinta do `vite.config.ts` de build). Cobre logica pura
(`lib/format.ts`, `lib/api.ts`) e componentes isolados (`TrialBanner`,
`LimitBanner`) com dados construidos a mao -- sem mock de rede em componentes
que dependem de React Query (isso exigiria MSW, fora do escopo desta fase).

**Nao ha E2E de navegador (Playwright/Cypress) nesta fase.** Os fluxos completos
de ponta a ponta (cadastro -> trial -> onboarding -> agendamento -> paywall)
foram verificados manualmente via chamadas HTTP diretas contra a API real
durante o desenvolvimento (documentado nas notas da Fase 2), e cada endpoint
que essas telas consomem tem cobertura de integracao no backend. Adicionar
Playwright e um investimento real (instalacao de navegador, fixtures de
usuario) que vale a pena declarar como proximo passo, nao fingir que existe.

## Performance

- Todas as listas sao paginadas no backend (`pageSize` maximo 100); nenhuma tela
  carrega "tudo".
- `select`/`join` no backend evita N+1 (ex.: `AppointmentDetailDto` ja vem com
  nome do cliente/pet/servico numa unica consulta).
- O bundle de producao esta em ~176 kB gzip. `packages/contracts` exporta os
  schemas Zod junto com os tipos, e o frontend carrega zod inteiro -- aceitavel
  agora (as validacoes de formulario reaproveitam esses mesmos schemas), mas e
  o primeiro lugar a olhar se o tamanho do bundle virar problema.
