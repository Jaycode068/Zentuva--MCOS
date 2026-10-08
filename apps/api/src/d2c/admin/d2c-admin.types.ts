/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). Result shapes only — every underlying read is composed from
 * EXISTING domain services/repositories (`SalesOrder`, `Consumer`,
 * `CollectionPointFulfillment`, `Outlet`, `Territory`); this module owns no table of its
 * own and introduces no parallel D2C order/Exception entity.
 */

/** Sprint 43 — the canonical exception-item shape now lives in
 *  `d2c/operations/d2c-operational-exceptions.types.ts` (shared with
 *  `FieldD2COverviewService`'s territory-scoped view); re-exported here under its
 *  original Sprint 39 name so this module's existing consumers (the frontend
 *  dashboard's "Attention Required" section) see no contract change. */
import type { D2CExceptionItem } from '../operations/d2c-operational-exceptions.types';

export type D2CAttentionItem = D2CExceptionItem;

export interface D2CAdminOverview {
  summary: {
    totalD2COrders: number;
    ordersToday: number;
    ordersPreparing: number;
    ordersReadyForCollection: number;
    ordersCollectedToday: number;
    consumersTotal: number;
    activeConsumers: number;
    newConsumersToday: number;
    activeCollectionPoints: number;
    pendingPayments: number;
    failedPayments: number;
    unassignedOrders: number;
    exceptionsCount: number;
    whatsappSentToday: number;
    whatsappFailedToday: number;
    whatsappEligibleForRetry: number;
  };
  attention: D2CExceptionItem[];
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
