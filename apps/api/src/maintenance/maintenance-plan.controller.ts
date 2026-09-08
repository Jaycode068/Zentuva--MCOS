import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MaintenancePlanStatus } from '@prisma/client';
import {
  CreateMaintenancePlanInput,
  UpdateMaintenancePlanInput,
  createMaintenancePlanSchema,
  updateMaintenancePlanSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { MAINTENANCE_AUDIT_ACTIONS } from './maintenance-audit-actions';
import { MaintenancePlanService } from './maintenance-plan.service';

/**
 * Maintenance Plan HTTP surface (Sprint 21, docs/domains/maintenance.md).
 * `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role.
 */
@Controller('maintenance/plans')
@UseGuards(JwtAuthGuard)
export class MaintenancePlanController {
  constructor(
    private readonly maintenancePlanService: MaintenancePlanService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: MaintenancePlanStatus,
    @Query('assetId') assetId?: string,
    @Query('assetCategoryId') assetCategoryId?: string,
    @Query('maintenanceTypeId') maintenanceTypeId?: string,
  ) {
    const items = await this.maintenancePlanService.list(user.organisationId, {
      status,
      assetId,
      assetCategoryId,
      maintenanceTypeId,
    });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.maintenancePlanService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createMaintenancePlanSchema)) body: CreateMaintenancePlanInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { maintenancePlan, wasCreated } = await this.maintenancePlanService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_PLAN_CREATED,
        entityType: 'MaintenancePlan',
        entityId: maintenancePlan.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: maintenancePlan.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return maintenancePlan;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaintenancePlanSchema)) body: UpdateMaintenancePlanInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.maintenancePlanService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_PLAN_UPDATED,
      entityType: 'MaintenancePlan',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  deactivate(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    return this.maintenancePlanService.setStatus(user.organisationId, id, 'INACTIVE');
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  activate(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    return this.maintenancePlanService.setStatus(user.organisationId, id, 'ACTIVE');
  }
}
