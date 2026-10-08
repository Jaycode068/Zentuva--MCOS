/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Operational Exceptions"). Result shapes only — every
 * underlying read is composed from EXISTING domain repositories/services (`SalesOrder`,
 * `CollectionPointFulfillment`, `Outlet`, `ConsumerWhatsAppDelivery`); this module owns
 * no table of its own and introduces no parallel Exception entity. Extracted from
 * `D2CAdminService.computeAttentionItems` (Sprint 39) so the EXACT SAME detection logic
 * can be reused, territory-scoped, by `FieldD2COverviewService` (Sprint 38) — never two
 * independently-maintained copies of "what counts as stuck."
 */

export type D2CExceptionCategory = 'INFORMATION' | 'ACTION_REQUIRED';

/** A rough operator-triage signal, not a precise SLA calculation — brief §Phase 6
 *  requires it be shown, never that it be computed by a scoring engine. `HIGH` = money
 *  or a consumer-facing promise at risk (failed payment, failed notification after a
 *  state the consumer was told about, a long-stuck order); `MEDIUM` = needs a human
 *  decision soon but nothing is yet broken (unassigned, disabled Collection Point with
 *  a queue); `LOW` = informational / early warning (a payment still mid-checkout). */
export type D2CExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type D2CExceptionType =
  | 'UNASSIGNED_ORDER'
  | 'FAILED_PAYMENT'
  | 'STALE_PENDING_PAYMENT'
  | 'STUCK_FULFILLMENT'
  | 'STUCK_READY_FOR_COLLECTION'
  | 'DISABLED_COLLECTION_POINT_WITH_QUEUE'
  | 'NOTIFICATION_FAILED';

/** A single row in the "Attention Required" / Exceptions view — always derived live
 *  from existing data, never a persisted Exception record (brief: "don't create a fake
 *  Exception entity unless proven necessary" — it wasn't). `entityType`/`entityId` let
 *  the frontend deep-link straight to the record this exception is actually about. */
export interface D2CExceptionItem {
  category: D2CExceptionCategory;
  type: D2CExceptionType;
  severity: D2CExceptionSeverity;
  message: string;
  entityType: 'SalesOrder' | 'CollectionPointFulfillment' | 'Outlet' | 'ConsumerWhatsAppDelivery';
  entityId: string;
  /** When this exception was DETECTED (the moment this computation ran), never a
   *  persisted "exception created at" — there is no such row. */
  detectedAt: Date;
  orderCode?: string | null;
  consumerName?: string | null;
  territoryName?: string | null;
  collectionPointName?: string | null;
}

/** `territoryId` scopes every check to one territory's data only — used by
 *  `FieldD2COverviewService` for a field rep's own territory-scoped view. `undefined`
 *  (the default, used by `D2CAdminService`) means organisation-wide. This service
 *  performs NO authorization of its own — exactly like the private method it was
 *  extracted from, it trusts the CALLER to have already authorized the actor for
 *  whichever scope is passed in (`D2CAdminService.assertAdmin` /
 *  `FieldD2COverviewService.resolveTerritoryScope`), never re-deriving or re-checking
 *  access itself. */
export interface D2CExceptionScope {
  territoryId?: string;
}
