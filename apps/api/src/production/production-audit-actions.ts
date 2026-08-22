/**
 * Audit action strings for Production (Sprint 4.6 brief §33), matching the brief's own
 * suggested list plus one addition (`FINISHED_GOODS_RECEIVED`, mirroring Inventory's own
 * `GOODS_RECEIVED`/`INVENTORY_INCREASED` split — see docs/domains/production.md
 * "Audit Events"). Same `<entity>.<event>` kebab-case naming convention as
 * `INVENTORY_AUDIT_ACTIONS`/`PURCHASE_ORDER_AUDIT_ACTIONS`.
 */
export const PRODUCTION_AUDIT_ACTIONS = {
  BOM_CREATED: 'production.bom.created',
  BOM_UPDATED: 'production.bom.updated',
  BOM_ACTIVATED: 'production.bom.activated',
  BOM_DEACTIVATED: 'production.bom.deactivated',
  ORDER_CREATED: 'production.order.created',
  ORDER_UPDATED: 'production.order.updated',
  ORDER_PLANNED: 'production.order.planned',
  /** Recorded conditionally on `POST .../material-issues`, only when that call is what
   *  moved the order from `PLANNED` to `IN_PROGRESS` — there is no separate manual
   *  "Start" endpoint (see `ProductionMaterialIssueRepository.issue`). */
  ORDER_STARTED: 'production.order.started',
  ORDER_CANCELLED: 'production.order.cancelled',
  MATERIAL_ISSUED: 'production.material-issued',
  COMPLETED: 'production.completed',
  /** Recorded conditionally on `POST .../complete`, only when `acceptedQuantity > 0` —
   *  the stock-increase side effect, independently auditable from the order-completion
   *  event itself. */
  FINISHED_GOODS_RECEIVED: 'production.finished-goods-received',
} as const;
