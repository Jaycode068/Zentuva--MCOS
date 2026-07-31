/**
 * Audit action strings for Organisation Management (Sprint 2.1). `organisation.updated`
 * matches docs/domains/identity.md §8's audit event table exactly — no discrepancy to
 * reconcile here.
 */
export const ORGANISATION_AUDIT_ACTIONS = {
  UPDATED: 'organisation.updated',
} as const;
