import {
  changeAppointmentStatusInputSchema,
  createAppointmentInputSchema,
  hasPermission,
  idParamSchema,
  listAppointmentsQuerySchema,
  Permission,
  updateAppointmentInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../../core/errors.js';
import { validate } from '../../core/validation.js';
import { withTenant } from '../../db/context.js';
import {
  changeAppointmentStatus,
  createAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
} from '../../modules/appointments/appointments.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

export async function appointmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: requirePermission(Permission.APPOINTMENTS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const query = validate(listAppointmentsQuerySchema, request.query);
      const result = await withTenant(auth.context.tenantId, (tx) =>
        listAppointments(tx, auth.context, query),
      );
      return reply.send(result);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.APPOINTMENTS_READ) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const appointment = await withTenant(auth.context.tenantId, (tx) => getAppointment(tx, auth.context, id));
      return reply.send(appointment);
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.APPOINTMENTS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const input = validate(createAppointmentInputSchema, request.body);
      const appointment = await withTenant(auth.context.tenantId, (tx) =>
        createAppointment(tx, auth.context, input),
      );
      return reply.status(201).send(appointment);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.APPOINTMENTS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(updateAppointmentInputSchema, request.body);
      const appointment = await withTenant(auth.context.tenantId, (tx) =>
        updateAppointment(tx, auth.context, id, input),
      );
      return reply.send(appointment);
    },
  );

  app.patch(
    '/:id/status',
    { preHandler: requirePermission(Permission.APPOINTMENTS_WRITE) },
    async (request, reply) => {
      const auth = currentAuth(request);
      const { id } = validate(idParamSchema, request.params);
      const input = validate(changeAppointmentStatusInputSchema, request.body);

      if (input.status === 'CANCELLED' && !hasPermission(auth.user.role, Permission.APPOINTMENTS_CANCEL)) {
        throw new ForbiddenError('Voce nao possui permissao para cancelar atendimentos.');
      }

      const appointment = await withTenant(auth.context.tenantId, (tx) =>
        changeAppointmentStatus(tx, auth.context, id, input),
      );
      return reply.send(appointment);
    },
  );
}
