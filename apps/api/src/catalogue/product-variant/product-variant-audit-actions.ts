/**
 * Audit action strings for `ProductVariant` (Sprint 4.7, docs/domains/catalogue.md). Same
 * `<entity>.<event>` naming convention as `PRODUCT_AUDIT_ACTIONS`/
 * `PRODUCT_FAMILY_AUDIT_ACTIONS`.
 */
export const PRODUCT_VARIANT_AUDIT_ACTIONS = {
  CREATED: 'product-variant.created',
  UPDATED: 'product-variant.updated',
} as const;
