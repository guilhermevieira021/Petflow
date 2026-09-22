import { createMessageInputSchema, listMessagesQuerySchema, Permission } from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { createMessage, listMessages } from '../../modules/messages/messages.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function messagesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listMessagesQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) => listMessages(tx, auth.context, query));
    return reply.send(result);
  });

  app.post('/', { preHandler: requirePermission(Permission.MESSAGES_SEND) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createMessageInputSchema, request.body);
    const message = await withTenant(auth.context.tenantId, (tx) => createMessage(tx, auth.context, input));
    return reply.status(201).send(message);
  });
}
