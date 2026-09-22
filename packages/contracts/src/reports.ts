import { z } from 'zod';
import { isoDateSchema } from './common.js';

export const reportsQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
});
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

export interface ReportServiceUsage {
  serviceId: string;
  serviceName: string;
  count: number;
  revenue: number;
}

/**
 * `advanced: false` significa que o tenant esta num plano sem o recurso
 * `advanced_reports` -- os campos marcados como avancados vem `null`, e o
 * frontend mostra o cartao de upgrade contextual em cima deles em vez de
 * escondê-los.
 */
export interface ReportsOverviewDto {
  from: string;
  to: string;
  advanced: boolean;
  appointments: {
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  revenue: {
    expected: number;
    received: number;
  };
  customers: {
    new: number;
    recurring: number;
    inactive: number;
  };
  /** null quando o plano nao inclui relatorios avancados. */
  topServices: ReportServiceUsage[] | null;
}
