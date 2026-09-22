import { z } from 'zod';
import { isoDateSchema } from './common.js';
import type { AppointmentStatus } from './appointment.js';

export const dashboardQuerySchema = z.object({
  /** Dia de referencia no fuso do tenant. Padrao: hoje. */
  date: isoDateSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface DashboardTodayMetrics {
  total: number;
  scheduled: number;
  confirmed: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Soma dos agendamentos que ainda podem gerar receita hoje. */
  expectedRevenue: number;
  /** Soma dos pagamentos efetivamente recebidos hoje. */
  receivedRevenue: number;
}

export interface DashboardUpcomingAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  customerName: string;
  customerWhatsapp: string | null;
  petName: string;
  serviceName: string;
  price: number;
}

export interface DashboardRevenuePoint {
  date: string;
  expected: number;
  received: number;
}

export interface DashboardOverview {
  referenceDate: string;
  timezone: string;
  today: DashboardTodayMetrics;
  customers: {
    total: number;
    newThisMonth: number;
    /** Sem agendamento ha mais de `inactiveThresholdDays` dias. */
    inactive: number;
    inactiveThresholdDays: number;
  };
  /** Atendimentos concluidos sem proximo agendamento marcado. */
  pendingReturns: number;
  upcoming: DashboardUpcomingAppointment[];
  /** Serie dos ultimos 14 dias para o grafico de receita. */
  revenueSeries: DashboardRevenuePoint[];
}
