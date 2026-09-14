import { Injectable } from '@nestjs/common';
import { AccessScope, Permission, Prisma, Role, RolePermission, UserRole } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PrismaService } from '../../prisma/prisma.service';

export interface PermissionGrant {
  permissionId: string;
  scope?: AccessScope;
}

export interface RoleWithCounts extends Role {
  userCount: number;
  permissionCount: number;
}

/**
 * Thin Prisma access for the Role aggregate (Role, RolePermission) plus read access to
 * the global Permission catalog. No business logic — see RoleService and
 * docs/domains/identity.md §4/§6/§9, extended by docs/domains/access-control.md §6.
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

  /** Roles plus assigned-user count and permission count — the Roles admin list
   *  (access-control.md §11 "see number of assigned users"). */
  async findManyByOrganisationWithCounts(organisationId: string): Promise<RoleWithCounts[]> {
    const roles = await this.prisma.role.findMany({
      where: { organisationId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { userRoles: true, rolePermissions: true } } },
    });
    return roles.map(({ _count, ...role }) => ({
      ...role,
      userCount: _count.userRoles,
      permissionCount: _count.rolePermissions,
    }));
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

  /** Archiving stops a role's grants from being effective (EffectiveAccessResolver
   *  skips non-ACTIVE roles) without deleting it or its `UserRole` assignment history —
   *  access-control.md §6 "archive/disable a role safely." System roles cannot be
   *  archived — Owner/Administrator/Member remain load-bearing for endpoints not yet
   *  migrated off `RolesGuard`. */
  async setStatus(
    organisationId: string,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
  ): Promise<Role> {
    const existing = await this.findById(organisationId, id);
    if (!existing) {
      throw new AppError(
        `Role ${id} not found in organisation ${organisationId}`,
        404,
        'ROLE_NOT_FOUND',
      );
    }
    if (existing.isSystem) {
      throw new AppError('System roles cannot be archived', 403, 'ROLE_IS_SYSTEM');
    }
    return this.prisma.role.update({ where: { id }, data: { status } });
  }

  // --- RolePermission ---

  setPermissions(roleId: string, grants: PermissionGrant[]): Promise<Prisma.BatchPayload> {
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      return tx.rolePermission.createMany({
        data: grants.map((grant) => ({
          roleId,
          permissionId: grant.permissionId,
          scope: grant.scope,
        })),
      });
    });
  }

  findPermissionsForRole(roleId: string): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: { rolePermissions: { some: { roleId } } },
      orderBy: { key: 'asc' },
    });
  }

  /** `RolePermission` rows (with `scope`) for a role, `Permission` joined — the
   *  scope-aware read `findPermissionsForRole` (scope-blind) can't serve. */
  findRolePermissionsForRole(
    roleId: string,
  ): Promise<(RolePermission & { permission: Permission })[]> {
    return this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
      orderBy: { permission: { key: 'asc' } },
    });
  }

  /** Same, across every ACTIVE role a user holds in an organisation — the raw input
   *  `EffectiveAccessResolver` unions into one effective permission set. */
  findActiveRolePermissionsForUser(
    organisationId: string,
    userId: string,
  ): Promise<(RolePermission & { permission: Permission; role: Role })[]> {
    return this.prisma.rolePermission.findMany({
      where: {
        role: { organisationId, status: 'ACTIVE', userRoles: { some: { userId, organisationId } } },
      },
      include: { permission: true, role: true },
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

  // --- UserRole ---
  // Added Sprint 1B.2: invitation acceptance (identity.md §5) assigns the invited Role to
  // the newly-created User — this capability didn't exist yet after Sprint 1B.1.

  assignToUser(
    organisationId: string,
    userId: string,
    roleId: string,
    assignedById?: string,
  ): Promise<UserRole> {
    return this.prisma.userRole.create({
      data: {
        organisation: { connect: { id: organisationId } },
        user: { connect: { id: userId } },
        role: { connect: { id: roleId } },
        ...(assignedById ? { assignedById } : {}),
      },
    });
  }

  /** Removes exactly one role assignment — the Sprint 25 multi-role complement to
   *  `replaceUserRole` (which is still used, unchanged, by the single-role User
   *  Management flow). Idempotent: removing an assignment that doesn't exist is a
   *  safe no-op, matching this codebase's idempotency convention. */
  async removeFromUser(organisationId: string, userId: string, roleId: string): Promise<boolean> {
    const result = await this.prisma.userRole.deleteMany({
      where: { organisationId, userId, roleId },
    });
    return result.count > 0;
  }

  /** Role names held by a user within an organisation. Added Sprint 2.1 for the
   *  role-name authorization check (RolesGuard) — didn't exist after Sprint 1B.1/1B.2. */
  async findRoleNamesForUser(organisationId: string, userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { organisationId, userId },
      include: { role: true },
    });
    return userRoles.map((userRole) => userRole.role.name);
  }

  /** Every `UserRole` a user holds, `Role` joined — the Sprint 25 "multiple roles"
   *  read (identity.md §7 / access-control.md §4), unlike `findRoleNamesForUser`
   *  (names only, for the legacy role-name guard). */
  findUserRolesWithRole(
    organisationId: string,
    userId: string,
  ): Promise<(UserRole & { role: Role })[]> {
    return this.prisma.userRole.findMany({
      where: { organisationId, userId },
      include: { role: true },
      orderBy: { assignedAt: 'asc' },
    });
  }

  /** Replaces a user's role assignment with a single new one. Added Sprint 2.2 — User
   *  Management treats "one role per user" as the MVP mental model (the brief's `role`
   *  field is singular), even though `UserRole` technically permits many. Transactional so
   *  a user is never briefly left with zero roles. Still used, unchanged, by that flow;
   *  Sprint 25's Access Control "User Access" page uses `assignToUser`/`removeFromUser`
   *  instead, since it explicitly supports multiple simultaneous roles. */
  replaceUserRole(organisationId: string, userId: string, roleId: string): Promise<UserRole> {
    return this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { organisationId, userId } });
      return tx.userRole.create({ data: { organisationId, userId, roleId } });
    });
  }
}
