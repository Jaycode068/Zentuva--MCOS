import { Injectable } from '@nestjs/common';
import { AccessScope } from '@prisma/client';

import { EffectiveAccess, EffectiveAccessResolver } from './effective-access-resolver';

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §5). A thin,
 * injectable wrapper a domain service calls once it already has an `EffectiveAccess`
 * (from `EffectiveAccessResolver.resolve()`) and needs to know which scope(s) a
 * specific permission is granted at — kept separate from the resolver so a domain
 * service's own scope-filtering code (e.g. "is this employee in my team?") reads as
 * "ask the ScopeEvaluator," not "reach into the resolver's static helpers directly."
 *
 * The scope engine never pretends to enforce a scope the caller cannot itself prove
 * from server-side data — this class only answers "which scope(s) does the effective
 * access grant," never "does this specific record satisfy that scope." That second
 * half is domain-specific (only the domain knows what "my team" or "my territory"
 * means for its own records) and stays in the calling service.
 */
@Injectable()
export class ScopeEvaluator {
  hasAny(access: EffectiveAccess, permissionKey: string): boolean {
    return EffectiveAccessResolver.isGranted(access, permissionKey);
  }

  hasScope(access: EffectiveAccess, permissionKey: string, scope: AccessScope): boolean {
    return EffectiveAccessResolver.isGrantedWithScope(access, permissionKey, scope);
  }

  /** Every scope granted for a permission — `[]` if not granted at all, `['ORGANISATION']`-
   *  equivalent (organisation-wide) if Owner-bypassed or `NONE`-scopeType. Useful for the
   *  Effective Access Preview and for a service that wants to pick the *broadest*
   *  granted scope rather than check one specific value. */
  grantedScopes(access: EffectiveAccess, permissionKey: string): AccessScope[] {
    if (access.isOwnerBypass) {
      return ['ORGANISATION'];
    }
    const grant = access.grants.get(permissionKey);
    if (!grant) {
      return [];
    }
    if (grant.scopeType === 'NONE') {
      return ['ORGANISATION'];
    }
    return grant.scopes;
  }
}
