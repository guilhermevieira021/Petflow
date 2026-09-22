import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/** Janelas de "cliente sumido" oferecidas na tela de recuperacao. */
export const RETENTION_WINDOW_OPTIONS = [30, 45, 60, 90] as const;

export const retentionQuerySchema = paginationQuerySchema.extend({
  /** Dias sem atendimento. Se omitido, usa `settings.inactiveCustomerDays` do tenant. */
  days: z.coerce.number().int().min(7).max(365).optional(),
});
export type RetentionQuery = z.infer<typeof retentionQuerySchema>;

export interface RetentionEntryDto {
  customerId: string;
  customerName: string;
  customerWhatsapp: string | null;
  /** Nomes dos pets do cliente, para contexto na mensagem sugerida. */
  petNames: string[];
  lastVisitAt: string;
  daysSinceLastVisit: number;
}
