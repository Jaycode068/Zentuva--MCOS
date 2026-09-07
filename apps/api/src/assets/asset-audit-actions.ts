/**
 * Audit action strings for Sprint 20's Asset Register & Asset Management
 * Foundation (docs/domains/assets.md) — `AssetCategory`, `AssetLocation`,
 * `Asset`, `AssetDocument`, `AssetMovement`, `AssetMeter`/
 * `AssetMeterReading`. Same `<entity>.<event>` naming convention as
 * `capital-project-audit-actions.ts`/`debt-audit-actions.ts`.
 */
export const ASSET_AUDIT_ACTIONS = {
  ASSET_CATEGORY_CREATED: 'asset-category.created',
  ASSET_CATEGORY_UPDATED: 'asset-category.updated',
  ASSET_CATEGORY_ACTIVATED: 'asset-category.activated',
  ASSET_CATEGORY_DEACTIVATED: 'asset-category.deactivated',
  ASSET_LOCATION_CREATED: 'asset-location.created',
  ASSET_LOCATION_UPDATED: 'asset-location.updated',
  ASSET_LOCATION_ACTIVATED: 'asset-location.activated',
  ASSET_LOCATION_DEACTIVATED: 'asset-location.deactivated',
  ASSET_CREATED: 'asset.created',
  ASSET_UPDATED: 'asset.updated',
  ASSET_ACTIVATED: 'asset.activated',
  ASSET_COMMISSIONED: 'asset.commissioned',
  ASSET_STATUS_CHANGED: 'asset.status-changed',
  ASSET_TRANSFERRED: 'asset.transferred',
  ASSET_DISPOSED: 'asset.disposed',
  ASSET_RETIRED: 'asset.retired',
  ASSET_IMAGE_UPLOADED: 'asset.image-uploaded',
  ASSET_IMAGE_REMOVED: 'asset.image-removed',
  ASSET_DOCUMENT_ADDED: 'asset-document.added',
  ASSET_DOCUMENT_REMOVED: 'asset-document.removed',
  ASSET_METER_CREATED: 'asset-meter.created',
  ASSET_METER_READING_RECORDED: 'asset-meter-reading.recorded',
} as const;
