import { z } from 'zod';

/**
 * Shared validation schemas for the Finance domain (Sprint 6, docs/domains/finance.md)
 * — Invoices, Payments, Credit Notes. Split into its own file, same "one file per
 * domain" convention as `distribution.ts`/`sales.ts`/`production.ts`.
 *
 * Every financial total (`lineTotal`, `taxAmount`, `subtotal`, `total`, `amount`,
 * `amountOutstanding`) is deliberately absent from every schema below — server-computed
 * only, never trusted from the client.
 */

export const paymentTermTypeSchema = z.enum([
  'CASH',
  'DUE_ON_RECEIPT',
  'NET_7',
  'NET_14',
  'NET_30',
]);
export type PaymentTermTypeInput = z.infer<typeof paymentTermTypeSchema>;

export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
]);
export type InvoiceStatusInput = z.infer<typeof invoiceStatusSchema>;

export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'POS', 'OTHER']);
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;

export const creditNoteStatusSchema = z.enum(['DRAFT', 'ISSUED', 'VOID']);
export type CreditNoteStatusInput = z.infer<typeof creditNoteStatusSchema>;

/** Rejects an invoice item list containing the same `salesOrderItemId` more than once —
 *  same pattern as `hasNoDuplicateDispatchItems`. */
function hasNoDuplicateInvoiceItems(items: { salesOrderItemId: string }[]): boolean {
  const ids = items.map((item) => item.salesOrderItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /finance/invoices` request. `productId`/`unitPrice`/`quantity`
 *  are deliberately absent — the server resolves and snapshots them from the source
 *  `SalesOrderItem`, never trusted from the client. Only `discount`/`taxRate` are
 *  overridable per line; an omitted `taxRate` falls back to the server's configured
 *  default. */
export const invoiceItemInputSchema = z.object({
  salesOrderItemId: z.string().trim().min(1, 'Sales order line is required'),
  discount: z.number().nonnegative('Discount cannot be negative').optional(),
  taxRate: z.number().min(0).max(100, 'Tax rate must be between 0 and 100').optional(),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

/**
 * `POST /api/finance/invoices` (Sprint 6) — creates an Invoice from an eligible
 * (`FULFILLED`) Sales Order. `invoiceCode`/`status`/`customerId`/`outletId`/`currency`
 * are absent — server-generated/derived/resolved from the order. `dueDate` is absent —
 * computed server-side from `invoiceDate` + `paymentTerms`. `subtotal`/`discount`/
 * `taxAmount`/`total` are all absent too — `Invoice.discount`/`taxAmount` are pure
 * rollups of their `InvoiceItem` counterparts, never independently settable.
 */
export const createInvoiceSchema = z
  .object({
    salesOrderId: z.string().trim().min(1, 'Sales order is required'),
    invoiceDate: z.coerce.date(),
    paymentTerms: paymentTermTypeSchema,
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(invoiceItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateInvoiceItems(data.items), {
    message: 'Duplicate sales order lines are not allowed on the same invoice',
    path: ['items'],
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** `POST /:id/void` — an explanation is optional but capped, matching every other
 *  free-text notes field in this codebase. */
export const voidInvoiceSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

/**
 * `POST /api/finance/payments` (Sprint 6) — records a payment against exactly one
 * invoice (Sprint 6's deliberate one-invoice-allocation limitation — see
 * docs/domains/finance.md). `currency` is deliberately absent — always derived
 * server-side from the target invoice's own snapshotted currency, never client-supplied.
 */
export const createPaymentSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Invoice is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  method: paymentMethodSchema,
  paymentDate: z.coerce.date(),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Added Sprint 14 (docs/domains/cash-management.md) — which specific
   *  `CashAccount` received the money. Optional. */
  cashAccountId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/**
 * `POST /api/finance/credit-notes` (Sprint 6) — creates a DRAFT Credit Note against an
 * invoice; `POST /:id/issue` is the separate action that actually applies the credit.
 * `currency` is deliberately absent — same server-derivation rule as `Payment`.
 */
export const createCreditNoteSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Invoice is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  reason: z.string().trim().min(1, 'A reason is required').max(2000),
  creditNoteDate: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>;
