import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RecordMaintenanceCostInput, recordMaintenanceCostSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { MAINTENANCE_AUDIT_ACTIONS } from './maintenance-audit-actions';
import { MaintenanceCostService } from './maintenance-cost.service';

/**
 * Maintenance Cost HTTP surface (Sprint 21, docs/domains/maintenance.md
 * "Cost Boundary"). Operational cost capture only — never creates a
 * `JournalEntry`/`SupplierInvoice`/`Payment`, proven by
 * `maintenance-independence.spec.ts`.
 */
@Controller('maintenance/costs')
@UseGuards(JwtAuthGuard)
export class MaintenanceCostController {
  constructor(
    private readonly maintenanceCostService: MaintenanceCostService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('workOrderId') workOrderId: string) {
    const items = await this.maintenanceCostService.list(user.organisationId, workOrderId);
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async record(
    @Body(new ZodValidationPipe(recordMaintenanceCostSchema)) body: RecordMaintenanceCostInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { cost, wasCreated } = await this.maintenanceCostService.record(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.COST_RECORDED,
        entityType: 'WorkOrder',
        entityId: cost.workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { category: cost.category, totalCost: cost.totalCost },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return cost;
  }
}
