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

/** Sprint 4.5 brief §16 — `Supplier`/`Product` both use `ACTIVE`/`INACTIVE` for the same
 *  "usable vs. retired, never deleted" distinction; reused here. */
export const locationStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type LocationStatusInput = z.infer<typeof locationStatusSchema>;

/** `POST /api/inventory/locations` (Sprint 4.5 brief §16/§20). Every organisation's
 *  first location is auto-created as the default "Main Warehouse" on first use
 *  (`InventoryLocationRepository.getOrCreateDefault`) — this schema is for
 *  Owner/Administrator-created *additional* locations, always starting `ACTIVE`. */
export const createInventoryLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(200),
});
export type CreateInventoryLocationInput = z.infer<typeof createInventoryLocationSchema>;

/** `PATCH /api/inventory/locations/:id` — rename and/or deactivate/reactivate. No
 *  delete (brief §16/§20: "Do not allow deleting locations that already have inventory
 *  history"). */
export const updateInventoryLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(200).optional(),
  status: locationStatusSchema.optional(),
});
export type UpdateInventoryLocationInput = z.infer<typeof updateInventoryLocationSchema>;

/** Sprint 4.5 brief §5 — a small controlled list of adjustment reasons, not an
 *  elaborate configuration system. */
export const adjustmentReasonSchema = z.enum([
  'PHYSICAL_COUNT',
  'DAMAGE',
  'SPOILAGE',
  'LOSS',
  'FOUND_STOCK',
  'DATA_CORRECTION',
  'OTHER',
]);
export type AdjustmentReasonInput = z.infer<typeof adjustmentReasonSchema>;

/**
 * `POST /api/inventory/adjustments` (Sprint 4.5 brief §4/§8). `quantity` is the signed
 * delta to apply (e.g. `-3` for "3 units fewer than the system thinks") — never a new
 * absolute balance to overwrite `quantityOnHand` with (brief: "the system must NOT
 * simply overwrite quantityOnHand"). Zero is rejected (brief §30 "zero adjustment
 * rejection" — a no-op adjustment isn't a legitimate correction). `locationId` is
 * optional — omitted, it resolves to the organisation's default location, same
 * fallback Goods Receiving uses. Negative-stock prevention
 * (`current + quantity >= 0`) is enforced server-side in `InventoryService`, not here,
 * since it depends on the current balance.
 */
export const createInventoryAdjustmentSchema = z.object({
  productId: z.string().trim().min(1, 'Product is required'),
  locationId: z.string().trim().min(1).optional(),
  quantity: z.number().refine((value) => value !== 0, 'Adjustment quantity cannot be zero'),
  reason: adjustmentReasonSchema,
  notes: z.string().trim().max(2000).optional(),
});
export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;
