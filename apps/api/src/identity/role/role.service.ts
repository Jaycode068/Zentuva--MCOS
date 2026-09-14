import { Injectable } from '@nestjs/common';
import { AccessScope, Permission, Role, RolePermission, UserRole } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PermissionGrant, RoleRepository, RoleWithCounts } from './role.repository';

/**
 * Domain service for the Role aggregate and the global Permission catalog.
 *
 * Sprint 1B.1 scope note: creating/editing/deleting roles and assigning them to users is
 * pure data management (not permission *evaluation* — deciding what the role grants is
 * a separate concern from deciding whether the current caller is allowed to change it,
 * which belongs to a future authorization guard). Implemented for real. `Owner`'s
 * "bypasses RolePermission" behaviour (identity.md §6) is an authorization-evaluation
 * concern — implemented Sprint 25 by `EffectiveAccessResolver`, not here.
 *
 * Extended Sprint 25 (docs/domains/access-control.md §6) with scope-aware permission
 * grants, role archiving, duplication, and multi-role assignment/removal.
 */
@Injectable()
export class RoleService {
  constructor(private readonly roleRepository: RoleRepository) {}

  getById(organisationId: string, id: string): Promise<Role | null> {
    return this.roleRepository.findById(organisationId, id);
  }

  listByOrganisation(organisationId: string): Promise<Role[]> {
    return this.roleRepository.findManyByOrganisation(organisationId);
  }

  listByOrganisationWithCounts(organisationId: string): Promise<RoleWithCounts[]> {
    return this.roleRepository.findManyByOrganisationWithCounts(organisationId);
  }

  async createCustomRole(organisationId: string, input: CreateRoleInput): Promise<Role> {
    const existing = await this.roleRepository.findByName(organisationId, input.name);
    if (existing) {
      throw new AppError(`Role "${input.name}" already exists`, 409, 'ROLE_NAME_TAKEN');
    }
    const role = await this.roleRepository.create({
      organisation: { connect: { id: organisationId } },
      name: input.name,
      description: input.description,
      isSystem: false,
    });
    if (input.permissions?.length) {
      await this.applyPermissionGrants(role.id, input.permissions);
    }
    return role;
  }

  updateRole(organisationId: string, id: string, input: UpdateRoleInput): Promise<Role> {
    return this.roleRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
    });
  }

  deleteRole(organisationId: string, id: string): Promise<void> {
    return this.roleRepository.delete(organisationId, id);
  }

  archiveRole(organisationId: string, id: string): Promise<Role> {
    return this.roleRepository.setStatus(organisationId, id, 'ARCHIVED');
  }

  restoreRole(organisationId: string, id: string): Promise<Role> {
    return this.roleRepository.setStatus(organisationId, id, 'ACTIVE');
  }

  /** Copies an existing role's name (suffixed), description, and every permission
   *  grant (scope included) into a brand-new custom role — access-control.md §6
   *  "duplicate an existing role." The source role may be a system role (Owner/
   *  Administrator/Member); the duplicate itself never is, so it's editable
   *  immediately. */
  async duplicateRole(
    organisationId: string,
    sourceRoleId: string,
    newName: string,
  ): Promise<Role> {
    const source = await this.roleRepository.findById(organisationId, sourceRoleId);
    if (!source) {
      throw new AppError(
        `Role ${sourceRoleId} not found in organisation ${organisationId}`,
        404,
        'ROLE_NOT_FOUND',
      );
    }
    const existing = await this.roleRepository.findByName(organisationId, newName);
    if (existing) {
      throw new AppError(`Role "${newName}" already exists`, 409, 'ROLE_NAME_TAKEN');
    }
    const sourceGrants = await this.roleRepository.findRolePermissionsForRole(sourceRoleId);
    const duplicate = await this.roleRepository.create({
      organisation: { connect: { id: organisationId } },
      name: newName,
      description: source.description,
      isSystem: false,
    });
    if (sourceGrants.length) {
      await this.roleRepository.setPermissions(
        duplicate.id,
        sourceGrants.map((g) => ({ permissionId: g.permissionId, scope: g.scope ?? undefined })),
      );
    }
    return duplicate;
  }

  /** Sets a role's full permission grant list (replacing whatever was there), scope
   *  included — access-control.md §5/§6. Rejects a `SCOPABLE` permission granted
   *  without an explicit scope (an absent scope is never unrestricted access) and a
   *  scope supplied for a `NONE`-scoped permission (nothing to scope). */
  async setRolePermissions(
    organisationId: string,
    roleId: string,
    grants: RolePermissionGrantInput[],
  ): Promise<void> {
    const role = await this.roleRepository.findById(organisationId, roleId);
    if (!role) {
      throw new AppError(
        `Role ${roleId} not found in organisation ${organisationId}`,
        404,
        'ROLE_NOT_FOUND',
      );
    }
    if (role.isSystem) {
      throw new AppError(
        'System roles cannot have their permissions edited',
        403,
        'ROLE_IS_SYSTEM',
      );
    }
    await this.applyPermissionGrants(roleId, grants);
  }

  private async applyPermissionGrants(
    roleId: string,
    grants: RolePermissionGrantInput[],
  ): Promise<void> {
    const permissions = await this.roleRepository.findPermissionsByKeys(
      grants.map((g) => g.permissionKey),
    );
    const byKey = new Map(permissions.map((p) => [p.key, p]));

    const resolved: PermissionGrant[] = grants.map((grant) => {
      const permission = byKey.get(grant.permissionKey);
      if (!permission) {
        throw new AppError(
          `Unknown permission "${grant.permissionKey}"`,
          400,
          'UNKNOWN_PERMISSION',
        );
      }
      if (permission.scopeType === 'SCOPABLE' && !grant.scope) {
        throw new AppError(
          `"${grant.permissionKey}" requires an explicit scope`,
          400,
          'SCOPE_REQUIRED',
        );
      }
      if (permission.scopeType === 'NONE' && grant.scope) {
        throw new AppError(
          `"${grant.permissionKey}" is organisation-wide and cannot be scoped`,
          400,
          'SCOPE_NOT_APPLICABLE',
        );
      }
      return { permissionId: permission.id, scope: grant.scope };
    });

    await this.roleRepository.setPermissions(roleId, resolved);
  }

  getPermissionsForRole(roleId: string): Promise<Permission[]> {
    return this.roleRepository.findPermissionsForRole(roleId);
  }

  getRolePermissionsWithScope(
    roleId: string,
  ): Promise<(RolePermission & { permission: Permission })[]> {
    return this.roleRepository.findRolePermissionsForRole(roleId);
  }

  listAllPermissions(): Promise<Permission[]> {
    return this.roleRepository.findAllPermissions();
  }

  /** Assigns a Role to a User (identity.md §5 Invitation Flow "INSERT UserRole"; §10
   *  `POST /users/:id/roles`). Added Sprint 1B.2 — invitation acceptance needs it and it
   *  didn't exist after Sprint 1B.1. Pure data management, not permission evaluation.
   *  Idempotent-friendly: `UserRole` has `@@unique([userId, roleId])`, so a caller that
   *  needs idempotency should check `findUserRolesWithRole` first (the Access Control
   *  "assign role" endpoint does exactly that — access-control.md §6). */
  assignRoleToUser(
    organisationId: string,
    userId: string,
    roleId: string,
    assignedById?: string,
  ): Promise<UserRole> {
    return this.roleRepository.assignToUser(organisationId, userId, roleId, assignedById);
  }

  /** Removes one role assignment from a user — returns `false` if the user didn't hold
   *  that role (a safe no-op, not an error). */
  removeRoleFromUser(organisationId: string, userId: string, roleId: string): Promise<boolean> {
    return this.roleRepository.removeFromUser(organisationId, userId, roleId);
  }

  /** Every role a user holds, `Role` joined — Sprint 25's multi-role read. */
  getUserRolesWithRole(organisationId: string, userId: string) {
    return this.roleRepository.findUserRolesWithRole(organisationId, userId);
  }

  /** Role names held by a user (Sprint 2.1's RolesGuard: "a simple role-name check is
   *  sufficient" — not a permission-key evaluation engine, see identity.md §6 for why
   *  that's deliberately a separate, deferred concern). Still the live mechanism behind
   *  every endpoint not yet migrated to `@RequirePermission` — see access-control.md
   *  §10 for the list. */
  getRoleNamesForUser(organisationId: string, userId: string): Promise<string[]> {
    return this.roleRepository.findRoleNamesForUser(organisationId, userId);
  }

  /** Looks up a system role by name (Sprint 2.2 User Management: `role` on create/update
   *  is a system role name, not a `roleId` — see `@zentuva/validation`'s
   *  `systemRoleNameSchema`). */
  getByName(organisationId: string, name: string): Promise<Role | null> {
    return this.roleRepository.findByName(organisationId, name);
  }

  /** Replaces a user's role assignment with a single new one (Sprint 2.2). */
  replaceUserRole(organisationId: string, userId: string, roleId: string): Promise<UserRole> {
    return this.roleRepository.replaceUserRole(organisationId, userId, roleId);
  }
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions?: RolePermissionGrantInput[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
}

export interface RolePermissionGrantInput {
  permissionKey: string;
  scope?: AccessScope;
}
