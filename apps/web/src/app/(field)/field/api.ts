/**
 * Field Sales re-exports the exact same backend-facing functions the Admin surface uses
 * (`settings/retail/api.ts`, `settings/sales/api.ts`, `settings/products/api.ts`) rather
 * than duplicating fetch logic — both UX surfaces share one backend API, per Sprint 4.8
 * brief §4 ("The underlying APIs/domain services should be shared"). This file exists
 * only so Field Sales screens have one shorter import path and so the field-specific
 * `captureCoordinates` re-export sits alongside them.
 */
export * from '@/app/(app)/settings/retail/api';
export * from '@/app/(app)/settings/sales/api';
export * from '@/app/(app)/settings/distribution/api';
export * from '@/app/(app)/settings/returns/api';
// Sprint 22 — the Field Technician Maintenance surface (docs/domains/
// maintenance-integration.md) reuses the exact same Maintenance API every
// Admin Work Order screen already calls — no separate mobile endpoint.
export * from '@/app/(app)/settings/maintenance/api';
export { listProducts } from '@/app/(app)/settings/products/api';
export {
  getInventoryStockByProduct,
  listInventoryLocations,
} from '@/app/(app)/settings/inventory/api';
export { getAsset, recordAssetMeterReading } from '@/app/(app)/settings/assets/api';
export { captureCoordinates } from '@/lib/geolocation';
