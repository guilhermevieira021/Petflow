import { z } from 'zod';

/**
 * Assistente do pet shop.
 *
 * REGRA CRITICA: nenhum numero sai de um modelo de linguagem. Cada pergunta
 * suportada e uma CONSULTA registrada no servidor (tool), executada com
 * withTenant sobre os dados reais do pet shop. Um provider de IA (quando
 * configurado) so pode ESCOLHER qual consulta rodar e REDIGIR a resposta a
 * partir do resultado -- nunca inventar ou calcular valores por conta propria.
 */

export const AssistantToolName = {
  RECEIVED_THIS_WEEK: 'received_this_week',
  INACTIVE_CUSTOMERS: 'inactive_customers',
  HEALTH_DUE: 'health_due',
  EMPTIEST_HOURS: 'emptiest_hours',
  LOW_STOCK: 'low_stock',
  SALES_TODAY: 'sales_today',
  TOP_PRODUCTS: 'top_products',
  STOCK_OVERVIEW: 'stock_overview',
  APPOINTMENTS_TOMORROW: 'appointments_tomorrow',
} as const;
export type AssistantToolName = (typeof AssistantToolName)[keyof typeof AssistantToolName];

export interface AssistantToolDto {
  name: AssistantToolName;
  /** Pergunta em linguagem natural que esta consulta responde. */
  question: string;
  description: string;
}

export const runAssistantToolParamsSchema = z.object({
  name: z.nativeEnum(AssistantToolName, { errorMap: () => ({ message: 'Consulta desconhecida.' }) }),
});

/** Resultado estruturado: o texto e montado a partir destes dados, nunca o contrario. */
export interface AssistantToolResultDto {
  tool: AssistantToolName;
  question: string;
  /** Resposta curta derivada deterministicamente de `data`. */
  answer: string;
  /** Linhas de detalhe (ex.: clientes, produtos). */
  rows: { label: string; value: string; href?: string }[];
  /** Periodo/criterio usado, para o usuario conferir. */
  basis: string;
  generatedAt: string;
}

export const askAssistantInputSchema = z
  .object({
    question: z.string().trim().min(3, 'Escreva a pergunta.').max(500),
  })
  .strict();
export type AskAssistantInput = z.infer<typeof askAssistantInputSchema>;

export interface AssistantStatusDto {
  /** Provider de linguagem configurado no servidor (perguntas livres). */
  languageModelConfigured: boolean;
  provider: 'none' | 'openai' | 'anthropic';
  message: string;
}

export interface AssistantAskResultDto {
  /** false = nenhuma consulta disponivel responde a pergunta. */
  matched: boolean;
  result: AssistantToolResultDto | null;
  message: string;
}
