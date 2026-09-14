import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateAccessRoleInput,
  DuplicateRoleInput,
  SetRolePermissionsInput,
  UpdateAccessRoleInput,
  createAccessRoleSchema,
  duplicateRoleSchema,
  setRolePermissionsSchema,
  updateAccessRoleSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { RoleService } from '../identity/role/role.service';
import { ACCESS_AUDIT_ACTIONS } from './access-audit-actions';

/**
 * Roles + the global Permission catalogue (docs/domains/access-control.md §11 "Roles
 * page"). Every write requires `access.role.manage` — including for tenant-configurable
 * roles only; system roles (Owner/Administrator/Member) reject modification at the
 * `RoleService`/`RoleRepository` layer regardless of who's asking.
 */
@Controller('access/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessRoleController {
  constructor(
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('access.overview.view')
  list(@CurrentUser() user: TokenPayload) {
    return this.roleService.listByOrganisationWithCounts(user.organisationId);
  }

  @Get('permissions')
  @RequirePermission('access.overview.view')
  async listPermissions(@Query('module') module?: string) {
    const permissions = await this.roleService.listAllPermissions();
    return {
      items: module ? permissions.filter((p) => p.domain === module) : permissions,
    };
  }

  @Get(':id')
  @RequirePermission('access.overview.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const role = await this.assertFound(user.organisationId, id);
    const permissions = await this.roleService.getRolePermissionsWithScope(id);
    return { ...role, permissions };
  }

  @Post()
  @RequirePermission('access.role.manage')
  async create(
    @Body(new ZodValidationPipe(createAccessRoleSchema)) body: CreateAccessRoleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const role = await this.roleService.createCustomRole(user.organisationId, {
      name: body.name,
      description: body.description,
      permissions: body.permissions,
    });
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'Role',
      entityId: role.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: role.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return role;
  }

  @Patch(':id')
  @RequirePermission('access.role.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccessRoleSchema)) body: UpdateAccessRoleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.roleService.updateRole(user.organisationId, id, body);
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_UPDATED,
      entityType: 'Role',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/permissions')
  @RequirePermission('access.role.manage')
  async setPermissions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setRolePermissionsSchema)) body: SetRolePermissionsInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.roleService.setRolePermissions(user.organisationId, id, body.permissions);
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
      entityType: 'Role',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { permissionCount: body.permissions.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const permissions = await this.roleService.getRolePermissionsWithScope(id);
    return { items: permissions };
  }

  @Post(':id/archive')
  @RequirePermission('access.role.manage')
  async archive(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const role = await this.roleService.archiveRole(user.organisationId, id);
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_ARCHIVED,
      entityType: 'Role',
      entityId: role.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return role;
  }

  @Post(':id/restore')
  @RequirePermission('access.role.manage')
  async restore(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const role = await this.roleService.restoreRole(user.organisationId, id);
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_RESTORED,
      entityType: 'Role',
      entityId: role.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return role;
  }

  @Post(':id/duplicate')
  @RequirePermission('access.role.manage')
  async duplicate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(duplicateRoleSchema)) body: DuplicateRoleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const duplicate = await this.roleService.duplicateRole(user.organisationId, id, body.name);
    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.ROLE_DUPLICATED,
      entityType: 'Role',
      entityId: duplicate.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { sourceRoleId: id, name: duplicate.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return duplicate;
  }

  private async assertFound(organisationId: string, id: string) {
    const role = await this.roleService.getById(organisationId, id);
    if (!role) {
      throw new BadRequestException('Role not found in this organisation');
    }
    return role;
  }
}
