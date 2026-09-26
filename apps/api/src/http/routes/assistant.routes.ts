import {
  askAssistantInputSchema,
  hasPermission,
  Permission,
  runAssistantToolParamsSchema,
  type AssistantAskResultDto,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../../core/errors.js';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  chooseToolForQuestion,
  findAssistantTool,
  getAssistantStatus,
  listAssistantTools,
  runAssistantTool,
  unmatchedAnswer,
} from '../../modules/assistant/assistant.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/** /api/assistant -- consultas deterministicas + pergunta livre opcional. */
export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requirePermission(Permission.ASSISTANT_USE) };

  app.get('/status', guard, async (_request, reply) => reply.send(getAssistantStatus()));

  app.get('/tools', guard, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(listAssistantTools((permission) => hasPermission(auth.user.role, permission)));
  });

  app.post('/tools/:name', guard, async (request, reply) => {
    const auth = currentAuth(request);
    const { name } = validate(runAssistantToolParamsSchema, request.params);
    const tool = findAssistantTool(name);
    if (!hasPermission(auth.user.role, tool.permission)) throw new ForbiddenError();
    return reply.send(await withTenant(auth.context.tenantId, (tx) => runAssistantTool(tx, auth.context, tool)));
  });

  // Rate limit proprio: cada chamada pode custar uma requisicao ao provider.
  app.post('/ask', { ...guard, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const auth = currentAuth(request);
    const { question } = validate(askAssistantInputSchema, request.body);
    const tools = listAssistantTools((permission) => hasPermission(auth.user.role, permission));
    const chosen = await chooseToolForQuestion(question, tools);
    if (!chosen) return reply.send(unmatchedAnswer());
    const tool = findAssistantTool(chosen);
    const result = await withTenant(auth.context.tenantId, (tx) => runAssistantTool(tx, auth.context, tool));
    const body: AssistantAskResultDto = { matched: true, result, message: result.answer };
    return reply.send(body);
  });
}
