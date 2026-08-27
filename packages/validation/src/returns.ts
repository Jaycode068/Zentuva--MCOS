import { z } from 'zod';

import { rejectionReasonSchema } from './inventory';

/**
 * Shared validation schemas for the Sprint 11 "Returns, Claims & Reversals Foundation"
 * (docs/domains/sales.md "Customer Returns", docs/domains/procurement.md "Supplier
 * Returns"). Split into its own file, same "one file per domain" convention as
 * `inventory.ts`/`sales.ts`/`procurement.ts` — this one spans two domains (Sales owns
 * Customer Returns, Inventory owns Supplier Returns) since both share the same small
 * return-reason/photo/idempotency shape.
 */

/** Brief §6 — a controlled reason plus free-text `reasonNotes`, not a full claims
 *  taxonomy. */
export const customerReturnReasonSchema = z.enum([
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'WRONG_QUANTITY',
  'CUSTOMER_REJECTED',
  'QUALITY_ISSUE',
  'EXPIRED',
  'OTHER',
]);
export type CustomerReturnReasonInput = z.infer<typeof customerReturnReasonSchema>;

export const customerReturnStatusSchema = z.enum(['REQUESTED', 'RECEIVED', 'CANCELLED']);
export type CustomerReturnStatusInput = z.infer<typeof customerReturnStatusSchema>;

/** Same duplicate-line guard convention as `sales.ts`'s own
 *  `hasNoDuplicateFulfilmentItems`. */
function hasNoDuplicateFulfilmentItemRefs(items: { salesFulfilmentItemId: string }[]): boolean {
  const ids = items.map((item) => item.salesFulfilmentItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /customer-returns` request — always against a specific
 *  `SalesFulfilmentItem` (brief §12: never guess cost from the order alone).
 *  `productId`/`unitCost`/`unitPrice` are deliberately absent — the server resolves and
 *  snapshots them from the referenced fulfilment/order line. */
export const customerReturnItemInputSchema = z.object({
  salesFulfilmentItemId: z.string().trim().min(1, 'Fulfilment item is required'),
  quantityReturned: z.number().positive('Quantity must be greater than zero'),
});
export type CustomerReturnItemInput = z.infer<typeof customerReturnItemInputSchema>;

/**
 * `POST /api/sales/customer-returns` (Sprint 11 brief §5) — the *request* step only, no
 * inventory/accounting effect (brief §32). `salesOrderId` anchors the whole return;
 * `locationId` is where the goods will physically be received once `receive()` runs.
 */
export const createCustomerReturnSchema = z
  .object({
    salesOrderId: z.string().trim().min(1, 'Sales order is required'),
    locationId: z.string().trim().min(1, 'Receiving location is required'),
    returnDate: z.coerce.date(),
    reason: customerReturnReasonSchema,
    reasonNotes: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(customerReturnItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateFulfilmentItemRefs(data.items), {
    message: 'Duplicate fulfilment items are not allowed on the same return',
    path: ['items'],
  });
export type CreateCustomerReturnInput = z.infer<typeof createCustomerReturnSchema>;

/** One line of a `POST /customer-returns/:id/receive` request — the disposition
 *  breakdown (brief §7/§8), which must sum to that item's own `quantityReturned`
 *  (service-enforced, needs the stored row). `quantityCredited` is optional —
 *  defaults server-side to the item's `quantityReturned` (brief §36: never assume
 *  credit equals the resalable quantity, but a full refund is the sensible default). */
export const receiveCustomerReturnItemInputSchema = z.object({
  customerReturnItemId: z.string().trim().min(1, 'Return item is required'),
  quantityResalable: z.number().nonnegative().default(0),
  quantityDamaged: z.number().nonnegative().default(0),
  quantityQuarantine: z.number().nonnegative().default(0),
  quantityScrap: z.number().nonnegative().default(0),
  quantityCredited: z.number().nonnegative().optional(),
});
export type ReceiveCustomerReturnItemInput = z.infer<typeof receiveCustomerReturnItemInputSchema>;

/** `POST /api/sales/customer-returns/:id/receive` (Sprint 11 brief §31/§32) — the one
 *  atomic physical+financial event: disposition, inventory movement, COGS reversal,
 *  Credit Note. */
export const receiveCustomerReturnSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
  items: z.array(receiveCustomerReturnItemInputSchema).min(1, 'At least one item is required'),
});
export type ReceiveCustomerReturnInput = z.infer<typeof receiveCustomerReturnSchema>;

export const supplierReturnStatusSchema = z.enum(['COMPLETED']);
export type SupplierReturnStatusInput = z.infer<typeof supplierReturnStatusSchema>;

function hasNoDuplicateGoodsReceiptItemRefs(items: { goodsReceiptItemId: string }[]): boolean {
  const ids = items.map((item) => item.goodsReceiptItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /supplier-returns` request — always against a specific
 *  `GoodsReceiptItem` (needed for the excess-vs-payable allocation, brief §17-19). */
export const supplierReturnItemInputSchema = z.object({
  goodsReceiptItemId: z.string().trim().min(1, 'Goods receipt item is required'),
  quantityReturned: z.number().positive('Quantity must be greater than zero'),
});
export type SupplierReturnItemInput = z.infer<typeof supplierReturnItemInputSchema>;

/**
 * `POST /api/inventory/supplier-returns` (Sprint 11 brief §15-19) — created and posted
 * atomically in one call, no separate request/receive phase (unlike Customer Returns —
 * see docs/domains/procurement.md "Supplier Returns" for why). Reuses
 * `rejectionReasonSchema` (Sprint 4.4.1) rather than a new enum.
 */
export const createSupplierReturnSchema = z
  .object({
    purchaseOrderId: z.string().trim().min(1, 'Purchase order is required'),
    goodsReceiptId: z.string().trim().min(1, 'Goods receipt is required'),
    locationId: z.string().trim().min(1, 'Source location is required'),
    returnDate: z.coerce.date(),
    reason: rejectionReasonSchema,
    reasonNotes: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(supplierReturnItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateGoodsReceiptItemRefs(data.items), {
    message: 'Duplicate goods receipt items are not allowed on the same return',
    path: ['items'],
  });
export type CreateSupplierReturnInput = z.infer<typeof createSupplierReturnSchema>;
