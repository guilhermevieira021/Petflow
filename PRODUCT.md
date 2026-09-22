# Produto

## Proposta

"Ajude seu pet shop a organizar os atendimentos e fazer seus clientes voltarem."

O publico e o dono ou funcionario de um pet shop pequeno -- nao um administrador
de sistemas. Toda decisao de produto responde a uma pergunta: **isso ajuda a
adquirir, agendar, atender, receber, fazer o cliente voltar, recuperar um cliente
perdido, ou administrar a operacao?** Se a resposta e nao, a funcionalidade nao
entra.

## Modelo comercial

| | TRIAL | PRO |
|---|---|---|
| Duracao | 48 horas | Recorrente, R$ 99,90/mes |
| Cartao no cadastro | Nao | Sim, no checkout |
| Limites | 10 clientes, 15 pets, 10 agendamentos, 5 servicos, 2 usuarios | Ilimitado (exceto 10 usuarios) |
| Recursos avancados | Nao | Relatorios avancados, automacao, recuperacao sem limite de janela |

Detalhes tecnicos do ciclo de vida da assinatura e dos entitlements estao em
[BILLING.md](BILLING.md). Este documento e sobre a experiencia, nao sobre a
implementacao.

## O funil

```
Visitante (landing publica)
  -> Cadastro (48h de trial comecam no mesmo instante)
  -> Onboarding (6 passos, todos pulaveis, ate o primeiro agendamento)
  -> Uso diario (dashboard, agenda, clientes, pets)
  -> Aproximacao do limite ou do fim do trial (avisos contextuais, nunca surpresa)
  -> Upgrade (pricing -> checkout -> confirmacao via webhook)
```

## Ativacao

Um tenant e considerado "ativado" quando completou, na ordem natural de uso do
produto:

1. dados basicos da empresa (telefone/whatsapp);
2. pelo menos um servico;
3. pelo menos um cliente;
4. pelo menos um pet;
5. pelo menos um agendamento.

Isso e o mesmo criterio do checklist de onboarding (`OnboardingChecklist` no
dashboard) e do payload `onboarding.completed` em `GET /api/auth/me` --
**derivado do estado real do tenant**, nunca um booleano salvo. Se o dono apagar
todos os servicos, o passo volta a aparecer pendente sozinho. Nao existe uma
tabela de eventos de analytics separada: o proprio dado de negocio (existe
cliente? existe agendamento?) e a fonte de verdade sobre ativacao.

## Onboarding

Seis passos, todos com "Pular esta etapa": dados do pet shop, primeiro servico,
horario de funcionamento, primeiro cliente, primeiro pet, primeiro agendamento.
O objetivo e levar o dono do pet shop ao primeiro valor real (um agendamento na
agenda) no primeiro acesso, sem forcar nenhum passo -- alguem que ja sabe o que
quer fazer pode pular tudo e ir direto ao painel.

O passo do pet exige um cliente ja cadastrado; o passo do agendamento exige
servico + cliente + pet. Pular um deles nao trava o fluxo -- so desabilita os
campos do passo seguinte que dependem dele, com uma explicacao visivel.

## Retencao durante o trial

A comunicacao do estado do trial e sempre do backend, nunca calculada no
navegador (ver `TrialBanner`, alimentado por `session.billing`). Pontos de
contato:

- **Dashboard**: indicadores normais, mais o checklist de onboarding enquanto
  nao completo.
- **Barra global** (em toda pagina autenticada): countdown do trial, aviso de
  pagamento pendente, ou aviso de cancelamento agendado -- o que for relevante
  no momento.
- **Acima de 80% de um limite**: aviso amarelo persistente na propria tela do
  recurso (clientes, pets, servicos, agenda), nao um popup.
- **No limite**: aviso vermelho com o numero exato e link direto para os planos.
- **Trial vencido**: paywall (`/upgrade`), que explica o que aconteceu, mostra o
  preco do PRO vindo do backend, e reforca "seus dados continuam salvos".

Nao ha envio automatico de email ou WhatsApp quando o trial esta acabando --
essa infraestrutura nao existe nesta fase (ver `MAIL_PROVIDER=console` em
[SETUP.md](SETUP.md)) e nao seria honesto fingi-la.

## Upgrade contextual

Quando uma tela mostra um recurso do PRO que o tenant nao tem (relatorios
avancados, por exemplo), o bloqueio e um cartao explicando o beneficio e um
botao "Conhecer o PRO" -- nunca um espaco vazio nem um botao desabilitado sem
explicacao. Ver `UpgradeLockedCard` em `ReportsPage.tsx` como referencia do
padrao.

## O que o produto NAO faz (ainda)

Dito abertamente, para nao virar promessa implicita:

- **Nao envia WhatsApp de verdade.** Todo "envio" abre o WhatsApp do proprio
  usuario com o texto pronto; a pessoa confirma o envio. Nenhuma API oficial
  esta conectada.
- **Nao cobra de verdade.** O checkout, quando acionado, informa honestamente
  que nenhum gateway esta configurado nesta instalacao (ver BILLING.md).
- **Nao envia lembretes automaticos.** A infraestrutura de mensagens registra o
  que foi preparado e enviado manualmente; nao ha disparo agendado.
- **Nao tem app nativo.** E uma pagina web responsiva, pensada para funcionar
  bem no navegador do celular.
