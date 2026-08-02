/**
 * Audit action strings for the Product Catalogue (Sprint 4.1 brief: "Record: Product
 * Created, Product Updated, Product Activated, Product Archived, Product Image Uploaded,
 * Product Image Removed"). Same `<entity>.<event>` naming convention as
 * `USER_AUDIT_ACTIONS`/`WORKSPACE_AUDIT_ACTIONS`.
 */
export const PRODUCT_AUDIT_ACTIONS = {
  CREATED: 'product.created',
  UPDATED: 'product.updated',
  ACTIVATED: 'product.activated',
  ARCHIVED: 'product.archived',
  IMAGE_UPLOADED: 'product.image.uploaded',
  IMAGE_REMOVED: 'product.image.removed',
} as const;
