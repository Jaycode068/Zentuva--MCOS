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
  consumer: { name: string; phoneNumber: string } | null;
  items: { productName: string; quantity: number; unit: string }[];
}

export interface MyCollectionPointOutlet {
  id: string;
  name: string;
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
