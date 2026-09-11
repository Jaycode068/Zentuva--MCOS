import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  CancelPartUsageInput,
  IssuePartUsageInput,
  RecordPartUsageInput,
  cancelPartUsageSchema,
  issuePartUsageSchema,
  recordPartUsageSchema,
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
import { MaintenancePartUsageService } from './maintenance-part-usage.service';

/**
 * Maintenance Part Usage HTTP surface (Sprint 21, docs/domains/
 * maintenance.md "Parts / Material Usage Boundary"). Recording a part
 * used never deducts `InventoryStock`/creates an `InventoryTransaction` —
 * foundation only, proven by `maintenance-independence.spec.ts`.
 */
@Controller('maintenance/parts')
@UseGuards(JwtAuthGuard)
export class MaintenancePartUsageController {
  constructor(
    private readonly maintenancePartUsageService: MaintenancePartUsageService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('workOrderId') workOrderId: string) {
    const items = await this.maintenancePartUsageService.list(user.organisationId, workOrderId);
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async record(
    @Body(new ZodValidationPipe(recordPartUsageSchema)) body: RecordPartUsageInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { partUsage, wasCreated } = await this.maintenancePartUsageService.record(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.PART_USAGE_RECORDED,
        entityType: 'WorkOrder',
        entityId: partUsage.workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { productId: partUsage.productId, quantity: partUsage.quantity },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return partUsage;
  }

  /** The only place a maintenance part usage ever actually deducts real
   *  stock — see `MaintenancePartUsageRepository.issue()`'s own doc
   *  comment (docs/domains/maintenance-integration.md "Inventory
   *  Integration"). */
  @Post(':id/issue')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async issue(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(issuePartUsageSchema)) body: IssuePartUsageInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { partUsage, wasIssued } = await this.maintenancePartUsageService.issue(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    if (wasIssued) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.PART_USAGE_ISSUED,
        entityType: 'WorkOrder',
        entityId: partUsage.workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          partUsageId: partUsage.id,
          productId: partUsage.productId,
          quantity: partUsage.quantity,
          locationId: partUsage.locationId,
          totalCost: partUsage.totalCost,
          inventoryTransactionId: partUsage.inventoryTransactionId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return partUsage;
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelPartUsageSchema)) body: CancelPartUsageInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { partUsage } = await this.maintenancePartUsageService.cancel(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.PART_USAGE_CANCELLED,
      entityType: 'WorkOrder',
      entityId: partUsage.workOrderId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { partUsageId: partUsage.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return partUsage;
  }
}
