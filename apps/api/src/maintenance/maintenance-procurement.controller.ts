import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  CreateProcurementRequirementInput,
  LinkProcurementRequirementInput,
  createProcurementRequirementSchema,
  linkProcurementRequirementSchema,
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
import { MaintenanceProcurementService } from './maintenance-procurement.service';

/**
 * Maintenance Procurement Requirement HTTP surface (Sprint 22,
 * docs/domains/maintenance-integration.md "Procurement Integration") —
 * the smallest boundary Maintenance owns before Procurement's own
 * workflow takes over. Never creates a Purchase Order; only records that
 * a need was identified and, once a human creates the real PO through
 * Procurement's own UI, links its id back here.
 */
@Controller('maintenance/work-orders/:workOrderId/procurement')
@UseGuards(JwtAuthGuard)
export class MaintenanceProcurementController {
  constructor(
    private readonly maintenanceProcurementService: MaintenanceProcurementService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Param('workOrderId') workOrderId: string) {
    const items = await this.maintenanceProcurementService.list(user.organisationId, workOrderId);
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Param('workOrderId') workOrderId: string,
    @Body(new ZodValidationPipe(createProcurementRequirementSchema))
    body: CreateProcurementRequirementInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { requirement, wasCreated } = await this.maintenanceProcurementService.create(
      user.organisationId,
      workOrderId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.PROCUREMENT_REQUIREMENT_IDENTIFIED,
        entityType: 'WorkOrder',
        entityId: workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { requirementId: requirement.id, description: requirement.description },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return requirement;
  }

  @Post(':id/link')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async link(
    @Param('workOrderId') workOrderId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linkProcurementRequirementSchema))
    body: LinkProcurementRequirementInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { requirement, wasLinked } = await this.maintenanceProcurementService.link(
      user.organisationId,
      id,
      body,
    );
    if (wasLinked) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.PROCUREMENT_REQUIREMENT_LINKED,
        entityType: 'WorkOrder',
        entityId: workOrderId,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { requirementId: requirement.id, purchaseOrderId: requirement.purchaseOrderId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return requirement;
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(
    @Param('workOrderId') workOrderId: string,
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { requirement } = await this.maintenanceProcurementService.cancel(
      user.organisationId,
      id,
    );
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.PROCUREMENT_REQUIREMENT_CANCELLED,
      entityType: 'WorkOrder',
      entityId: workOrderId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { requirementId: requirement.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return requirement;
  }

  @Get(':id/ap-summary')
  async getApSummary(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.maintenanceProcurementService.getApSummary(user.organisationId, id);
  }
}
