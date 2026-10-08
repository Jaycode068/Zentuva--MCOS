/**
 * Audit action strings for `ConsumerWhatsAppDelivery` (Sprint 43,
 * docs/domains/d2c.md). Same `<entity>.<event>` naming convention as every other
 * domain's `*_AUDIT_ACTIONS` map (e.g.
 * `COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS`).
 */
export const CONSUMER_WHATSAPP_DELIVERY_AUDIT_ACTIONS = {
  /** An operator manually retried a failed consumer notification — business-critical
   *  per brief §Phase 14, always audited. */
  RETRIED: 'consumer_whatsapp_delivery.retried',
} as const;
