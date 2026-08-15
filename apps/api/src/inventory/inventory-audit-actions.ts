/**
 * Audit action strings for Inventory (Sprint 4.4 brief: "Record: Goods Received,
 * Inventory Increased"; extended Sprint 4.4.1 brief §14 with the discrepancy/replacement
 * lifecycle). `GOODS_RECEIVED` and `INVENTORY_INCREASED` are recorded on every
 * `POST /api/inventory/goods-receipts` call; `DISCREPANCY_RECORDED` and
 * `REPLACEMENT_RECEIVED` are recorded on that same call only when they apply (a
 * rejection occurred / this isn't the first receipt against the Purchase Order);
 * `RESOLVED` is recorded separately, on `PATCH .../discrepancy` when the discrepancy
 * status is set to `RESOLVED`. Same `<entity>.<event>` naming convention as
 * `PURCHASE_ORDER_AUDIT_ACTIONS`/`SUPPLIER_AUDIT_ACTIONS`.
 */
export const INVENTORY_AUDIT_ACTIONS = {
  GOODS_RECEIVED: 'goods-receipt.received',
  DISCREPANCY_RECORDED: 'goods-receipt.discrepancy-recorded',
  REPLACEMENT_RECEIVED: 'goods-receipt.replacement-received',
  RESOLVED: 'goods-receipt.resolved',
  INVENTORY_INCREASED: 'inventory.increased',
} as const;
