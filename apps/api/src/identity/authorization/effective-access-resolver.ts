import { Injectable } from '@nestjs/common';
import { AccessScope, PermissionScopeType } from '@prisma/client';

import { UserService } from '../user/user.service';
import { RoleRepository } from '../role/role.repository';

/** One permission's resolved grant, unioned across every ACTIVE role a user holds. For
 *  a `NONE`-scopeType permission, `scopes` is always empty — the grant is
 *  organisation-wide by definition the moment it exists. For a `SCOPABLE` permission,
 *  `scopes` lists every distinct scope granted to it across the user's roles (a user
 *  with two roles might hold `sales.order.view` at both `OWN_TEAM` and
 *  `ASSIGNED_RECORDS`, say) — `NONE` is a real member of this array meaning "this role
 *  grants the permission but restricts it to nothing," never interpreted as "no
 *  restriction." */
export interface EffectiveGrant {
  permissionKey: string;
  scopeType: PermissionScopeType;
  scopes: AccessScope[];
  /** Which role name(s) contributed this grant — surfaced in the Effective Access
   *  Preview (access-control.md §11) so an administrator can see *why* a user has an
   *  access, not just *that* they do. */
  sourceRoleNames: string[];
}

export interface EffectiveAccess {
  userId: string;
  organisationId: string;
  /** `false` when the User account itself is not `ACTIVE` (suspended/deactivated/
   *  locked/invited) — access-control.md §2.6/§2.3. Every other field is meaningless
   *  (and left empty) when this is `false`. */
  userIsActive: boolean;
  /** Owner is the one remaining hardcoded role-name bypass (identity.md §6, finally
   *  implemented here) — full, unconditional, organisation-wide access to every
   *  permission regardless of `RolePermission` rows. Documented, tenant-safe (each
   *  organisation has its own Owner role and Owner user), and never granted to a
   *  tenant-configurable custom role — `RoleService.createCustomRole` never sets
   *  `isSystem`, and only the seed creates a role literally named "Owner". */
  isOwnerBypass: boolean;
  roles: { id: string; name: string }[];
  grants: Map<string, EffectiveGrant>;
}

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §9). The
 * single place that turns "this user, in this organisation" into "here is everything
 * they can effectively do" — reused by `PermissionsGuard` (REST enforcement), the
 * Access Control admin UI's Effective Access Preview, and available to any future
 * consumer (workflow approval routing, notification recipient resolution, background
 * jobs, reporting access checks) without re-deriving this logic.
 *
 * Deliberately reads only `User.status` (Identity-owned) for the "is this account
 * currently allowed to act at all" check — never `Employee.employmentStatus`, which
 * would invert the HR→Identity dependency direction every other domain in this
 * codebase respects. Employee suspension/separation instead *proactively* pushes a
 * `User.status` change via `UserService.updateStatus` (see
 * `EmployeeService.suspend()`/`.separate()`/`.reactivate()`, Sprint 25) — the correct
 * direction, since HR already legitimately depends on Identity's `UserService`.
 */
@Injectable()
export class EffectiveAccessResolver {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly userService: UserService,
  ) {}

  async resolve(organisationId: string, userId: string): Promise<EffectiveAccess> {
    const user = await this.userService.getById(organisationId, userId);
    if (!user || user.status !== 'ACTIVE') {
      return {
        userId,
        organisationId,
        userIsActive: false,
        isOwnerBypass: false,
        roles: [],
        grants: new Map(),
      };
    }

    const userRoles = await this.roleRepository.findUserRolesWithRole(organisationId, userId);
    const activeRoles = userRoles.filter((ur) => ur.role.status === 'ACTIVE');
    const isOwnerBypass = activeRoles.some((ur) => ur.role.name === 'Owner');

    const roles = activeRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name }));
    const grants = new Map<string, EffectiveGrant>();

    if (!isOwnerBypass) {
      const rolePermissions = await this.roleRepository.findActiveRolePermissionsForUser(
        organisationId,
        userId,
      );
      for (const rp of rolePermissions) {
        const existing = grants.get(rp.permission.key);
        if (existing) {
          if (rp.scope && !existing.scopes.includes(rp.scope)) {
            existing.scopes.push(rp.scope);
          }
          if (!existing.sourceRoleNames.includes(rp.role.name)) {
            existing.sourceRoleNames.push(rp.role.name);
          }
        } else {
          grants.set(rp.permission.key, {
            permissionKey: rp.permission.key,
            scopeType: rp.permission.scopeType,
            scopes: rp.scope ? [rp.scope] : [],
            sourceRoleNames: [rp.role.name],
          });
        }
      }
    }

    return { userId, organisationId, userIsActive: true, isOwnerBypass, roles, grants };
  }

  /** Is `permissionKey` granted at all — the check `PermissionsGuard` performs. For a
   *  `SCOPABLE` permission, "granted" means at least one *real* scope (anything other
   *  than the explicit `NONE` scope) is attached; a permission granted only with scope
   *  `NONE` is, correctly, not "granted" for this purpose (access-control.md §5's
   *  Finance Staff `finance.payment.create → NONE` example — the permission row exists,
   *  but it grants nothing). */
  static isGranted(access: EffectiveAccess, permissionKey: string): boolean {
    if (access.isOwnerBypass) {
      return true;
    }
    const grant = access.grants.get(permissionKey);
    if (!grant) {
      return false;
    }
    if (grant.scopeType === 'NONE') {
      return true;
    }
    return grant.scopes.some((scope) => scope !== 'NONE');
  }

  /** Is `permissionKey` granted with (at least) the specific `scope` — the check a
   *  domain service performs when it implements real, provable scope-filtering (e.g.
   *  HR's `OWN_TEAM`/`DEPARTMENT` employee-list scoping, Maintenance's
   *  `ASSIGNED_RECORDS` work-order scoping). `ORGANISATION` scope is also satisfied by
   *  `isOwnerBypass` or a `NONE`-scopeType grant, since both mean "the whole
   *  organisation," but a specific non-`ORGANISATION` scope is only satisfied by an
   *  actual matching `RolePermission.scope` — access-control.md §5. */
  static isGrantedWithScope(
    access: EffectiveAccess,
    permissionKey: string,
    scope: AccessScope,
  ): boolean {
    if (access.isOwnerBypass) {
      return true;
    }
    const grant = access.grants.get(permissionKey);
    if (!grant) {
      return false;
    }
    if (grant.scopeType === 'NONE') {
      return scope === 'ORGANISATION';
    }
    if (scope === 'ORGANISATION') {
      return grant.scopes.includes('ORGANISATION');
    }
    return grant.scopes.includes(scope);
  }
}
