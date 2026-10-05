import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 37 — Collection Point Fulfillment (docs/domains/d2c.md). Field-only feature —
 * there is no admin-settings equivalent screen this sprint (brief "ADMIN EXPERIENCE":
 * admin gets read-only visibility via the existing Outlet edit dialog, not a duplicate
 * operational screen).
 */

export type CollectionPointFulfillmentStatus =
  'ASSIGNED' | 'PREPARING' | 'READY_FOR_COLLECTION' | 'COLLECTED';

export interface CollectionPointFulfillment {
  id: string;
  orderReference: string;
  orderDate: string;
  total: number;
  outletId: string;
  outletName: string;
  status: CollectionPointFulfillmentStatus;
  assignedAt: string;
  preparingAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  salesOrderStatus: string;
  /** Added Sprint 38 — derived from the order's most recent `Payment` (`null` only in
   *  the rare case of an admin manual-assignment against an order with no payment row
   *  at all). */
  paymentStatus: string | null;
  paidAt: string | null;
  consumer: { name: string; phoneNumber: string; territoryName: string | null } | null;
  items: { productName: string; quantity: number; unit: string }[];
}

export interface MyCollectionPointOutlet {
  id: string;
  name: string;
}

/** Added Sprint 38 — the Field Collection Point inventory view (brief §10): "do I have
 *  enough on hand for what's queued." Read-only, operational only — never a full
 *  inventory management surface. */
export interface CollectionPointInventoryRow {
  productId: string;
  productName: string;
  unit: string;
  available: number;
  required: number;
  shortfall: number;
  status: 'SUFFICIENT' | 'SHORT';
}

export function listMyCollectionPointOutlets(): Promise<{ items: MyCollectionPointOutlet[] }> {
  return apiFetch<{ items: MyCollectionPointOutlet[] }>(
    '/d2c/collection-point-fulfillments/my-outlets',
  );
}

export function listCollectionPointQueue(
  outletId: string,
): Promise<{ items: CollectionPointFulfillment[] }> {
  return apiFetch<{ items: CollectionPointFulfillment[] }>(
    `/d2c/collection-point-fulfillments/outlet/${outletId}`,
  );
}

export function getCollectionPointFulfillment(id: string): Promise<CollectionPointFulfillment> {
  return apiFetch<CollectionPointFulfillment>(`/d2c/collection-point-fulfillments/${id}`);
}

export function getCollectionPointInventory(
  outletId: string,
): Promise<{ items: CollectionPointInventoryRow[] }> {
  return apiFetch<{ items: CollectionPointInventoryRow[] }>(
    `/d2c/collection-point-fulfillments/outlet/${outletId}/inventory`,
  );
}

export function startPreparing(id: string): Promise<CollectionPointFulfillment> {
  return apiFetch<CollectionPointFulfillment>(
    `/d2c/collection-point-fulfillments/${id}/start-preparing`,
    { method: 'POST' },
  );
}

export function markReadyForCollection(id: string): Promise<CollectionPointFulfillment> {
  return apiFetch<CollectionPointFulfillment>(
    `/d2c/collection-point-fulfillments/${id}/ready-for-collection`,
    { method: 'POST' },
  );
}

export function confirmCollection(id: string): Promise<CollectionPointFulfillment> {
  return apiFetch<CollectionPointFulfillment>(
    `/d2c/collection-point-fulfillments/${id}/confirm-collection`,
    { method: 'POST' },
  );
}
