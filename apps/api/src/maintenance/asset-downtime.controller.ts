import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  EndDowntimeInput,
  RecordDowntimeInput,
  endDowntimeSchema,
  recordDowntimeSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AssetDowntimeService } from './asset-downtime.service';
import { MAINTENANCE_AUDIT_ACTIONS } from './maintenance-audit-actions';

/**
 * Asset Downtime HTTP surface (Sprint 21, docs/domains/maintenance.md).
 * `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role.
 */
@Controller('maintenance/downtime')
@UseGuards(JwtAuthGuard)
export class AssetDowntimeController {
  constructor(
    private readonly assetDowntimeService: AssetDowntimeService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('assetId') assetId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const items = await this.assetDowntimeService.list(user.organisationId, {
      assetId,
      workOrderId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async record(
    @Body(new ZodValidationPipe(recordDowntimeSchema)) body: RecordDowntimeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { downtime, wasCreated } = await this.assetDowntimeService.record(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.DOWNTIME_RECORDED,
        entityType: 'WorkOrder',
        entityId: downtime.workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { downtimeId: downtime.id, planned: downtime.planned },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return downtime;
  }

  @Post(':id/end')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async end(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endDowntimeSchema)) body: EndDowntimeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetDowntimeService.end(user.organisationId, id, body.endedAt);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.DOWNTIME_ENDED,
      entityType: 'WorkOrder',
      entityId: updated.workOrderId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { downtimeId: updated.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
