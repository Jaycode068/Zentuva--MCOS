/**
 * Foundational multi-tenancy context, shared by every domain module.
 * Zentuva uses a shared-database, discriminator-column multi-tenancy model (see ADR-003).
 */
export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}
