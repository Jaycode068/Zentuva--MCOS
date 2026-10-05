/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). Result shapes only — every underlying read is composed from
 * EXISTING domain services/repositories (`SalesOrder`, `Consumer`,
 * `CollectionPointFulfillment`, `Outlet`, `Territory`); this module owns no table of its
 * own and introduces no parallel D2C order/Exception entity.
 */

export type AttentionCategory = 'INFORMATION' | 'ACTION_REQUIRED';

/** A single row in the "Attention Required" section — always derived live from
 *  existing data (brief: "don't create a fake Exception entity unless proven
 *  necessary" — it wasn't; every case here is a plain filter/age-check over data that
 *  already exists). `entityType`/`entityId` let the frontend deep-link straight to the
 *  record (an order, a Collection Point, nothing else). */
export interface D2CAttentionItem {
  category: AttentionCategory;
  type:
    | 'UNASSIGNED_ORDER'
    | 'UNPAID_ORDER'
    | 'FAILED_PAYMENT'
    | 'STUCK_FULFILLMENT'
    | 'DISABLED_COLLECTION_POINT_WITH_QUEUE';
  message: string;
  entityType: 'SalesOrder' | 'CollectionPointFulfillment' | 'Outlet';
  entityId: string;
}

export interface D2CAdminOverview {
  summary: {
    totalD2COrders: number;
    consumersTotal: number;
    activeCollectionPoints: number;
    pendingPayments: number;
    failedPayments: number;
    unassignedOrders: number;
  };
  attention: D2CAttentionItem[];
  recentOrders: {
    id: string;
    orderCode: string;
    consumerName: string | null;
    status: string;
    total: number;
    orderDate: Date;
  }[];
}

export interface D2CTerritorySummaryRow {
  territoryId: string;
  territoryName: string;
  consumerCount: number;
  d2cOrderCount: number;
  collectionPointCount: number;
  enabledCollectionPointCount: number;
}
