import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, notesSchema, paginationQuerySchema, sortOrderSchema, uuidSchema } from './common.js';

export const PaymentMethod = {
  CASH: 'CASH',
  DEBIT_CARD: 'DEBIT_CARD',
  CREDIT_CARD: 'CREDIT_CARD',
  PIX: 'PIX',
  TRANSFER: 'TRANSFER',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  DEBIT_CARD: 'Cartao de debito',
  CREDIT_CARD: 'Cartao de credito',
  PIX: 'Pix',
  TRANSFER: 'Transferencia',
  OTHER: 'Outro',
};

export const paymentMethodSchema = z.nativeEnum(PaymentMethod, {
  errorMap: () => ({ message: 'Forma de pagamento invalida.' }),
});

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  REFUNDED: 'Estornado',
  CANCELLED: 'Cancelado',
};

export const paymentStatusSchema = z.nativeEnum(PaymentStatus, {
  errorMap: () => ({ message: 'Status de pagamento invalido.' }),
});

/**
 * Maquina de estados do pagamento. Espelha a de agendamentos
 * (apps/api/src/modules/appointments): estados finais nao tem saida, para
 * nunca reescrever historico financeiro -- um estorno errado gera um NOVO
 * lancamento, nao volta o antigo para PAID.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export const createPaymentInputSchema = z
  .object({
    customerId: uuidSchema,
    /** Opcional: um recebimento pode nao estar ligado a nenhum agendamento (ex.: venda avulsa, adiantamento). */
    appointmentId: uuidSchema.optional().nullable(),
    /** Se omitido e appointmentId for informado, herda o preco do agendamento no momento do registro. */
    amount: moneySchema.optional(),
    method: paymentMethodSchema,
    /** Se omitido, assume PAID -- o caso mais comum e' "registrar o que acabei de receber". */
    status: paymentStatusSchema.default('PAID'),
    /** Obrigatorio quando status = PAID; se omitido nesse caso, assume o momento do registro. */
    paidAt: isoDateTimeSchema.optional().nullable(),
    notes: notesSchema,
  })
  .strict()
  .refine((data) => data.amount !== undefined || !!data.appointmentId, {
    message: 'Informe o valor do pagamento (ou vincule a um agendamento para herdar o preco).',
    path: ['amount'],
  });
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;

export const changePaymentStatusInputSchema = z
  .object({
    status: paymentStatusSchema,
  })
  .strict();
export type ChangePaymentStatusInput = z.infer<typeof changePaymentStatusInputSchema>;

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  customerId: uuidSchema.optional(),
  appointmentId: uuidSchema.optional(),
  status: paymentStatusSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  sort: z.enum(['paidAt', 'createdAt']).default('createdAt'),
  order: sortOrderSchema,
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

export interface PaymentDto {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  appointmentId: string | null;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
