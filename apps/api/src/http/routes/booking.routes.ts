import {
  createBookingRequestInputSchema,
  idParamSchema,
  listBookingRequestsQuerySchema,
  Permission,
  publicAvailabilityQuerySchema,
  publicSlugParamSchema,
  rejectBookingRequestInputSchema,
} from '@petflow/contracts';
import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../core/errors.js';
import { validate } from '../../core/validation.js';
import { withPublicBookingTenant, withTenant } from '../../db/context.js';
import {
  acceptBookingRequest,
  countPendingBookingRequests,
  listBookingRequests,
  rejectBookingRequest,
} from '../../modules/booking/booking-requests.service.js';
import { createBookingRequest, getAvailability, getPublicProfile } from '../../modules/booking/public-booking.service.js';
import { currentAuth, requirePermission } from '../plugins/auth.js';

/** Mesmo 404 para slug inexistente e recurso desligado: o link nao enumera pet shops. */
function orNotFound<T>(value: T | null): T {
  if (value === null) throw new NotFoundError('Agendamento online');
  return value;
}

/**
 * /api/public/booking/:slug -- SEM sessao. Rate limit proprio, mais restrito
 * que o global, porque e a unica superficie de escrita anonima do sistema.
 */
export async function publicBookingRoutes(app: FastifyInstance): Promise<void> {
  const readLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  const writeLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.get('/:slug', { config: readLimit }, async (request, reply) => {
    const { slug } = validate(publicSlugParamSchema, request.params);
    return reply.send(orNotFound(await withPublicBookingTenant(slug, (tx, tenantId) => getPublicProfile(tx, tenantId))));
  });

  app.get('/:slug/availability', { config: readLimit }, async (request, reply) => {
    const { slug } = validate(publicSlugParamSchema, request.params);
    const query = validate(publicAvailabilityQuerySchema, request.query);
    return reply.send(
      orNotFound(await withPublicBookingTenant(slug, (tx, tenantId) => getAvailability(tx, tenantId, query))),
    );
  });

  app.post('/:slug/requests', { config: writeLimit }, async (request, reply) => {
    const { slug } = validate(publicSlugParamSchema, request.params);
    const input = validate(createBookingRequestInputSchema, request.body);
    const result = orNotFound(
      await withPublicBookingTenant(slug, (tx, tenantId) =>
        createBookingRequest(tx, tenantId, input, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: request.id,
        }),
      ),
    );
    return reply.status(201).send(result);
  });
}

/** /api/booking-requests -- lado do pet shop (com sessao). */
export async function bookingRequestsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requirePermission(Permission.APPOINTMENTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const query = validate(listBookingRequestsQuerySchema, request.query);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => listBookingRequests(tx, auth.context, query)));
  });

  app.get('/pending-count', { preHandler: requirePermission(Permission.APPOINTMENTS_READ) }, async (request, reply) => {
    const auth = currentAuth(request);
    const total = await withTenant(auth.context.tenantId, (tx) => countPendingBookingRequests(tx, auth.context));
    return reply.send({ total });
  });

  app.post('/:id/accept', { preHandler: requirePermission(Permission.APPOINTMENTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    return reply.send(await withTenant(auth.context.tenantId, (tx) => acceptBookingRequest(tx, auth.context, id)));
  });

  app.post('/:id/reject', { preHandler: requirePermission(Permission.APPOINTMENTS_WRITE) }, async (request, reply) => {
    const auth = currentAuth(request);
    const { id } = validate(idParamSchema, request.params);
    const input = validate(rejectBookingRequestInputSchema, request.body ?? {});
    await withTenant(auth.context.tenantId, (tx) => rejectBookingRequest(tx, auth.context, id, input));
    return reply.status(204).send();
  });
}
