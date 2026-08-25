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
  /** Added Sprint 8 — recorded only when `POST /goods-receipts` actually posted a
   *  Journal Entry (i.e. something was accepted), only on a fresh receipt (never on an
   *  idempotent replay). Kept in this file's own `goods-receipt.*` namespace, not
   *  Finance's `journal-entry.posted` (which is scoped to the *manual* journal-entry
   *  controller's own `/post` action, a different call site) — see
   *  docs/domains/accounting.md "Goods Receipt Posting". */
  JOURNAL_ENTRY_POSTED: 'goods-receipt.journal-entry-posted',
  /** Sprint 4.5 brief's explicit event list — one event per manual correction,
   *  recorded on every `POST /api/inventory/adjustments` regardless of direction
   *  (increase or decrease), same "no duplicate events" instruction as the rest of
   *  this file. */
  ADJUSTED: 'inventory.adjusted',
  LOCATION_CREATED: 'inventory.location.created',
  LOCATION_UPDATED: 'inventory.location.updated',
  LOCATION_DEACTIVATED: 'inventory.location.deactivated',
} as const;
