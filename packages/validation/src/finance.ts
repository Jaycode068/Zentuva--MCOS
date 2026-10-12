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

/** One line of a multi-invoice `allocations` array (Phase 1 Customer Account
 *  Management — docs/customer-account-inventory-audit.md §7.2). */
export const paymentAllocationInputSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Invoice is required'),
  amount: z.number().positive('Allocation amount must be greater than zero'),
});
export type PaymentAllocationInput = z.infer<typeof paymentAllocationInputSchema>;

function hasNoDuplicateAllocationInvoices(allocations: PaymentAllocationInput[]): boolean {
  const ids = allocations.map((a) => a.invoiceId);
  return new Set(ids).size === ids.length;
}

/** Same 2-decimal rounding convention used throughout the Finance domain's services —
 *  duplicated here (not imported) because this package has no dependency on `apps/api`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `POST /api/finance/payments` (Sprint 6, widened Phase 1 — Customer Account
 * Management, docs/customer-account-inventory-audit.md §7.2 "Multi-invoice payment
 * allocation and customer advances"). A payment is recorded against EITHER a single
 * `invoiceId` (the original Sprint 6 shape — still fully supported, unchanged
 * behaviour) OR an `allocations` array splitting the payment across multiple eligible
 * invoices belonging to the same customer — never both on the same request. The
 * allocation total may be less than `amount` (the remainder stays unallocated — a
 * customer-advance scenario the server surfaces, never silently drops), but must never
 * exceed it. `currency` is deliberately absent — always derived server-side from the
 * target invoice's own snapshotted currency, never client-supplied.
 */
export const createPaymentSchema = z
  .object({
    invoiceId: z.string().trim().min(1, 'Invoice is required').optional(),
    allocations: z.array(paymentAllocationInputSchema).min(1).optional(),
    amount: z.number().positive('Amount must be greater than zero'),
    method: paymentMethodSchema,
    paymentDate: z.coerce.date(),
    reference: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    /** Added Sprint 14 (docs/domains/cash-management.md) — which specific
     *  `CashAccount` received the money. Optional. */
    cashAccountId: z.string().trim().min(1).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => Boolean(data.invoiceId) !== Boolean(data.allocations), {
    message: 'Provide either a single invoiceId or a multi-invoice allocations array, not both',
    path: ['allocations'],
  })
  .refine((data) => !data.allocations || hasNoDuplicateAllocationInvoices(data.allocations), {
    message: 'The same invoice cannot receive two allocations in one payment',
    path: ['allocations'],
  })
  .refine(
    (data) =>
      !data.allocations ||
      roundCurrency(data.allocations.reduce((sum, a) => sum + a.amount, 0)) <=
        roundCurrency(data.amount),
    {
      message: 'The total allocated amount cannot exceed the payment amount',
      path: ['allocations'],
    },
  );
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
