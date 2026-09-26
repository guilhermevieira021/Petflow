import type { AssistantToolName } from '@petflow/contracts';
import { env } from '../../config/env.js';

/**
 * Provider de linguagem do assistente.
 *
 * O contrato e deliberadamente estreito: o modelo recebe a pergunta e a lista
 * de consultas disponiveis e devolve SO o nome de uma consulta (ou nenhuma).
 * Ele nunca ve dados do pet shop e nunca produz numeros -- a resposta exibida
 * e montada pelo servidor a partir do resultado da consulta. Isso torna
 * impossivel, por construcao, o modelo inventar valores ou vazar dados de
 * outro tenant.
 */

export interface ToolChoiceCandidate {
  name: AssistantToolName;
  question: string;
  description: string;
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly kind: 'none' | 'anthropic';
  readonly configured: boolean;
  /** Nome da consulta que responde a pergunta, ou null se nenhuma serve. */
  chooseTool(question: string, tools: readonly ToolChoiceCandidate[]): Promise<AssistantToolName | null>;
}

class NoProvider implements AiProvider {
  readonly kind = 'none' as const;
  readonly configured = false;

  async chooseTool(): Promise<AssistantToolName | null> {
    throw new AiProviderError('Nenhum provider de IA configurado no servidor.');
  }
}

/** Messages API da Anthropic com tool use: cada consulta vira uma "tool" sem parametros. */
export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const;
  readonly configured = true;

  constructor(
    private readonly config: { apiKey: string; model: string; apiUrl?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chooseTool(question: string, tools: readonly ToolChoiceCandidate[]): Promise<AssistantToolName | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.apiUrl ?? 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 256,
          system:
            'Voce escolhe qual consulta do sistema de um pet shop responde a pergunta do usuario. ' +
            'Use exatamente uma ferramenta se alguma servir. Se nenhuma servir, responda apenas "nenhuma". ' +
            'Nunca responda a pergunta voce mesmo.',
          tools: tools.map((tool) => ({
            name: tool.name,
            description: `${tool.question} ${tool.description}`,
            input_schema: { type: 'object', properties: {} },
          })),
          tool_choice: { type: 'auto' },
          messages: [{ role: 'user', content: question }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AiProviderError('Nao foi possivel falar com o provider de IA.');
    }
    if (!response.ok) {
      // Nunca repassa o corpo: pode conter detalhes da conta.
      throw new AiProviderError(`Provider de IA respondeu com status ${response.status}.`);
    }
    const body = (await response.json().catch(() => null)) as { content?: { type: string; name?: string }[] } | null;
    const call = body?.content?.find((block) => block.type === 'tool_use');
    const chosen = tools.find((tool) => tool.name === call?.name);
    return chosen?.name ?? null;
  }
}

let override: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (override) return override;
  if (env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY) {
    return new AnthropicProvider({ apiKey: env.AI_API_KEY, model: env.AI_MODEL });
  }
  return new NoProvider();
}

/** Somente testes. */
export function setAiProviderForTests(provider: AiProvider | null): void {
  override = provider;
}
