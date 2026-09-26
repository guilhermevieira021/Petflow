import { z } from 'zod';
import {
  isoDateTimeSchema,
  moneySchema,
  notesSchema,
  paginationQuerySchema,
  sortOrderSchema,
  uuidSchema,
} from './common.js';
import { quantitySchema } from './inventory.js';
import { paymentMethodSchema, type PaymentDto, type PaymentMethod } from './payment.js';

/**
 * VENDAS DO PET SHOP -- FLUXO 1.
 *
 * Dinheiro que o pet shop recebe dos PROPRIOS clientes (banho, racao,
 * acessorios). Nao tem NENHUMA relacao com a assinatura do Petflow (FLUXO 2:
 * plans/subscriptions/Cakto). O "Recebido" do dashboard soma os pagamentos
 * PAGOS destas vendas e dos recebimentos avulsos -- e nada mais.
 */

export const SaleStatus = {
  /** Registrada, ainda nao recebida (ex.: "fiado", cobrar depois). */
  OPEN: 'OPEN',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  OPEN: 'A receber',
  PAID: 'Paga',
  CANCELLED: 'Cancelada',
};

export const saleItemInputSchema = z
  .object({
    /** Produto do estoque: baixa o saldo automaticamente. */
    productId: uuidSchema.optional().nullable(),
    /** Servico do catalogo (ex.: banho avulso sem agendamento). */
    serviceId: uuidSchema.optional().nullable(),
    /** Obrigatoria para item livre; para produto/servico, se omitida, usa o nome do cadastro. */
    description: z.string().trim().max(160, 'Descricao muito longa.').optional().nullable(),
    quantity: quantitySchema.refine((value) => value > 0, 'A quantidade deve ser maior que zero.'),
    /** Se omitido, usa o preco do cadastro do produto/servico. */
    unitPrice: moneySchema.optional(),
  })
  .strict()
  .refine((item) => !(item.productId && item.serviceId), {
    message: 'Um item e produto OU servico, nao os dois.',
    path: ['productId'],
  })
  .refine((item) => !!item.productId || !!item.serviceId || (!!item.description && item.unitPrice !== undefined), {
    message: 'Item avulso precisa de descricao e valor.',
    path: ['description'],
  });
export type SaleItemInput = z.infer<typeof saleItemInputSchema>;

export const createSaleInputSchema = z
  .object({
    customerId: uuidSchema.optional().nullable(),
    petId: uuidSchema.optional().nullable(),
    appointmentId: uuidSchema.optional().nullable(),
    items: z.array(saleItemInputSchema).min(1, 'Adicione ao menos um item.').max(100, 'Maximo de 100 itens por venda.'),
    discount: moneySchema.default(0),
    /** Data/hora da venda. Padrao: agora. */
    soldAt: isoDateTimeSchema.optional().nullable(),
    notes: notesSchema,
    /**
     * Como a venda foi recebida. `paid = true` registra o pagamento como PAGO
     * (entra no "Recebido" imediatamente); `false` deixa a venda "a receber".
     */
    payment: z
      .object({
        method: paymentMethodSchema,
        paid: z.boolean().default(true),
      })
      .strict(),
  })
  .strict()
  .refine((data) => !data.petId || !!data.customerId, {
    message: 'Para vincular um pet, informe tambem o cliente.',
    path: ['petId'],
  });
export type CreateSaleInput = z.infer<typeof createSaleInputSchema>;

export const cancelSaleInputSchema = z
  .object({
    reason: z.string().trim().min(3, 'Informe o motivo do cancelamento.').max(500),
  })
  .strict();
export type CancelSaleInput = z.infer<typeof cancelSaleInputSchema>;

/** Receber uma venda que estava "a receber". */
export const receiveSaleInputSchema = z
  .object({
    method: paymentMethodSchema.optional(),
  })
  .strict();
export type ReceiveSaleInput = z.infer<typeof receiveSaleInputSchema>;

export const listSalesQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(SaleStatus).optional(),
  customerId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  /** Busca por numero da venda ou nome do cliente. */
  search: z.string().trim().max(120).optional(),
  order: sortOrderSchema.default('desc'),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export interface SaleItemDto {
  id: string;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface SaleDto {
  id: string;
  tenantId: string;
  number: number;
  customerId: string | null;
  customerName: string | null;
  petId: string | null;
  petName: string | null;
  appointmentId: string | null;
  status: SaleStatus;
  subtotal: number;
  discount: number;
  total: number;
  /** Forma de pagamento do recebimento principal (null se nao houver). */
  paymentMethod: PaymentMethod | null;
  soldAt: string;
  notes: string | null;
  createdByName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  itemsCount: number;
}

export interface SaleDetailDto extends SaleDto {
  items: SaleItemDto[];
  payments: PaymentDto[];
}

export interface SalesSummaryDto {
  /** Janela consultada (ISO). */
  from: string;
  to: string;
  /** Soma das vendas nao canceladas. */
  totalSold: number;
  /** Soma dos pagamentos PAGOS das vendas da janela. */
  totalReceived: number;
  /** Vendas "a receber" (OPEN) na janela. */
  totalOpen: number;
  salesCount: number;
  averageTicket: number | null;
  byMethod: { method: PaymentMethod; amount: number }[];
}

export const salesSummaryQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
export type SalesSummaryQuery = z.infer<typeof salesSummaryQuerySchema>;
