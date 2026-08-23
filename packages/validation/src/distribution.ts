import { z } from 'zod';

/**
 * Shared validation schemas for the Distribution domain (Sprint 5, docs/domains/
 * distribution.md) — Dispatch (physical release of already-fulfilled goods) and
 * Delivery (confirmation of what actually arrived). Split into its own file, same
 * "one file per domain" convention as `sales.ts`/`production.ts`/`retail.ts`.
 *
 * Neither `createDispatchSchema` nor `createDeliverySchema` has any notion of stock
 * deduction — Sales Fulfilment (Sprint 4.9) remains the sole inventory-moving write in
 * this codebase.
 */

export const dispatchStatusSchema = z.enum([
  'READY',
  'DISPATCHED',
  'IN_TRANSIT',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
]);
export type DispatchStatusInput = z.infer<typeof dispatchStatusSchema>;

/** Rejects a dispatch item list containing the same `salesFulfilmentItemId` more than
 *  once — same pattern as `hasNoDuplicateFulfilmentItems`. */
function hasNoDuplicateDispatchItems(items: { salesFulfilmentItemId: string }[]): boolean {
  const ids = items.map((item) => item.salesFulfilmentItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /distribution` request. `productId` is deliberately absent — the
 *  server resolves it from `salesFulfilmentItemId`, never trusted from the client (same
 *  rule as `salesFulfilmentItemInputSchema`'s omitted `productId`). */
export const dispatchItemInputSchema = z.object({
  salesFulfilmentItemId: z.string().trim().min(1, 'Fulfilment line is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
});
export type DispatchItemInput = z.infer<typeof dispatchItemInputSchema>;

/**
 * `POST /api/distribution` (Sprint 5) — creates a Dispatch from an existing
 * SalesFulfilment. `dispatchCode`/`status`/`customerId` are absent — server-generated/
 * derived/resolved from the fulfilment's own Sales Order. `outletId` is optional
 * (defaults from the Sales Order) but, when supplied, must belong to the same customer
 * (service-enforced). `idempotencyKey` is optional, client-generated, reused across
 * retries of the same submit action.
 */
export const createDispatchSchema = z
  .object({
    salesFulfilmentId: z.string().trim().min(1, 'Sales fulfilment is required'),
    outletId: z.string().trim().min(1).optional(),
    sourceLocationId: z.string().trim().min(1, 'Source location is required'),
    dispatchDate: z.coerce.date(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(dispatchItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateDispatchItems(data.items), {
    message: 'Duplicate fulfilment lines are not allowed on the same dispatch',
    path: ['items'],
  });
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

/** `POST /:id/fail` — an explanation is always required ("goods dispatched but the
 *  customer could not receive them" is never self-explanatory). */
export const failDispatchSchema = z.object({
  notes: z.string().trim().min(1, 'An explanation is required').max(2000),
});
export type FailDispatchInput = z.infer<typeof failDispatchSchema>;

/** Rejects a delivery item list containing the same `dispatchItemId` more than once. */
function hasNoDuplicateDeliveryItems(items: { dispatchItemId: string }[]): boolean {
  const ids = items.map((item) => item.dispatchItemId);
  return new Set(ids).size === ids.length;
}

/** One line of a `POST /:id/deliveries` request. `productId` is absent — resolved from
 *  `dispatchItemId`, same convention as `dispatchItemInputSchema`. */
export const deliveryItemInputSchema = z.object({
  dispatchItemId: z.string().trim().min(1, 'Dispatch line is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
});
export type DeliveryItemInput = z.infer<typeof deliveryItemInputSchema>;

/**
 * `POST /api/distribution/:id/deliveries` (Sprint 5) — records what actually arrived,
 * supporting partial/short delivery: `items` need not sum to the dispatch's full
 * quantity, and `notes` captures why (damaged/lost/refused/etc.) when it doesn't.
 */
export const createDeliverySchema = z
  .object({
    deliveryDate: z.coerce.date(),
    receivedByName: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
    items: z.array(deliveryItemInputSchema).min(1, 'At least one item is required'),
  })
  .refine((data) => hasNoDuplicateDeliveryItems(data.items), {
    message: 'Duplicate dispatch lines are not allowed on the same delivery',
    path: ['items'],
  });
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
