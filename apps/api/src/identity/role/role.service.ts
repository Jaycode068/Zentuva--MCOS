import { Injectable } from '@nestjs/common';
import { Permission, Role } from '@prisma/client';
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
