import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AssignUserRoleInput, assignUserRoleSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ACCESS_AUDIT_ACTIONS } from './access-audit-actions';
import { AccessUserService } from './access-user.service';

/**
 * User Access administration (docs/domains/access-control.md §8/§11) — assigning and
 * removing roles on users, and the Effective Access Preview ("what can this user do").
 */
@Controller('access/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessUserController {
  constructor(
    private readonly accessUserService: AccessUserService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('access.overview.view')
  async list(@CurrentUser() user: TokenPayload) {
    const items = await this.accessUserService.listUserAccess(user.organisationId);
    return { items };
  }

  @Get(':userId/effective-access')
  @RequirePermission('access.overview.view')
  async getEffectiveAccess(@CurrentUser() user: TokenPayload, @Param('userId') userId: string) {
    const access = await this.accessUserService.getEffectiveAccess(user.organisationId, userId);
    return {
      userIsActive: access.userIsActive,
      isOwnerBypass: access.isOwnerBypass,
      roles: access.roles,
      grants: Array.from(access.grants.values()),
    };
  }

  @Post(':userId/roles')
  @RequirePermission('access.user_access.manage')
  async assignRole(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(assignUserRoleSchema)) body: AssignUserRoleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { wasCreated } = await this.accessUserService.assignRole(
      user.organisationId,
      userId,
      body.roleId,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: ACCESS_AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
        entityType: 'User',
        entityId: userId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { roleId: body.roleId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    const roles = await this.accessUserService.getUserRoles(user.organisationId, userId);
    return { items: roles };
  }

  @Delete(':userId/roles/:roleId')
  @RequirePermission('access.user_access.manage')
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const removed = await this.accessUserService.removeRole(user.organisationId, userId, roleId);
    if (removed) {
      await this.auditService.record({
        action: ACCESS_AUDIT_ACTIONS.USER_ROLE_REMOVED,
        entityType: 'User',
        entityId: userId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { roleId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    const roles = await this.accessUserService.getUserRoles(user.organisationId, userId);
    return { items: roles };
  }
}
