import { z } from 'zod';

/**
 * Shared validation schemas for the Inventory domain (Sprint 4.4, refined Sprint 4.4.1),
 * matching the API contract in docs/domains/inventory.md. Split into its own file, same
 * "one file per domain" convention as `procurement.ts`/`suppliers.ts`/`catalogue.ts`.
 *
 * The enum schemas mirror `apps/api/prisma/schema.prisma`'s `InventoryTransactionType`/
 * `RejectionReason`/`DiscrepancyStatus` as plain string literals rather than importing
 * `@prisma/client` here — this package is shared by `apps/web` too, same rationale as
 * every other domain schema file.
 */

export const inventoryTransactionTypeSchema = z.enum(['RECEIPT', 'ISSUE', 'ADJUSTMENT']);
export type InventoryTransactionTypeInput = z.infer<typeof inventoryTransactionTypeSchema>;

/** Sprint 4.4.1 brief §4 — a simple structured reason, not a full Quality Management
 *  System. */
export const rejectionReasonSchema = z.enum([
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'WRONG_SPECIFICATION',
  'CONTAMINATED',
  'OTHER',
]);
export type RejectionReasonInput = z.infer<typeof rejectionReasonSchema>;

/** Sprint 4.4.1 brief §5 — the lightweight supplier-resolution state for a
 *  `GoodsReceipt`'s discrepancy (if any). Deliberately not a Supplier Claims/Returns/
 *  Credit-Note system. */
export const discrepancyStatusSchema = z.enum([
  'NONE',
  'PENDING_SUPPLIER',
  'REPLACEMENT_EXPECTED',
  'REPLACEMENT_RECEIVED',
  'CREDIT_EXPECTED',
  'RESOLVED',
]);
export type DiscrepancyStatusInput = z.infer<typeof discrepancyStatusSchema>;

/**
 * One line of a Goods Receipt (Sprint 4.4.1 brief §1/§12) — distinguishes what physically
 * arrived (`deliveredQuantity`) from what's rejected (`rejectedQuantity`); the accepted
 * portion is always `deliveredQuantity - rejectedQuantity`, computed server-side by
 * `InventoryService`, never accepted here (brief: "Do not allow the user to manually
 * enter Accepted Quantity"). `purchaseOrderItemId` — not `productId` — is the actual
 * input, so "what was ordered" is always read from that row, never re-entered; the
 * service resolves `productId` from it. Excess delivery (`deliveredQuantity` greater than
 * what's still outstanding) is explicitly allowed, never capped (brief §3 Scenario E).
 */
export const goodsReceiptItemInputSchema = z
  .object({
    purchaseOrderItemId: z.string().trim().min(1, 'Purchase order item is required'),
    deliveredQuantity: z.number().nonnegative('Delivered quantity cannot be negative'),
    rejectedQuantity: z.number().nonnegative('Rejected quantity cannot be negative').default(0),
    rejectionReason: rejectionReasonSchema.optional(),
    rejectionNotes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => data.rejectedQuantity <= data.deliveredQuantity, {
    message: 'Rejected quantity cannot exceed delivered quantity',
    path: ['rejectedQuantity'],
  });
export type GoodsReceiptItemInput = z.infer<typeof goodsReceiptItemInputSchema>;

/**
 * `POST /api/inventory/goods-receipts` (Sprint 4.4 brief, item shape refined 4.4.1).
 * `goodsReceiptNumber` is deliberately absent — always server-generated, immutable,
 * never accepted on input. `supplierId` is also absent — always derived from the
 * referenced Purchase Order, never trusted from the client. `receivedBy` is always the
 * authenticated caller, not a field on this schema, same convention as `createdById`
 * across every other domain. Sprint 4.4.1 removed the old "one receipt per PO" limit —
 * this may be submitted multiple times against the same Purchase Order (short delivery
 * followed by the remainder, a rejected batch followed by a replacement, ...).
 */
export const createGoodsReceiptSchema = z.object({
  purchaseOrderId: z.string().trim().min(1, 'Purchase order is required'),
  receivedDate: z.coerce.date(),
  remarks: z.string().trim().max(2000).optional(),
  items: z.array(goodsReceiptItemInputSchema).min(1, 'At least one item is required'),
});
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;

/**
 * `PATCH /api/inventory/goods-receipts/:id/discrepancy` (Sprint 4.4.1 brief §5) — the
 * one mutation ever applied to an otherwise-immutable `GoodsReceipt`. Progresses the
 * lightweight supplier-resolution state; does not touch what was actually received.
 */
export const updateGoodsReceiptDiscrepancySchema = z.object({
  status: discrepancyStatusSchema,
  notes: z.string().trim().max(2000).optional(),
});
export type UpdateGoodsReceiptDiscrepancyInput = z.infer<
  typeof updateGoodsReceiptDiscrepancySchema
>;
