import {
  connectWhatsappEmbeddedInputSchema,
  connectWhatsappManualInputSchema,
  createMessageInputSchema,
  idParamSchema,
  listMessagesQuerySchema,
  listRemindersQuerySchema,
  messageTemplateTypeSchema,
  Permission,
  processRemindersInputSchema,
  sendMessageInputSchema,
  upsertMessageTemplateInputSchema,
  type SendMessageResultDto,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import { createMessage, listMessages } from '../../modules/messages/messages.service.js';
import {
  connectManually,
  connectWithEmbeddedSignup,
  disconnect,
  getConnection,
  getSetup,
  getTenantWhatsappProvider,
  resolveTenantWhatsappProvider,
  testConnection,
} from '../../modules/messages/whatsapp-connection.service.js';
import {
  getReminderSchedulerStatus,
  listReminders,
  processDueReminders,
} from '../../modules/messages/reminders.service.js';
import {
  createCustomTemplate,
  deleteCustomTemplate,
  dispatchQueuedMessages,
  getMessage,
  getWhatsappStatus,
  listTemplates,
  previewMessage,
  registerMessage,
  resetAutomaticTemplate,
  updateCustomTemplate,
  upsertAutomaticTemplate,
} from '../../modules/messages/whatsapp.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

const templateTypeParamSchema = z.object({ type: messageTemplateTypeSchema });

export async function messagesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listMessagesQuerySchema, request.query);
    const result = await withTenant(auth.context.tenantId, (tx) => listMessages(tx, auth.context, query));
    return reply.send(result);
  });

  /** Registro de envio MANUAL (link wa.me aberto pelo usuario). */
  app.post('/', { preHandler: requirePermission(Permission.MESSAGES_SEND) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(createMessageInputSchema, request.body);
    const message = await withTenant(auth.context.tenantId, (tx) => createMessage(tx, auth.context, input));
    return reply.status(201).send(message);
  });

  app.get('/whatsapp/status', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(
      await withTenant(auth.context.tenantId, async (tx) => getWhatsappStatus(tx, auth.context, await getTenantWhatsappProvider(tx, auth.context.tenantId))),
    );
  });

  app.post('/preview', { preHandler: requirePermission(Permission.MESSAGES_SEND) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(sendMessageInputSchema, request.body);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => previewMessage(tx, auth.context, input)));
  });

  /**
   * Envio pelo sistema. Registra na transacao; se houver API conectada,
   * despacha apos o commit e devolve o status REAL. Sem API, a resposta diz
   * explicitamente que a mensagem NAO foi enviada.
   */
  app.post('/send', { preHandler: requirePermission(Permission.MESSAGES_SEND) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(sendMessageInputSchema, request.body);
    const provider = await resolveTenantWhatsappProvider(auth.context.tenantId);

    const registered = await withTenant(auth.context.tenantId, (tx) =>
      registerMessage(tx, auth.context, input, provider),
    );
    await dispatchQueuedMessages(auth.context, [registered.messageId], provider);
    const message = await withTenant(auth.context.tenantId, (tx) => getMessage(tx, auth.context, registered.messageId));

    const delivered = message.status === 'SENT';
    const notice = delivered
      ? 'Mensagem enviada pela API do WhatsApp.'
      : provider.configured
        ? `A API do WhatsApp recusou o envio: ${message.failureReason ?? 'motivo nao informado'}.`
        : 'WhatsApp nao conectado: a mensagem foi registrada, mas NAO foi enviada. Use o link para enviar pelo seu WhatsApp.';
    const result: SendMessageResultDto = {
      message,
      delivered,
      content: registered.content,
      manualLink: delivered ? null : `https://wa.me/${registered.recipient}?text=${encodeURIComponent(registered.content)}`,
      notice,
    };
    return reply.status(201).send(result);
  });

  // Conexao do WhatsApp Business DESTE pet shop (API oficial da Meta).
  // Leitura: qualquer um que ve mensagens. Conectar/testar/desconectar: quem
  // altera configuracoes (proprietario). O token nunca sai do servidor.
  app.get('/whatsapp/connection', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getConnection(tx, auth.context)));
  });

  app.get('/whatsapp/setup', { preHandler: requirePermission(Permission.SETTINGS_READ) }, async (_request, reply) =>
    reply.send(getSetup()),
  );

  app.post('/whatsapp/connection/embedded', { preHandler: requirePermission(Permission.SETTINGS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(connectWhatsappEmbeddedInputSchema, request.body);
    return reply.status(201).send(await connectWithEmbeddedSignup(auth.context, input));
  });

  app.post('/whatsapp/connection/manual', { preHandler: requirePermission(Permission.SETTINGS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(connectWhatsappManualInputSchema, request.body);
    return reply.status(201).send(await connectManually(auth.context, input));
  });

  app.post('/whatsapp/connection/test', { preHandler: requirePermission(Permission.SETTINGS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await testConnection(auth.context));
  });

  app.delete('/whatsapp/connection', { preHandler: requirePermission(Permission.SETTINGS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => disconnect(tx, auth.context)));
  });

  // Lembretes: listagem da fila e processamento manual dos vencidos.
  app.get('/reminders', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listRemindersQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listReminders(tx, auth.context, query)));
  });

  app.get('/reminders/status', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => getReminderSchedulerStatus(tx, auth.context)));
  });

  app.post('/reminders/process', { preHandler: requirePermission(Permission.MESSAGES_SEND) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(processRemindersInputSchema, request.body ?? {});
    return reply.send(await processDueReminders(auth.context, { ...input, trigger: 'manual' }, await resolveTenantWhatsappProvider(auth.context.tenantId)));
  });

  app.get('/templates', { preHandler: requirePermission(Permission.MESSAGES_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listTemplates(tx, auth.context)));
  });

  app.put(
    '/templates/type/:type',
    { preHandler: requirePermission(Permission.MESSAGE_TEMPLATES_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { type } = validate(templateTypeParamSchema, request.params);
      const input = validate(upsertMessageTemplateInputSchema, request.body);
      return reply.send(
        await withTenant(auth.context.tenantId, (tx) => upsertAutomaticTemplate(tx, auth.context, type, input)),
      );
    },
  );

  app.delete(
    '/templates/type/:type',
    { preHandler: requirePermission(Permission.MESSAGE_TEMPLATES_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { type } = validate(templateTypeParamSchema, request.params);
      await withTenant(auth.context.tenantId, (tx) => resetAutomaticTemplate(tx, auth.context, type));
      return reply.status(204).send();
    },
  );

  app.post('/templates', { preHandler: requirePermission(Permission.MESSAGE_TEMPLATES_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const input = validate(upsertMessageTemplateInputSchema, request.body);
    const template = await withTenant(auth.context.tenantId, (tx) => createCustomTemplate(tx, auth.context, input));
    return reply.status(201).send(template);
  });

  app.patch(
    '/templates/:id',
    { preHandler: requirePermission(Permission.MESSAGE_TEMPLATES_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(upsertMessageTemplateInputSchema, request.body);
      return reply.send(
        await withTenant(auth.context.tenantId, (tx) => updateCustomTemplate(tx, auth.context, id, input)),
      );
    },
  );

  app.delete(
    '/templates/:id',
    { preHandler: requirePermission(Permission.MESSAGE_TEMPLATES_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      await withTenant(auth.context.tenantId, (tx) => deleteCustomTemplate(tx, auth.context, id));
      return reply.status(204).send();
    },
  );
}
