import { z } from 'zod';

/**
 * Shared validation schemas for the Procurement domain (Sprint 4.3), matching the API
 * contract in docs/domains/procurement.md. Split into its own file (not appended to
 * suppliers.ts/catalogue.ts) since Procurement is a distinct domain module (ADR-002) —
 * same "one file per domain" convention those files established.
 *
 * The status enum schema mirrors `apps/api/prisma/schema.prisma`'s `PurchaseOrderStatus`
 * as a plain string literal rather than importing `@prisma/client` here — this package is
 * shared by `apps/web` too, same rationale as `catalogue.ts`/`suppliers.ts`.
 */

export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'CANCELLED',
  'RECEIVED',
]);
export type PurchaseOrderStatusInput = z.infer<typeof purchaseOrderStatusSchema>;

/** A single line of a Purchase Order. `lineTotal` is deliberately absent — the server
 *  always computes it as `quantity * unitPrice` (Sprint 4.3 brief: "Never trust frontend
 *  calculations"). */
export const purchaseOrderItemInputSchema = z.object({
  productId: z.string().trim().min(1, 'Product is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),
});
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemInputSchema>;

/**
 * `POST /api/procurement/purchase-orders` (Sprint 4.3 brief). `purchaseOrderNumber` is
 * deliberately absent — always server-generated, immutable, never accepted on input.
 * `status`/`subtotal`/`total`/`approvedById` are also absent: new purchase orders always
 * start `DRAFT` (no create-time status field, matching the brief's Create dialog field
 * list, which has no Status control), and totals are always server-calculated, never
 * trusted from the client.
 */
export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1, 'Supplier is required'),
  orderDate: z.coerce.date(),
  expectedDeliveryDate: z.coerce.date().optional(),
  remarks: z.string().trim().max(2000).optional(),
  items: z.array(purchaseOrderItemInputSchema).min(1, 'At least one item is required'),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/**
 * `PATCH /api/procurement/purchase-orders/:id` (Sprint 4.3 brief) — every field optional,
 * same "partial update" convention as `updateSupplierSchema`/`updateProductSchema`.
 * `purchaseOrderNumber` is absent for the same reason as {@link createPurchaseOrderSchema}.
 *
 * `status` is restricted to `DRAFT`/`PENDING` only — reaching `CANCELLED` requires the
 * dedicated `POST /:id/cancel` endpoint (keeping cancellation a distinct, intentional,
 * separately-audited action, same reasoning `ProductService` keeps activate/archive off
 * the generic update path), and `APPROVED`/`RECEIVED` aren't reachable by any endpoint
 * this sprint (brief: "Do not implement approval workflow"). Sending `items` here
 * replaces the entire item list — there is no line-level PATCH.
 */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1, 'Supplier is required').optional(),
  orderDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  remarks: z.string().trim().max(2000).optional(),
  status: z.enum(['DRAFT', 'PENDING']).optional(),
  items: z.array(purchaseOrderItemInputSchema).min(1, 'At least one item is required').optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
