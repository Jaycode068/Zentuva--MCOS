import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares which permission key a route requires, checked by {@link PermissionsGuard}
 * (docs/domains/access-control.md §9). Sprint 25's fine-grained successor to `@Roles`
 * for the curated set of high-risk endpoints migrated this sprint — see
 * access-control.md §10 for exactly which ones, and which endpoints deliberately still
 * use the older role-name check.
 *
 * Unlike `@Roles`, this never hardcodes a role name — access is decided entirely by
 * `EffectiveAccessResolver` from the caller's actual role/permission grants (Owner's
 * bypass is the one intentional exception, itself resolved by the resolver, not this
 * decorator). This checks *module+action* access only ("is `finance.journal.post`
 * granted at all") — a specific mutation's *scope* rule (e.g. "only for my own
 * territory") is evaluated separately, in the service, via `ScopeEvaluator`, since
 * scope meaning is domain-specific.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissionKey);
