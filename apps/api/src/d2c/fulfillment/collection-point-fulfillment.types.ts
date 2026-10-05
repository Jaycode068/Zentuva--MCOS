/**
 * Sprint 37 — Collection Point Fulfillment & Inventory Reconciliation
 * (docs/domains/d2c.md). Subordinate to the EXISTING `SalesOrder` — never a
 * parallel order entity. Result/error shapes only; the Prisma model itself
 * lives in `apps/api/prisma/schema.prisma` (`CollectionPointFulfillment`).
 */

export type CollectionPointFulfillmentStatusValue =
  'ASSIGNED' | 'PREPARING' | 'READY_FOR_COLLECTION' | 'COLLECTED';

export interface CollectionPointFulfillmentResult {
  id: string;
  /** Added Sprint 39 — the D2C Admin's Collection Points list links each row to the
   *  underlying order detail (`GET /sales/orders/:id`), which needs the `SalesOrder`'s
   *  own id, not this fulfilment row's id. */
  salesOrderId: string;
  orderReference: string;
  orderDate: Date;
  total: number;
  outletId: string;
  outletName: string;
  status: CollectionPointFulfillmentStatusValue;
  assignedAt: Date;
  preparingAt: Date | null;
  readyAt: Date | null;
  collectedAt: Date | null;
  salesOrderStatus: string;
  /** Added Sprint 38 — derived from the most recent `Payment.status`/`.paymentDate` for
   *  this `SalesOrder` (`SalesOrder.payments`, Sprint 35). `null` only in the
   *  theoretical case of an admin manual-assignment against an order with no payment
   *  row at all — never silently defaulted to "paid". */
  paymentStatus: string | null;
  paidAt: Date | null;
  consumer: { name: string; phoneNumber: string; territoryName: string | null } | null;
  items: { productName: string; quantity: number; unit: string }[];
}

/**
 * Added Sprint 38 — Field Operations & Collection Point Mobile Experience. An
 * OPERATIONAL view only (brief §10: "Do not build a full inventory management
 * application inside /field") — read-only, derived entirely from the EXISTING
 * `InventoryStockRepository.findManyByProductsAndLocation` (the same primitive
 * `SalesFulfilmentService.getAvailability` already uses for B2B) and the queued
 * (not yet `COLLECTED`) `CollectionPointFulfillment` rows at one outlet. No new
 * inventory table, no reservation, no mutation — a Collection Point representative
 * preparing orders needs to know "do I have enough on hand for what's queued,"
 * nothing more.
 */
export interface CollectionPointInventoryRow {
  productId: string;
  productName: string;
  unit: string;
  available: number;
  required: number;
  shortfall: number;
  status: 'SUFFICIENT' | 'SHORT';
}

/** No eligible Collection Point exists for this order right now (e.g. no outlet in the
 *  consumer's territory is enabled, or none has an inventory location configured) — a
 *  genuine, expected outcome, not a system error. The order is left `CONFIRMED` with no
 *  `CollectionPointFulfillment` row; a later manual assignment (or automatic retry once a
 *  Collection Point becomes available) is expected. */
export class NoEligibleCollectionPointError extends Error {}

/** The specific outlet named in a manual assignment request is not eligible (inactive,
 *  Collection Point disabled, wrong tenant, no inventory location, wrong territory). */
export class CollectionPointNotEligibleError extends Error {}

/** This order already has a `CollectionPointFulfillment` row — assignment is one-shot this
 *  sprint (brief §4: "reassignment, if supported" was left optional and not built). */
export class AlreadyAssignedError extends Error {}

/** The caller is authenticated and tenant-scoped correctly, but is neither the assigned
 *  Collection Point's `collectionPointResponsibleUserId` nor holds `sales.customer.manage`
 *  (docs/domains/d2c.md "Authorization"). */
export class NotAuthorizedForCollectionPointError extends Error {}

/** A transition was attempted from a status that doesn't allow it (e.g. confirming
 *  collection on an order still `ASSIGNED`, never `READY_FOR_COLLECTION`) — the guarded,
 *  no-arbitrary-edit state machine (brief §10) rejecting an out-of-order request. */
export class InvalidFulfillmentTransitionError extends Error {}
