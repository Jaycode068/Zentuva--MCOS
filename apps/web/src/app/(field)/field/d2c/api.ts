import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). Field-only feature — a Sales Representative's own
 * territory-scoped D2C overview. Territory scoping is enforced entirely server-side
 * (`FieldD2COverviewService`); this client never sends a territoryId and never filters
 * client-side for authorization purposes.
 */

export interface FieldD2COrder {
  id: string;
  orderCode: string;
  orderDate: string;
  total: number;
  status: string;
  consumer: { name: string; territoryName: string | null } | null;
  collectionPoint: {
    outletId: string;
    outletName: string;
    fulfillmentStatus: string;
    assignedAt: string;
  } | null;
}

export interface FieldD2CCollectionPoint {
  outletId: string;
  outletName: string;
  territoryName: string | null;
  collectionPointStatus: string;
  responsibleUserId: string | null;
  operatingHours: string | null;
  ordersAwaitingFulfilment: number;
  ordersReadyForCollection: number;
}

export function listFieldD2COrders(): Promise<{ items: FieldD2COrder[] }> {
  return apiFetch<{ items: FieldD2COrder[] }>('/d2c/field-overview/orders');
}

export function listFieldD2CCollectionPoints(): Promise<{ items: FieldD2CCollectionPoint[] }> {
  return apiFetch<{ items: FieldD2CCollectionPoint[] }>('/d2c/field-overview/collection-points');
}

/** Added Sprint 43 — D2C Operations, Notifications & Production Hardening. The SAME
 *  exception shape the admin dashboard's "Attention Required" section uses
 *  (`D2COperationalExceptionsService`), scoped to this rep's own territory. */
export interface FieldD2CException {
  category: 'INFORMATION' | 'ACTION_REQUIRED';
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  entityType: 'SalesOrder' | 'CollectionPointFulfillment' | 'Outlet' | 'ConsumerWhatsAppDelivery';
  entityId: string;
  detectedAt: string;
  orderCode?: string | null;
  consumerName?: string | null;
  territoryName?: string | null;
  collectionPointName?: string | null;
}

export function listFieldD2CExceptions(): Promise<{ items: FieldD2CException[] }> {
  return apiFetch<{ items: FieldD2CException[] }>('/d2c/field-overview/exceptions');
}
