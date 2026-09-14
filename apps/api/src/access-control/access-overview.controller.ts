import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { RoleService } from '../identity/role/role.service';
import { UserService } from '../identity/user/user.service';

/**
 * Access Control overview (docs/domains/access-control.md §11 "Overview" tab) — plain
 * read aggregates, computed live, the same `HrOverviewService`/`MaintenanceOverviewService`
 * "no persisted snapshot" pattern.
 */
@Controller('access/overview')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessOverviewController {
  constructor(
    private readonly roleService: RoleService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @RequirePermission('access.overview.view')
  async getOverview(@CurrentUser() user: TokenPayload) {
    const [roles, users] = await Promise.all([
      this.roleService.listByOrganisationWithCounts(user.organisationId),
      this.userService.listWithRoles(user.organisationId),
    ]);

    const activeRoles = roles.filter((r) => r.status === 'ACTIVE');
    const archivedRoles = roles.filter((r) => r.status === 'ARCHIVED');
    const systemRoles = roles.filter((r) => r.isSystem);
    const customRoles = roles.filter((r) => !r.isSystem);
    const usersWithoutAnyRole = users.filter((u) => u.userRoles.length === 0);
    const usersWithMultipleRoles = users.filter((u) => u.userRoles.length > 1);

    return {
      totalRoles: roles.length,
      activeRoles: activeRoles.length,
      archivedRoles: archivedRoles.length,
      systemRoles: systemRoles.length,
      customRoles: customRoles.length,
      totalUsers: users.length,
      usersWithoutAnyRole: usersWithoutAnyRole.length,
      usersWithMultipleRoles: usersWithMultipleRoles.length,
    };
  }
}
