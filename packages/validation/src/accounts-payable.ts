import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 12's Accounts Payable & Supplier Invoice
 * Management (docs/domains/finance.md "Accounts Payable") — Supplier Invoices,
 * Supplier Payments, Supplier Credit Notes. Split into its own file, same "one file
 * per domain" convention as `returns.ts`.
 *
 * A Supplier Invoice line always takes exactly one of two paths (never both, never
 * neither, by the time the invoice is POSTed — service-enforced, see
 * `apps/api/src/finance/supplier-invoice.repository.ts`): **Path A**
 * (`goodsReceiptItemId` set) reconciles against a liability Goods Receipt already
 * posted; **Path B** (`debitAccountId` set) creates a fresh one against an explicit,
 * user-chosen Chart of Accounts entry. `quantity`/`unitPrice` are genuinely
 * client-supplied here (unlike `invoiceItemInputSchema`'s customer-side counterpart,
 * which snapshots from an existing `SalesOrderItem`) — capturing what the supplier
 * actually billed is the entire point of this document.
 */

export const supplierInvoiceStatusSchema = z.enum([
  'DRAFT',
  'POSTED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
]);
export type SupplierInvoiceStatusInput = z.infer<typeof supplierInvoiceStatusSchema>;

export const supplierInvoiceMatchStatusSchema = z.enum(['UNVERIFIED', 'MATCHED', 'DISCREPANCY']);
export type SupplierInvoiceMatchStatusInput = z.infer<typeof supplierInvoiceMatchStatusSchema>;

/** One line of a `POST /finance/supplier-invoices` (or `PATCH .../:id`) request.
 *  `goodsReceiptItemId`/`debitAccountId` are both optional here — full flexibility
 *  for DRAFT capture (brief §15) — but `SupplierInvoiceService.post()` requires
 *  exactly one of the two to be set before an invoice can leave `DRAFT`. */
export const supplierInvoiceItemInputSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(500).optional(),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),
  goodsReceiptItemId: z.string().trim().min(1).optional(),
  debitAccountId: z.string().trim().min(1).optional(),
});
export type SupplierInvoiceItemInput = z.infer<typeof supplierInvoiceItemInputSchema>;

const supplierInvoiceItemsField = z
  .array(supplierInvoiceItemInputSchema)
  .min(1, 'At least one item is required');

/**
 * `POST /api/finance/supplier-invoices` (Sprint 12) — captures a DRAFT Supplier
 * Invoice. `invoiceNumber` is the supplier's own numbering (never assumed globally
 * unique — scoped to `supplierId` server-side). `subtotal`/`taxAmount`/`total` are
 * absent — pure rollups of `items`, never independently settable.
 */
export const createSupplierInvoiceSchema = z.object({
  supplierId: z.string().trim().min(1, 'Supplier is required'),
  purchaseOrderId: z.string().trim().min(1).optional(),
  invoiceNumber: z.string().trim().min(1, 'Invoice number is required').max(100),
  invoiceDate: z.coerce.date(),
  paymentTerms: z.enum(['CASH', 'DUE_ON_RECEIPT', 'NET_7', 'NET_14', 'NET_30']),
  taxAmount: z.number().nonnegative('Tax amount cannot be negative').optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
  items: supplierInvoiceItemsField,
});
export type CreateSupplierInvoiceInput = z.infer<typeof createSupplierInvoiceSchema>;

/** `PATCH /api/finance/supplier-invoices/:id` — DRAFT only. `supplierId` is
 *  deliberately absent — immutable after creation, anchors the document's identity. */
export const updateSupplierInvoiceSchema = z.object({
  purchaseOrderId: z.string().trim().min(1).nullable().optional(),
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  invoiceDate: z.coerce.date().optional(),
  paymentTerms: z.enum(['CASH', 'DUE_ON_RECEIPT', 'NET_7', 'NET_14', 'NET_30']).optional(),
  taxAmount: z.number().nonnegative('Tax amount cannot be negative').optional(),
  notes: z.string().trim().max(2000).optional(),
  items: supplierInvoiceItemsField.optional(),
});
export type UpdateSupplierInvoiceInput = z.infer<typeof updateSupplierInvoiceSchema>;

/** `POST /:id/post` — the one-way `DRAFT -> POSTED` transition (brief §5/§20). */
export const postSupplierInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type PostSupplierInvoiceInput = z.infer<typeof postSupplierInvoiceSchema>;

/** `POST /:id/acknowledge-discrepancy` — a human sign-off record only, never changes
 *  `recognizedAmount`/AP (brief §6 "no tolerance engine"). */
export const acknowledgeSupplierInvoiceDiscrepancySchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type AcknowledgeSupplierInvoiceDiscrepancyInput = z.infer<
  typeof acknowledgeSupplierInvoiceDiscrepancySchema
>;

/** `POST /:id/void` — mirrors `voidInvoiceSchema`. */
export const voidSupplierInvoiceSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type VoidSupplierInvoiceInput = z.infer<typeof voidSupplierInvoiceSchema>;

/**
 * `POST /api/finance/supplier-payments` (Sprint 12) — records a payment against
 * exactly one supplier invoice, same one-invoice-allocation scope as
 * `createPaymentSchema`. `currency` is absent — always derived server-side from the
 * target invoice's own snapshotted currency.
 */
export const createSupplierPaymentSchema = z.object({
  supplierInvoiceId: z.string().trim().min(1, 'Supplier invoice is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'POS', 'OTHER']),
  paymentDate: z.coerce.date(),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>;

/**
 * `POST /api/finance/supplier-credit-notes` (Sprint 12) — creates a DRAFT Supplier
 * Credit Note against a supplier invoice; `POST /:id/issue` is the separate action
 * that applies it. Mirrors `createCreditNoteSchema` exactly.
 */
export const createSupplierCreditNoteSchema = z.object({
  supplierInvoiceId: z.string().trim().min(1, 'Supplier invoice is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  reason: z.string().trim().min(1, 'A reason is required').max(2000),
  creditNoteDate: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateSupplierCreditNoteInput = z.infer<typeof createSupplierCreditNoteSchema>;
