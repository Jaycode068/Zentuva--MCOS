/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). Result shapes only — this is a READ-ONLY aggregation layer
 * over the EXISTING D2C/Sales/Outlet/Collection-Point domains, never a new business
 * entity. A field Sales Representative's own operational overview: which D2C orders
 * and which Collection Points fall within their territory.
 */

export interface FieldD2COrderResult {
  id: string;
  orderCode: string;
  orderDate: Date;
  total: number;
  /** The order's own `SalesOrderStatus` (CONFIRMED/PARTIALLY_FULFILLED/FULFILLED/
   *  CANCELLED) — deliberately NOT a separate "payment status" field here: fetching it
   *  would require widening `SalesOrderRepository`'s shared `RELATIONS_INCLUDE` with a
   *  `payments` join used by every B2B caller of this repository too, for a field only
   *  this one list view needs. The richer `CollectionPointFulfillmentResult` (the order
   *  DETAIL a Collection Point representative opens) already carries real
   *  `paymentStatus`/`paidAt` — scoped narrowly to where it matters most. See
   *  docs/sprint-38-completion-report.md "Known Limitations". */
  status: string;
  consumer: { name: string; territoryName: string | null } | null;
  collectionPoint: {
    outletId: string;
    outletName: string;
    fulfillmentStatus: string;
    assignedAt: Date;
  } | null;
}

export interface FieldD2CCollectionPointResult {
  outletId: string;
  outletName: string;
  territoryName: string | null;
  collectionPointStatus: string;
  responsibleUserId: string | null;
  operatingHours: string | null;
  ordersAwaitingFulfilment: number;
  ordersReadyForCollection: number;
}
