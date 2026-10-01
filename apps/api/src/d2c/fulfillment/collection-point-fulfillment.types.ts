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
  consumer: { name: string; phoneNumber: string } | null;
  items: { productName: string; quantity: number; unit: string }[];
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
