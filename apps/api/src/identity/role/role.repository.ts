import { Injectable } from '@nestjs/common';
import { Permission, Prisma, Role } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the Role aggregate (Role, RolePermission) plus read access to
 * the global Permission catalog. No business logic — see RoleService and
 * docs/domains/identity.md §4/§6/§9.
 */
@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.RoleCreateInput): Promise<Role> {
    return this.prisma.role.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Role | null> {
    return this.prisma.role.findFirst({ where: { id, organisationId } });
  }

  findByName(organisationId: string, name: string): Promise<Role | null> {
    return this.prisma.role.findUnique({
      where: { organisationId_name: { organisationId, name } },
    });
  }

  findManyByOrganisation(organisationId: string): Promise<Role[]> {
    return this.prisma.role.findMany({ where: { organisationId }, orderBy: { createdAt: 'asc' } });
  }

  async update(organisationId: string, id: string, data: Prisma.RoleUpdateInput): Promise<Role> {
    const existing = await this.findById(organisationId, id);
    if (!existing) {
      throw new AppError(
        `Role ${id} not found in organisation ${organisationId}`,
        404,
        'ROLE_NOT_FOUND',
      );
    }
    if (existing.isSystem) {
      throw new AppError('System roles cannot be modified', 403, 'ROLE_IS_SYSTEM');
    }
    return this.prisma.role.update({ where: { id }, data });
  }

  async delete(organisationId: string, id: string): Promise<void> {
    const existing = await this.findById(organisationId, id);
    if (!existing) {
      throw new AppError(
        `Role ${id} not found in organisation ${organisationId}`,
        404,
        'ROLE_NOT_FOUND',
      );
    }
    if (existing.isSystem) {
      throw new AppError('System roles cannot be deleted', 403, 'ROLE_IS_SYSTEM');
    }
    await this.prisma.role.delete({ where: { id } });
  }

  // --- RolePermission ---

  setPermissions(roleId: string, permissionIds: string[]): Promise<Prisma.BatchPayload> {
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      return tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    });
  }

  findPermissionsForRole(roleId: string): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: { rolePermissions: { some: { roleId } } },
      orderBy: { key: 'asc' },
    });
  }

  // --- Permission catalog (global, not tenant-scoped — identity.md §7) ---

  findAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }

  findPermissionByKey(key: string): Promise<Permission | null> {
    return this.prisma.permission.findUnique({ where: { key } });
  }

  findPermissionsByKeys(keys: string[]): Promise<Permission[]> {
    return this.prisma.permission.findMany({ where: { key: { in: keys } } });
  }
}
