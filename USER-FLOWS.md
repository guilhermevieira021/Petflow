# Fluxos de usuario

Cada fluxo abaixo foi verificado manualmente contra o backend real (chamadas
HTTP diretas, sem mock) durante o desenvolvimento da Fase 2. As rotas de
frontend citadas existem e chamam exatamente os endpoints descritos.

## 1. Visitante conhece o produto

```
GET /                          Landing publica
  -> "Comecar gratuitamente"   /criar-conta
  -> "Ver planos"               /planos (GET /api/plans, sem sessao)
```

Nenhum numero de cliente, depoimento ou logo de empresa aparece na landing --
o produto e novo e nao ha prova social real (ver PRODUCT.md).

## 2. Cadastro e inicio do trial

```
POST /criar-conta
  -> POST /api/auth/register
       cria, na MESMA transacao: tenant + usuario OWNER + assinatura TRIALING
       (trialEndsAt = agora + 48h, conforme plans.trial_hours)
  -> cookie de sessao definido
  -> navega para /onboarding (NAO para /painel -- ver RegisterPage.tsx)
```

Verificado via curl: `subscription.status = "TRIALING"`, `trial.hoursRemaining = 48`
imediatamente apos o registro.

## 3. Onboarding (skippable em cada passo)

```
/onboarding
  1. Dados do pet shop       PATCH /api/tenants/current
  2. Primeiro servico        POST  /api/services
  3. Horario de funcionamento PATCH /api/tenants/current (settings.businessHours)
  4. Primeiro cliente        POST  /api/customers
  5. Primeiro pet            POST  /api/pets       (exige cliente do passo 4)
  6. Primeiro agendamento    POST  /api/appointments (exige 2, 4 e 5)
  -> "Agendar e concluir" ou "Ir direto ao painel" -> /painel
```

Pular um passo nao trava os seguintes -- so desabilita os campos que dependem
dele, com uma explicacao visivel no proprio passo.

## 4. Primeiro valor: cliente -> pet -> servico -> agendamento

Fora do onboarding, o mesmo caminho existe a qualquer momento:

```
/clientes -> "Novo cliente" (Drawer) -> POST /api/customers
/clientes/:id -> "Adicionar pet" (Drawer) -> POST /api/pets
/servicos -> "Novo servico" (Drawer) -> POST /api/services
/agenda -> "Novo agendamento" (Drawer) -> POST /api/appointments
```

O drawer de agendamento busca os pets do cliente selecionado
(`GET /api/pets?customerId=`), preenche duracao/preco a partir do servico
escolhido, e trata `409 TIME_SLOT_TAKEN` com a mensagem "Esse horario ja esta
ocupado. Escolha outro horario." -- sem nunca assumir que o horario ficou livre
so porque o frontend nao percebeu o conflito.

## 5. Ciclo do atendimento

```
SCHEDULED -> CONFIRMED -> IN_PROGRESS -> COMPLETED
     \-> CANCELLED          \-> CANCELLED
     \-> NO_SHOW        (NO_SHOW so a partir de SCHEDULED/CONFIRMED)
```

Cada transicao passa por `PATCH /api/appointments/:id/status`, que valida a
maquina de estados (`canTransition`) e devolve `409 INVALID_STATUS_TRANSITION`
para uma transicao fora da ordem -- ex.: `SCHEDULED -> COMPLETED` direto e
recusado, mesmo pela API, mesmo sem passar pela UI.

## 6. Recuperacao de clientes

```
/recuperacao
  GET /api/retention?days=45   (ou o padrao configurado em settings.inactiveCustomerDays)
  -> "Enviar mensagem" (Drawer com texto sugerido, editavel)
  -> abre wa.me/<numero>?text=<mensagem>   (o USUARIO confirma o envio)
  -> POST /api/messages                    (registra o que foi preparado)
```

Nao ha envio automatico. O registro de mensagem nasce com status
`OPENED_EXTERNALLY` -- honesto sobre nao haver confirmacao de entrega possivel
no modo `WHATSAPP_PROVIDER=link`.

## 7. Uso do plano e limite atingido

```
Qualquer tela de lista (clientes, pets, servicos, agenda, equipe)
  -> LimitBanner aparece a partir de 80% de uso
  -> no limite: banner vermelho + "Voce atingiu o limite de N <recurso>..."
  -> tentativa de criar mesmo assim -> 409 LIMIT_REACHED do backend
  -> toast com a mensagem exata do backend
```

Verificado via curl criando 10 clientes (sucesso) e um 11o (rejeitado com
`LIMIT_REACHED`) num tenant TRIAL fresco.

## 8. Trial vencido -> paywall -> upgrade

```
48h depois do cadastro (ou de imediato, se trialEndsAt for forcado no banco)
  GET /api/auth/me  ->  billing.access.blocked = true, reason = "TRIAL_EXPIRED"
  -> AppLayout redireciona qualquer rota fora de /billing, /configuracoes
     e /upgrade para /upgrade
  -> /upgrade mostra: motivo, preco do PRO (vindo de GET /api/plans),
     beneficios, "seus dados continuam salvos"
  -> "Assinar PRO" -> POST /api/billing/checkout { planCode: "PRO" }
     -> sem provider real: { checkoutUrl: null, message: "..." } (honesto)
     -> com CaktoProvider: redireciona para o link de checkout da Cakto
  -> marca "checkout iniciado" no sessionStorage (lib/checkout.ts) antes de sair
  -> pagamento na Cakto -> webhook -> POST /api/webhooks/cakto
     -> hoje: 503 (autenticacao/eventos/correlacao de tenant ainda pendentes,
        ver CAKTO.md); quando configurado: subscriptions.status = ACTIVE, plan = PRO
  -> pessoa volta para /billing ou /upgrade -> ve "Estamos confirmando seu
     pagamento..." (nunca libera o PRO so por ter voltado) -> consulta
     GET /billing/status em intervalos curtos, por tempo limitado
  -> proximo GET /billing/status reflete PRO ativo; paywall some
```

Verificado via curl: forcar `trialEndsAt` no passado produz
`access.blocked = true`; uma tentativa de `POST /api/customers` nesse estado
devolve `403 SUBSCRIPTION_REQUIRED`; `GET /api/dashboard/overview` continua
funcionando (leitura nunca e bloqueada).

## 9. Papeis e o que cada um alcanca

| Acao | STAFF | ADMIN | OWNER |
|------|:---:|:---:|:---:|
| Atender (clientes, pets, agenda, mensagens) | sim | sim | sim |
| Excluir/desativar cliente ou pet | nao | sim | sim |
| Servicos, relatorios | leitura | leitura e escrita | leitura e escrita |
| Configuracoes | nao ve | nao ve | sim |
| Equipe, Billing | nao ve | nao ve | sim |

O menu lateral ja esconde os itens sem permissao (`can()` em `useSession()`).
Chamar a API diretamente para uma dessas acoes, sem passar pela UI, devolve
`403 INSUFFICIENT_PERMISSION` de qualquer forma -- comprovado pelos testes de
`rbac.test.ts` no backend.

## 10. Isolamento entre pet shops

O seed de desenvolvimento cria dois tenants (`owner@demo.com`, PRO ativo;
`owner@mundoanimal.com`, TRIAL a poucas horas do fim) exatamente para este
teste manual: entrar com um, depois com o outro, e confirmar que nenhum
cliente, pet, agendamento ou numero de uso vaza entre eles -- inclusive a cor
da marca, que muda de azul para verde. A garantia real esta no banco (Row
Level Security, ver SECURITY.md); o frontend apenas nunca teria como pedir o
dado errado, porque o tenant vem sempre da sessao.
