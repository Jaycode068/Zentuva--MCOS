import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  EffectiveAccess,
  EffectiveAccessResolver,
} from '../identity/authorization/effective-access-resolver';
import { RoleService } from '../identity/role/role.service';
import { UserService } from '../identity/user/user.service';
import { EmployeeService } from '../hr/employee.service';

export interface UserAccessRow {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  userStatus: string;
  employee: {
    id: string;
    employeeCode: string;
    department: { id: string; name: string } | null;
    position: { id: string; title: string } | null;
    manager: { id: string; firstName: string; lastName: string } | null;
    employmentStatus: string;
  } | null;
  roles: { id: string; name: string; status: string }[];
}

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §8/§11 "User
 * Access page"). Composes Identity's `UserService`/`RoleService` with HR's
 * (exported, read-only) `EmployeeService` for the administration view — never writes to
 * any HR table, never duplicates HR data.
 */
@Injectable()
export class AccessUserService {
  constructor(
    private readonly userService: UserService,
    private readonly roleService: RoleService,
    private readonly employeeService: EmployeeService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
  ) {}

  async listUserAccess(organisationId: string): Promise<UserAccessRow[]> {
    const users = await this.userService.listWithRoles(organisationId);
    return Promise.all(
      users.map(async (user) => {
        const employee = await this.employeeService.getByUserId(organisationId, user.id);
        const employeeDetail = employee
          ? await this.employeeService.getByIdWithRelations(organisationId, employee.id)
          : null;
        return {
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userStatus: user.status,
          employee: employeeDetail
            ? {
                id: employeeDetail.id,
                employeeCode: employeeDetail.employeeCode,
                department: employeeDetail.department
                  ? { id: employeeDetail.department.id, name: employeeDetail.department.name }
                  : null,
                position: employeeDetail.position
                  ? { id: employeeDetail.position.id, title: employeeDetail.position.title }
                  : null,
                manager: employeeDetail.manager
                  ? {
                      id: employeeDetail.manager.id,
                      firstName: employeeDetail.manager.firstName,
                      lastName: employeeDetail.manager.lastName,
                    }
                  : null,
                employmentStatus: employeeDetail.employmentStatus,
              }
            : null,
          roles: user.userRoles.map((ur) => ({
            id: ur.role.id,
            name: ur.role.name,
            status: ur.role.status,
          })),
        };
      }),
    );
  }

  async assignRole(
    organisationId: string,
    userId: string,
    roleId: string,
    assignedById: string,
  ): Promise<{ wasCreated: boolean }> {
    const user = await this.userService.getById(organisationId, userId);
    if (!user) {
      throw new NotFoundException('User not found in this organisation');
    }
    const role = await this.roleService.getById(organisationId, roleId);
    if (!role) {
      throw new BadRequestException('Role not found in this organisation');
    }
    const existing = await this.roleService.getUserRolesWithRole(organisationId, userId);
    if (existing.some((ur) => ur.roleId === roleId)) {
      return { wasCreated: false };
    }
    await this.roleService.assignRoleToUser(organisationId, userId, roleId, assignedById);
    return { wasCreated: true };
  }

  async removeRole(organisationId: string, userId: string, roleId: string): Promise<boolean> {
    return this.roleService.removeRoleFromUser(organisationId, userId, roleId);
  }

  getUserRoles(organisationId: string, userId: string) {
    return this.roleService.getUserRolesWithRole(organisationId, userId);
  }

  getEffectiveAccess(organisationId: string, userId: string): Promise<EffectiveAccess> {
    return this.effectiveAccessResolver.resolve(organisationId, userId);
  }
}
