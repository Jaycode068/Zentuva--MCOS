import { z } from 'zod';

/**
 * Shared validation schemas for the Sales Order domain (Sprint 4.8) and its Fulfilment
 * extension (Sprint 4.9), matching the API contract in docs/domains/sales.md. Split into
 * its own file, same "one file per domain" convention as `production.ts`/`retail.ts`.
 *
 * Creating or confirming a Sales Order never touches inventory — nothing in
 * `createSalesOrderSchema`/`updateSalesOrderSchema` (or the service that consumes them)
 * has any notion of stock reservation or deduction. `createSalesFulfilmentSchema` below
 * is the one schema in this file that backs an inventory-moving write.
 */

export const salesOrderStatusSchema = z.enum([
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
]);
export type SalesOrderStatusInput = z.infer<typeof salesOrderStatusSchema>;

/** Rejects an item list containing the same `productId` more than once — same pattern as
 *  `production.ts`'s `hasNoDuplicateComponents`. */
function hasNoDuplicateProducts(items: { productId: string }[]): boolean {
  const ids = items.map((item) => item.productId);
  return new Set(ids).size === ids.length;
}

/** `lineTotal` is deliberately absent — always computed server-side as
 *  `quantity * unitPrice`, never accepted from the client (same rule as
 *  `completeProductionOrderSchema`'s omitted `acceptedQuantity`). */
export const salesOrderItemInputSchema = z.object({
  productId: z.string().trim().min(1, 'Product is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),
});
export type SalesOrderItemInput = z.infer<typeof salesOrderItemInputSchema>;

/**
 * `POST /api/sales/orders` (Sprint 4.8 brief §17/§32). `orderCode`/`salesAgentId`/
 * `status`/`subtotal`/`total` are all absent — server-generated/derived/computed.
 * `outletId` is optional (brief §17: "optional initially if architecture requires") but,
 * when supplied, must belong to the same `customerId` — service-enforced, since that
 * coherence check needs a live tenant-scoped lookup this schema can't perform.
 */
export const createSalesOrderSchema = z
  .object({
    customerId: z.string().trim().min(1, 'Customer is required'),
    outletId: z.string().trim().min(1).optional(),
    orderDate: z.coerce.date(),
    discount: z.number().nonnegative('Discount cannot be negative').default(0),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(salesOrderItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateProducts(data.items), {
    message: 'Duplicate products are not allowed on the same sales order',
    path: ['items'],
  });
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;

/** `PATCH /api/sales/orders/:id` — only reachable while `status === DRAFT`
 *  (service-enforced). `customerId` is absent — not changeable after creation (cancel
 *  and create a new order for a different customer instead). */
export const updateSalesOrderSchema = z
  .object({
    outletId: z.string().trim().min(1).nullable().optional(),
    orderDate: z.coerce.date().optional(),
    discount: z.number().nonnegative('Discount cannot be negative').optional(),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(salesOrderItemInputSchema).min(1, 'At least one item is required').optional(),
  })
  .refine((data) => !data.items || hasNoDuplicateProducts(data.items), {
    message: 'Duplicate products are not allowed on the same sales order',
    path: ['items'],
  });
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

/** Rejects a fulfilment item list containing the same `salesOrderItemId` more than once —
 *  same pattern as `hasNoDuplicateProducts`. */
function hasNoDuplicateFulfilmentItems(items: { salesOrderItemId: string }[]): boolean {
  const ids = items.map((item) => item.salesOrderItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /:id/fulfil` request. `productId` is deliberately absent — the
 *  server resolves it from `salesOrderItemId`, never trusted from the client (same rule
 *  as `salesOrderItemInputSchema`'s omitted `lineTotal`). */
export const salesFulfilmentItemInputSchema = z.object({
  salesOrderItemId: z.string().trim().min(1, 'Sales order item is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
});
export type SalesFulfilmentItemInput = z.infer<typeof salesFulfilmentItemInputSchema>;

/**
 * `POST /api/sales/orders/:id/fulfil` (Sprint 4.9) — the one write in this domain that
 * actually moves inventory (docs/domains/sales.md "Fulfilment"). `idempotencyKey` is
 * optional, client-generated (e.g. `crypto.randomUUID()`), reused across retries of the
 * same submit action so a double-tap or flaky-network retry never double-deducts stock.
 */
export const createSalesFulfilmentSchema = z
  .object({
    locationId: z.string().trim().min(1, 'Location is required'),
    fulfilmentDate: z.coerce.date(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(salesFulfilmentItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateFulfilmentItems(data.items), {
    message: 'Duplicate order lines are not allowed on the same fulfilment',
    path: ['items'],
  });
export type CreateSalesFulfilmentInput = z.infer<typeof createSalesFulfilmentSchema>;
