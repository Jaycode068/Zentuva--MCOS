/**
 * Audit action strings for `DistributionNetworkRelationship` (Sprint 4.8,
 * docs/domains/retail-network.md). Same `<entity>.<event>` naming convention as every
 * other domain's `*_AUDIT_ACTIONS`.
 */
export const NETWORK_RELATIONSHIP_AUDIT_ACTIONS = {
  CREATED: 'network-relationship.created',
  UPDATED: 'network-relationship.updated',
  DEACTIVATED: 'network-relationship.deactivated',
} as const;
