import {
  AuditAction,
  AuditEntity,
  type CreateBookingRequestInput,
  type PublicAvailabilityDto,
  type PublicAvailabilityQuery,
  type PublicBookingProfileDto,
  type PublicBookingRequestResultDto,
} from '@petflow/contracts';
import { and, asc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { shiftDate, todayInTimeZone, weekdayOf, zonedTimeToUtc } from '../../core/datetime.js';
import { BadRequestError, BusinessRuleError, NotFoundError } from '../../core/errors.js';
import { toNumber } from '../../core/serialization.js';
import type { Transaction } from '../../db/client.js';
import { acquireTransactionLock } from '../../db/context.js';
import { appointments, bookingRequests, services, tenants } from '../../db/schema/index.js';
import { recordAnonymousAudit } from '../audit/audit.service.js';
import { isTenantAccessBlocked } from '../billing/billing.service.js';
import { normalizeSettings } from '../tenants/tenants.service.js';

/**
 * Lado PUBLICO do agendamento online. Toda funcao aqui roda dentro de
 * `withPublicBookingTenant` (RLS ativo, tenant resolvido pelo slug) e so
 * devolve: perfil publico do pet shop, servicos ativos e horarios LIVRES.
 * Nada de cliente, pet ou agendamento alheio sai daqui -- a disponibilidade
 * e calculada no servidor e so os horarios de inicio livres sao expostos.
 */

const BLOCKING_STATUSES = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] as const;

async function loadTenant(tx: Transaction, tenantId: string) {
  const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw new NotFoundError('Pet shop');
  return { ...row, settings: normalizeSettings(row.settings) };
}

async function assertAvailable(tx: Transaction, tenantId: string): Promise<void> {
  // Pet shop com acesso bloqueado (trial vencido etc.) nao recebe
  // solicitacoes: ninguem conseguiria aceita-las.
  if (await isTenantAccessBlocked(tx, tenantId)) {
    throw new NotFoundError('Agendamento online');
  }
}

export async function getPublicProfile(tx: Transaction, tenantId: string): Promise<PublicBookingProfileDto> {
  await assertAvailable(tx, tenantId);
  const tenant = await loadTenant(tx, tenantId);
  const serviceRows = await tx
    .select()
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.active, true), isNull(services.deletedAt)))
    .orderBy(asc(services.name));

  return {
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    timezone: tenant.timezone,
    maxDaysAhead: tenant.settings.publicBooking.maxDaysAhead,
    services: serviceRows.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: toNumber(service.price),
    })),
  };
}

async function loadActiveService(tx: Transaction, tenantId: string, serviceId: string) {
  const [service] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId), eq(services.active, true), isNull(services.deletedAt)))
    .limit(1);
  if (!service) throw new NotFoundError('Serviço');
  return service;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Horarios livres = grade do horario de funcionamento, menos o que ocupa a
 * agenda da loja (agendamentos sem profissional, mesma "raia" que a checagem
 * de conflito do createAppointment usa) e menos solicitacoes ja pendentes.
 */
export async function getAvailability(
  tx: Transaction,
  tenantId: string,
  query: PublicAvailabilityQuery,
): Promise<PublicAvailabilityDto> {
  await assertAvailable(tx, tenantId);
  const tenant = await loadTenant(tx, tenantId);
  const service = await loadActiveService(tx, tenantId, query.serviceId);
  const { businessHours, publicBooking } = tenant.settings;
  const timeZone = tenant.timezone;
  const today = todayInTimeZone(timeZone);

  if (query.date < today || query.date > shiftDate(today, publicBooking.maxDaysAhead)) {
    return { date: query.date, slots: [], reason: 'OUT_OF_RANGE' };
  }
  if (!businessHours.weekdays.includes(weekdayOf(query.date))) {
    return { date: query.date, slots: [], reason: 'CLOSED_DAY' };
  }

  const open = minutesOf(businessHours.start);
  const close = minutesOf(businessHours.end);
  const duration = service.durationMinutes;
  const earliest = Date.now() + publicBooking.minLeadHours * 60 * 60 * 1000;

  const dayStart = zonedTimeToUtc(query.date, '00:00', timeZone);
  const dayEnd = zonedTimeToUtc(shiftDate(query.date, 1), '00:00', timeZone);

  const busyAppointments = await tx
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        isNull(appointments.professionalId),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        lt(appointments.startsAt, dayEnd),
        gt(appointments.endsAt, dayStart),
      ),
    );
  const busyRequests = await tx
    .select({ startsAt: bookingRequests.startsAt, endsAt: bookingRequests.endsAt })
    .from(bookingRequests)
    .where(
      and(
        eq(bookingRequests.tenantId, tenantId),
        eq(bookingRequests.status, 'PENDING'),
        lt(bookingRequests.startsAt, dayEnd),
        gt(bookingRequests.endsAt, dayStart),
      ),
    );
  const busy = [...busyAppointments, ...busyRequests].map((row) => [row.startsAt.getTime(), row.endsAt.getTime()] as const);

  const slots: string[] = [];
  for (let minute = open; minute + duration <= close; minute += publicBooking.slotIntervalMinutes) {
    const start = zonedTimeToUtc(query.date, timeOf(minute), timeZone).getTime();
    const end = start + duration * 60_000;
    if (start < earliest) continue;
    // [a,b) e [c,d) se sobrepoem quando a < d e c < b.
    if (busy.some(([busyStart, busyEnd]) => start < busyEnd && busyStart < end)) continue;
    slots.push(new Date(start).toISOString());
  }

  return { date: query.date, slots, reason: slots.length > 0 ? 'OPEN' : 'FULL' };
}

export async function createBookingRequest(
  tx: Transaction,
  tenantId: string,
  input: CreateBookingRequestInput,
  meta: { ipAddress?: string | null; userAgent?: string | null; requestId?: string | null },
): Promise<PublicBookingRequestResultDto> {
  // Honeypot: campo invisivel preenchido = robo. Resposta generica.
  if (input.website) throw new BadRequestError('Não foi possível registrar a solicitação.');

  await assertAvailable(tx, tenantId);
  const tenant = await loadTenant(tx, tenantId);
  const service = await loadActiveService(tx, tenantId, input.serviceId);

  // O horario precisa ser um dos horarios LIVRES calculados pelo servidor --
  // o tutor nao consegue pedir um horario fora do expediente, no passado ou
  // em cima de outro atendimento, mesmo montando a requisicao na mao.
  const startsAt = new Date(input.startsAt);
  // Serializa solicitacoes do mesmo pet shop: duas pessoas pedindo o mesmo
  // horario ao mesmo tempo -- a segunda ve a primeira como ocupada.
  await acquireTransactionLock(tx, `booking:${tenantId}`);
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tenant.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startsAt);
  const availability = await getAvailability(tx, tenantId, { serviceId: service.id, date: localDate });
  if (!availability.slots.includes(startsAt.toISOString())) {
    throw new BusinessRuleError('Este horário não está mais disponível. Escolha outro horário.');
  }

  const [row] = await tx
    .insert(bookingRequests)
    .values({
      tenantId,
      serviceId: service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      petName: input.petName,
      petSpecies: input.petSpecies,
      notes: input.notes,
    })
    .returning({ id: bookingRequests.id });
  if (!row) throw new Error('Falha ao registrar solicitação.');

  await recordAnonymousAudit(
    tx,
    { tenantId, userId: null, ipAddress: meta.ipAddress, userAgent: meta.userAgent, requestId: meta.requestId },
    {
      action: AuditAction.BOOKING_REQUESTED,
      entity: AuditEntity.BOOKING_REQUEST,
      entityId: row.id,
      metadata: { serviceId: service.id, startsAt: startsAt.toISOString() },
    },
  );

  return {
    status: 'PENDING',
    startsAt: startsAt.toISOString(),
    serviceName: service.name,
    message: `Solicitação enviada para ${tenant.name}. O pet shop vai confirmar o horário com você.`,
  };
}
