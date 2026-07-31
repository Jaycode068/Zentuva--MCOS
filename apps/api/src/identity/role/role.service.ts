import { Injectable } from '@nestjs/common';
import { Permission, Role, UserRole } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { RoleRepository } from './role.repository';

/**
 * Domain service for the Role aggregate and the global Permission catalog.
 *
 * Sprint 1B.1 scope note: creating/editing/deleting roles and assigning them to users is
 * pure data management (not permission *evaluation* — deciding what the role grants is
 * a separate concern from deciding whether the current caller is allowed to change it,
 * which belongs to a future authorization guard). Implemented for real. `Owner`'s
 * "bypasses RolePermission" behaviour (identity.md §6) is an authorization-evaluation
 * concern, not a data-layer one, so it is not implemented here.
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
    if (input.permissionKeys?.length) {
      const permissions = await this.roleRepository.findPermissionsByKeys(input.permissionKeys);
      await this.roleRepository.setPermissions(
        role.id,
        permissions.map((p) => p.id),
      );
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

  async setRolePermissions(
    organisationId: string,
    roleId: string,
    permissionKeys: string[],
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
    const permissions = await this.roleRepository.findPermissionsByKeys(permissionKeys);
    await this.roleRepository.setPermissions(
      roleId,
      permissions.map((p) => p.id),
    );
  }

  getPermissionsForRole(roleId: string): Promise<Permission[]> {
    return this.roleRepository.findPermissionsForRole(roleId);
  }

  listAllPermissions(): Promise<Permission[]> {
    return this.roleRepository.findAllPermissions();
  }

  /** Assigns a Role to a User (identity.md §5 Invitation Flow "INSERT UserRole"; §10
   *  `POST /users/:id/roles`). Added Sprint 1B.2 — invitation acceptance needs it and it
   *  didn't exist after Sprint 1B.1. Pure data management, not permission evaluation. */
  assignRoleToUser(
    organisationId: string,
    userId: string,
    roleId: string,
    assignedById?: string,
  ): Promise<UserRole> {
    return this.roleRepository.assignToUser(organisationId, userId, roleId, assignedById);
  }

  /** Role names held by a user (Sprint 2.1's RolesGuard: "a simple role-name check is
   *  sufficient" — not a permission-key evaluation engine, see identity.md §6 for why
   *  that's deliberately a separate, deferred concern). */
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
  permissionKeys?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
}
