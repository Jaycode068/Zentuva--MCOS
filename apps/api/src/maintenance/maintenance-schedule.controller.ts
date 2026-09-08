import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MaintenanceScheduleStatus } from '@prisma/client';
import {
  CreateMaintenanceScheduleInput,
  GenerateMaintenanceScheduleInput,
  UpdateMaintenanceScheduleInput,
  createMaintenanceScheduleSchema,
  generateMaintenanceScheduleSchema,
  updateMaintenanceScheduleSchema,
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
import { MaintenanceScheduleService } from './maintenance-schedule.service';

/**
 * Maintenance Schedule HTTP surface (Sprint 21, docs/domains/
 * maintenance.md). `GET` requires only authentication; every write
 * additionally requires the Owner or Administrator role.
 */
@Controller('maintenance/schedules')
@UseGuards(JwtAuthGuard)
export class MaintenanceScheduleController {
  constructor(
    private readonly maintenanceScheduleService: MaintenanceScheduleService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: MaintenanceScheduleStatus,
    @Query('assetId') assetId?: string,
    @Query('maintenancePlanId') maintenancePlanId?: string,
  ) {
    const items = await this.maintenanceScheduleService.list(user.organisationId, {
      status,
      assetId,
      maintenancePlanId,
    });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.maintenanceScheduleService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createMaintenanceScheduleSchema))
    body: CreateMaintenanceScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { maintenanceSchedule, wasCreated } = await this.maintenanceScheduleService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_SCHEDULE_CREATED,
        entityType: 'MaintenanceSchedule',
        entityId: maintenanceSchedule.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return maintenanceSchedule;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaintenanceScheduleSchema))
    body: UpdateMaintenanceScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.maintenanceScheduleService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_SCHEDULE_UPDATED,
      entityType: 'MaintenanceSchedule',
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
    return this.maintenanceScheduleService.setStatus(user.organisationId, id, false);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  activate(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    return this.maintenanceScheduleService.setStatus(user.organisationId, id, true);
  }

  @Post(':id/generate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async generate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(generateMaintenanceScheduleSchema))
    body: GenerateMaintenanceScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.maintenanceScheduleService.generate(
      user.organisationId,
      id,
      user.sub,
      body.idempotencyKey,
    );
    if (result.generated && result.workOrder) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_SCHEDULE_GENERATED,
        entityType: 'MaintenanceSchedule',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          workOrderId: result.workOrder.id,
          workOrderCode: result.workOrder.workOrderCode,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return result;
  }
}
