# Fase 1 — o que foi entregue

Escopo previsto no briefing: *setup, arquitetura, banco, migrations, autenticacao,
multi-tenancy, usuarios, permissoes, seed, layout base, dashboard inicial.*

## Verificacao

| Passo | Resultado |
|-------|-----------|
| `npm run lint` | Sem avisos |
| `npm run typecheck` | Sem erros (contracts + api + web, TypeScript strict) |
| `npm test` | 65 testes, 4 arquivos, todos passando |
| `npm run build` | Os tres pacotes compilam |
| Verificacao manual em HTTP | Login, `/me`, dashboard, isolamento e RBAC conferidos com a API no ar |

## Infraestrutura

- Monorepo npm workspaces: `packages/contracts`, `apps/api`, `apps/web`
- TypeScript strict em todos os pacotes, com `noUncheckedIndexedAccess`
- ESLint 9 (flat config), com `no-explicit-any` como erro
- `.env.example` documentado por categoria; `.env` no `.gitignore`

## Banco

- 13 tabelas com o modelo completo do briefing -- inclusive as das fases 2 a 4,
  para que os indices e as FKs nascam corretos desde o inicio
- Migrations em SQL versionado, aplicadas por migrador proprio e transacional
- Indices para todos os acessos previstos, incluindo um indice **parcial** de
  conflito de agenda que cobre apenas os status que ocupam horario
- FKs **compostas com `tenant_id`** em toda relacao de negocio
- `ON DELETE` decidido caso a caso: `CASCADE` so onde o filho nao faz sentido sem o
  pai; `RESTRICT` para historico operacional
- Soft delete (`deleted_at` + `active`) nas entidades com historico

## Multi-tenancy

Tres camadas independentes, descritas em [ARCHITECTURE.md](../ARCHITECTURE.md).
A terceira e Row Level Security no PostgreSQL, com duas roles dedicadas e uma
funcao `app_current_tenant()` que **falha fechado** quando o contexto esta ausente.

Provado por teste, nao apenas afirmado:

```
uma consulta de clientes SEM filtro de tenant ainda assim nao vaza
uma consulta de pets SEM filtro de tenant ainda assim nao vaza
uma consulta de servicos SEM filtro de tenant ainda assim nao vaza
uma consulta de agendamentos SEM filtro de tenant ainda assim nao vaza
inserir registro marcado com o tenant alheio e rejeitado pelo banco
atualizar registro do outro tenant nao afeta nenhuma linha
excluir registro do outro tenant nao afeta nenhuma linha
o banco recusa um pet ligado ao cliente de outro tenant
o banco recusa um agendamento com servico de outro tenant
o tenant da transacao e obrigatorio: sem ele, nada e visivel
```

## Autenticacao

Cadastro publico (cria tenant + OWNER atomicamente), login, logout, `/me`,
recuperacao e troca de senha. Sessao opaca em cookie `httpOnly`, guardada hasheada,
com expiracao deslizante e revogacao imediata. CSRF por double submit. Senhas em
scrypt. Anti-enumeracao no login e no `forgot-password`.

## Autorizacao

Matriz RBAC unica em `packages/contracts/src/rbac.ts`, com 25 permissoes e 3
papeis, compartilhada entre backend e frontend. A decisao que vale e a do backend;
os testes chamam a API diretamente para provar isso.

Travas contra escalonamento: ninguem gerencia papel superior ao seu, ninguem altera
o proprio papel, ninguem se desativa ou se exclui, e o pet shop nunca fica sem
OWNER ativo.

## Interface

Design system com tokens centralizados (cores, tipografia, raios, sombras,
medidas). Nenhum valor solto no codigo. Layout com sidebar fixa no desktop e drawer
no mobile, testado de 320px a 1440px.

White-label funcionando: nome, logo e cor principal do tenant sao aplicados em
tempo de execucao. Trocar `--color-brand` repinta o app inteiro de forma coerente,
porque os tons derivados saem dela por `color-mix`.

Telas prontas: login, cadastro, recuperacao e redefinicao de senha, dashboard e
configuracoes (empresa, equipe, automacao, aparencia).

Estados cobertos em todas elas: carregamento com skeleton de mesma geometria,
vazio com acao, erro com opcao de repetir, toast de sucesso e falha, e confirmacao
antes de acao destrutiva.

Acessibilidade: labels conectados, `aria-invalid` e `role="alert"` nos erros, foco
visivel, link "pular para o conteudo", dialogo modal sobre o `<dialog>` nativo,
e `prefers-reduced-motion` respeitado.

## Dashboard

Indicadores do dia (total, confirmados, concluidos, cancelados, faltas, previsto,
recebido), metricas de clientes (total, novos no mes, inativos), retornos
pendentes, proximos 8 atendimentos com atalho para o WhatsApp, e grafico de receita
de 14 dias.

O grafico segue o metodo de visualizacao: um unico eixo, paleta validada
(separacao OKLab 27,7 sob protanopia; minimo aceitavel e 8), legenda sempre
presente, tooltip com crosshair, dias sem movimento preenchidos com zero, e tabela
equivalente para leitor de tela.

## Seed

Dois pet shops ficticios, seis usuarios, 12 servicos, 18 clientes, 30 pets, ~318
agendamentos e ~200 pagamentos. Gerador com semente fixa: rodar duas vezes produz a
mesma agenda.

## O que NAO foi feito nesta fase

Dito claramente para nao virar promessa implicita:

- **Clientes, pets, servicos e agenda** — o schema, os indices e os contratos Zod
  existem; os endpoints e as telas sao das fases 2 e 3. Os itens correspondentes no
  menu aparecem marcados como "Em breve", com a descricao do que vao entregar.
- **Envio de WhatsApp** — nenhuma mensagem e enviada. A interface gera links
  `wa.me` com o texto pronto.
- **Envio de email** — `MAIL_PROVIDER=console` escreve o link de recuperacao no log
  do servidor.
- **Cobranca** — nao existe integracao de pagamento.
- **Testes de interface** — a suite cobre a API. Testes de componente entram na
  fase 5.

## Pendencias tecnicas registradas

1. **Bundle de 522 kB** (156 kB gzip). O `packages/contracts` exporta os schemas
   Zod junto com os tipos, e o frontend carrega zod inteiro. Aceitavel agora --
   as validacoes de formulario da fase 2 vao usar esses mesmos schemas --, mas
   vale separar os exports se a fase 5 exigir corte.
2. **`withSystem` sem imposicao tecnica.** A restricao de uso e por documentacao e
   revisao. Uma regra de lint customizada resolveria.
3. **Sem bloqueio de conta por tentativas.** Ha rate limit por rota; contador por
   conta fica para a fase 5.
4. **Testes de conflito de agenda** (itens 6 e 7 do §23 do briefing) dependem dos
   endpoints da fase 3. O advisory lock e a maquina de estados ja estao
   implementados em `db/context.ts` e `contracts/appointment.ts`.

## Proximo passo — Fase 2

Clientes, pets e servicos: endpoints com paginacao, busca e filtros; validacao de
propriedade cruzada (o pet pertence ao cliente, o cliente pertence ao tenant);
telas de listagem, cadastro e perfil; e os testes de isolamento correspondentes
agora em nivel HTTP.
