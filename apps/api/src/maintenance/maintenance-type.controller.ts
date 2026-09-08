import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MaintenanceTypeStatus } from '@prisma/client';
import {
  CreateMaintenanceTypeInput,
  UpdateMaintenanceTypeInput,
  createMaintenanceTypeSchema,
  updateMaintenanceTypeSchema,
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
import { MaintenanceTypeService } from './maintenance-type.service';

/**
 * Maintenance Type HTTP surface (Sprint 21, docs/domains/maintenance.md).
 * `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role.
 */
@Controller('maintenance/types')
@UseGuards(JwtAuthGuard)
export class MaintenanceTypeController {
  constructor(
    private readonly maintenanceTypeService: MaintenanceTypeService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: MaintenanceTypeStatus) {
    const items = await this.maintenanceTypeService.list(user.organisationId, { status });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.maintenanceTypeService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createMaintenanceTypeSchema)) body: CreateMaintenanceTypeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { maintenanceType, wasCreated } = await this.maintenanceTypeService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_TYPE_CREATED,
        entityType: 'MaintenanceType',
        entityId: maintenanceType.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: maintenanceType.code, name: maintenanceType.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return maintenanceType;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaintenanceTypeSchema)) body: UpdateMaintenanceTypeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.maintenanceTypeService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_TYPE_UPDATED,
      entityType: 'MaintenanceType',
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
    return this.maintenanceTypeService.deactivate(user.organisationId, id);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  activate(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    return this.maintenanceTypeService.activate(user.organisationId, id);
  }
}
