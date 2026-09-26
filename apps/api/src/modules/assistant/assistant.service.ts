import {
  AssistantToolName,
  listDueHealthQuerySchema,
  listProductsQuerySchema,
  Permission,
  PET_HEALTH_TYPE_LABELS,
  retentionQuerySchema,
  type AssistantAskResultDto,
  type AssistantStatusDto,
  type AssistantToolDto,
  type AssistantToolResultDto,
} from '@petflow/contracts';
import { and, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { shiftDate, todayInTimeZone, zonedTimeToUtc } from '../../core/datetime.js';
import { ServiceUnavailableError } from '../../core/errors.js';
import type { Transaction } from '../../db/client.js';
import type { TenantContext } from '../../db/context.js';
import { appointments } from '../../db/schema/index.js';
import { AiProviderError, getAiProvider } from '../../integrations/ai/ai.provider.js';
import { getOverview } from '../dashboard/dashboard.service.js';
import { listDueHealth } from '../health/health.service.js';
import { listProducts } from '../inventory/inventory.service.js';
import { listRetentionCandidates } from '../retention/retention.service.js';
import { getTenant } from '../tenants/tenants.service.js';

/**
 * Assistente do pet shop.
 *
 * Cada pergunta suportada e uma consulta deterministica sobre os dados REAIS
 * do tenant (sempre dentro de withTenant, com RLS). Os numeros e as linhas
 * vem do banco; o texto da resposta e montado aqui a partir deles. Nenhum
 * valor e estimado, arredondado "para parecer bom" ou produzido por modelo.
 */

interface ToolDefinition extends AssistantToolDto {
  /** Permissao exigida alem de ASSISTANT_USE: a consulta nao pode mostrar o que a tela equivalente esconderia. */
  permission: Permission;
  run(tx: Transaction, context: TenantContext): Promise<Omit<AssistantToolResultDto, 'tool' | 'question' | 'generatedAt'>>;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const EMPTIEST_WINDOW_DAYS = 28;
const LIST_LIMIT = 10;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: AssistantToolName.RECEIVED_THIS_WEEK,
    question: 'Quanto recebi esta semana?',
    description: 'Soma dos pagamentos de clientes recebidos na semana atual (domingo a sábado).',
    permission: Permission.PAYMENTS_READ,
    async run(tx, context) {
      // Mesma regra do "Recebido" do painel: pagamentos PAGOS de clientes
      // do pet shop. Assinatura do Petflow nao entra (tabelas separadas).
      const overview = await getOverview(tx, context);
      const { week } = overview;
      return {
        answer: `Nesta semana você recebeu ${money.format(week.receivedRevenue)}.`,
        rows: [
          { label: 'Recebido', value: money.format(week.receivedRevenue) },
          { label: 'Previsto em atendimentos', value: money.format(week.expectedRevenue) },
          { label: 'Perdido (cancelados e faltas)', value: money.format(week.lostRevenue) },
        ],
        basis: `Semana de ${formatDay(week.weekStart)} a ${formatDay(week.weekEnd)}, pagamentos com status Pago.`,
      };
    },
  },
  {
    name: AssistantToolName.INACTIVE_CUSTOMERS,
    question: 'Quais clientes sumiram?',
    description: 'Clientes já atendidos, sem agendamento futuro, cujo último atendimento passou do limite de inatividade.',
    permission: Permission.RETENTION_READ,
    async run(tx, context) {
      const tenant = await getTenant(tx, context);
      const days = tenant.settings.inactiveCustomerDays;
      const page = await listRetentionCandidates(tx, context, retentionQuerySchema.parse({ pageSize: LIST_LIMIT }));
      const total = page.pagination.total;
      return {
        answer:
          total === 0
            ? `Nenhum cliente está há mais de ${days} dias sem atendimento.`
            : `${plural(total, 'cliente está', 'clientes estão')} há mais de ${days} dias sem voltar.`,
        rows: page.data.map((entry) => ({
          label: entry.petNames.length > 0 ? `${entry.customerName} (${entry.petNames.join(', ')})` : entry.customerName,
          value: `${entry.daysSinceLastVisit} dias`,
          href: `/clientes/${entry.customerId}`,
        })),
        basis: `Limite de ${days} dias configurado em Automação.${total > LIST_LIMIT ? ` Mostrando os ${LIST_LIMIT} primeiros.` : ''}`,
      };
    },
  },
  {
    name: AssistantToolName.HEALTH_DUE,
    question: 'Quais pets estão com vacina ou vermífugo vencendo?',
    description: 'Vacinas, vermífugos e medicamentos vencidos ou vencendo nos próximos 30 dias.',
    permission: Permission.PETS_READ,
    async run(tx, context) {
      const items = await listDueHealth(tx, context, listDueHealthQuerySchema.parse({}));
      const overdue = items.filter((item) => item.dueStatus === 'OVERDUE').length;
      return {
        answer:
          items.length === 0
            ? 'Nenhuma vacina ou vermífugo vencido ou vencendo nos próximos 30 dias.'
            : `${plural(items.length, 'item', 'itens')} de saúde precisam de atenção (${plural(overdue, 'vencido', 'vencidos')}).`,
        rows: items.slice(0, LIST_LIMIT).map((item) => ({
          label: `${item.petName} · ${PET_HEALTH_TYPE_LABELS[item.type]}: ${item.title}`,
          value: item.dueStatus === 'OVERDUE' ? `venceu ${formatDay(item.nextDueOn)}` : `vence ${formatDay(item.nextDueOn)}`,
          href: `/pets/${item.petId}`,
        })),
        basis: `Registro mais recente de cada item no histórico de saúde dos pets ativos.${items.length > LIST_LIMIT ? ` Mostrando os ${LIST_LIMIT} primeiros.` : ''}`,
      };
    },
  },
  {
    name: AssistantToolName.EMPTIEST_HOURS,
    question: 'Quais horários ficam mais vazios?',
    description: 'Faixas de horário com menos atendimentos nas últimas 4 semanas, dentro do horário de funcionamento.',
    permission: Permission.APPOINTMENTS_READ,
    async run(tx, context) {
      const tenant = await getTenant(tx, context);
      const timeZone = tenant.timezone;
      const { businessHours } = tenant.settings;
      const today = todayInTimeZone(timeZone);
      const from = zonedTimeToUtc(shiftDate(today, -EMPTIEST_WINDOW_DAYS), '00:00', timeZone);
      const to = zonedTimeToUtc(today, '00:00', timeZone);

      const rows = await tx
        .select({
          weekday: sql<number>`extract(dow from ${appointments.startsAt} at time zone ${timeZone})::int`,
          hour: sql<number>`extract(hour from ${appointments.startsAt} at time zone ${timeZone})::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, context.tenantId),
            gte(appointments.startsAt, from),
            lt(appointments.startsAt, to),
            notInArray(appointments.status, ['CANCELLED']),
          ),
        )
        .groupBy(sql`1`, sql`2`);

      const counts = new Map(rows.map((row) => [`${Number(row.weekday)}-${Number(row.hour)}`, Number(row.total)]));
      const openHour = Number(businessHours.start.slice(0, 2));
      const closeHour = Number(businessHours.end.slice(0, 2)) + (businessHours.end.endsWith(':00') ? 0 : 1);
      const buckets: { weekday: number; hour: number; total: number }[] = [];
      for (const weekday of businessHours.weekdays) {
        for (let hour = openHour; hour < closeHour; hour += 1) {
          buckets.push({ weekday, hour, total: counts.get(`${weekday}-${hour}`) ?? 0 });
        }
      }
      const totalAppointments = rows.reduce((sum, row) => sum + Number(row.total), 0);
      buckets.sort((a, b) => a.total - b.total || a.weekday - b.weekday || a.hour - b.hour);
      const emptiest = buckets.slice(0, 5);
      const pad = (hour: number) => String(hour).padStart(2, '0');

      return {
        answer:
          totalAppointments === 0
            ? 'Ainda não há atendimentos nas últimas 4 semanas para comparar horários.'
            : `O horário mais vazio é ${WEEKDAY_NAMES[emptiest[0]?.weekday ?? 0]} das ${pad(emptiest[0]?.hour ?? 0)}h às ${pad((emptiest[0]?.hour ?? 0) + 1)}h.`,
        rows:
          totalAppointments === 0
            ? []
            : emptiest.map((bucket) => ({
                label: `${WEEKDAY_NAMES[bucket.weekday]}, ${pad(bucket.hour)}h–${pad(bucket.hour + 1)}h`,
                value: plural(bucket.total, 'atendimento', 'atendimentos'),
              })),
        basis: `${plural(totalAppointments, 'atendimento', 'atendimentos')} (exceto cancelados) de ${formatDay(shiftDate(today, -EMPTIEST_WINDOW_DAYS))} a ${formatDay(shiftDate(today, -1))}, dentro do horário de funcionamento.`,
      };
    },
  },
  {
    name: AssistantToolName.LOW_STOCK,
    question: 'Quais produtos estão com estoque baixo?',
    description: 'Produtos ativos com saldo igual ou abaixo do estoque mínimo.',
    permission: Permission.PRODUCTS_READ,
    async run(tx, context) {
      const page = await listProducts(
        tx,
        context,
        listProductsQuerySchema.parse({ lowStock: 'true', sort: 'stockQuantity', order: 'asc', pageSize: LIST_LIMIT }),
      );
      const total = page.pagination.total;
      const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
      return {
        answer:
          total === 0
            ? 'Nenhum produto está abaixo do estoque mínimo.'
            : `${plural(total, 'produto está', 'produtos estão')} com estoque baixo.`,
        rows: page.data.map((product) => ({
          label: product.name,
          value: `${quantity.format(product.stockQuantity)} ${product.unit} (mín. ${quantity.format(product.minStock)})`,
          href: `/produtos/${product.id}`,
        })),
        basis: `Produtos ativos com controle de estoque.${total > LIST_LIMIT ? ` Mostrando os ${LIST_LIMIT} com menor saldo.` : ''}`,
      };
    },
  },
];

function toDto(tool: ToolDefinition): AssistantToolDto {
  return { name: tool.name, question: tool.question, description: tool.description };
}

/** Consultas que este usuario pode rodar (cada uma exige a permissao da tela equivalente). */
export function listAssistantTools(allowed: (permission: Permission) => boolean): AssistantToolDto[] {
  return TOOLS.filter((tool) => allowed(tool.permission)).map(toDto);
}

export function findAssistantTool(name: AssistantToolName): ToolDefinition {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Consulta desconhecida: ${name}`);
  return tool;
}

export async function runAssistantTool(
  tx: Transaction,
  context: TenantContext,
  tool: ToolDefinition,
): Promise<AssistantToolResultDto> {
  const result = await tool.run(tx, context);
  return { tool: tool.name, question: tool.question, ...result, generatedAt: new Date().toISOString() };
}

export function getAssistantStatus(): AssistantStatusDto {
  const provider = getAiProvider();
  return {
    languageModelConfigured: provider.configured,
    provider: provider.kind,
    message: provider.configured
      ? 'Perguntas livres habilitadas. Os números sempre vêm direto dos seus dados.'
      : 'Perguntas livres ainda não estão disponíveis: nenhum provedor de IA foi configurado no servidor. As perguntas prontas funcionam normalmente.',
  };
}

/**
 * Pergunta livre: o provider SO escolhe a consulta (fora de transacao, sem
 * ver nenhum dado). A execucao acontece depois, pelo chamador, em withTenant.
 */
export async function chooseToolForQuestion(question: string, tools: AssistantToolDto[]): Promise<AssistantToolName | null> {
  const provider = getAiProvider();
  if (!provider.configured) {
    throw new ServiceUnavailableError(
      'Perguntas livres não estão disponíveis: nenhum provedor de IA foi configurado. Use as perguntas prontas.',
    );
  }
  try {
    return await provider.chooseTool(question, tools);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw new ServiceUnavailableError('O assistente não conseguiu interpretar a pergunta agora. Tente uma pergunta pronta.', {
        reason: error.message,
      });
    }
    throw error;
  }
}

export function unmatchedAnswer(): AssistantAskResultDto {
  return {
    matched: false,
    result: null,
    message: 'Ainda não sei responder essa pergunta com os seus dados. Tente uma das perguntas prontas.',
  };
}
