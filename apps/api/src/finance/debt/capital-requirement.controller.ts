import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CapitalRequirement, CapitalRequirementStatus } from '@prisma/client';
import {
  CreateCapitalRequirementInput,
  UpdateCapitalRequirementInput,
  createCapitalRequirementSchema,
  updateCapitalRequirementSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DEBT_AUDIT_ACTIONS } from '../debt-audit-actions';
import { CapitalRequirementService } from './capital-requirement.service';

/** Capital Requirement HTTP surface (Sprint 17, docs/domains/
 *  debt-management.md §3-5). `GET` requires only authentication; every
 *  write additionally requires the Owner or Administrator role. */
@Controller('finance/debt/capital-requirements')
@UseGuards(JwtAuthGuard)
export class CapitalRequirementController {
  constructor(
    private readonly capitalRequirementService: CapitalRequirementService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: CapitalRequirementStatus,
  ) {
    const items = await this.capitalRequirementService.list(user.organisationId, { status });
    return { items: items.map(toCapitalRequirementResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const requirement = await this.capitalRequirementService.getById(user.organisationId, id);
    return toCapitalRequirementResponse(requirement);
  }

  @Get(':id/budget-coverage')
  async budgetCoverage(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.capitalRequirementService.getBudgetCoverage(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCapitalRequirementSchema))
    body: CreateCapitalRequirementInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { capitalRequirement, wasCreated } = await this.capitalRequirementService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_CREATED,
        entityType: 'CapitalRequirement',
        entityId: capitalRequirement.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          title: capitalRequirement.title,
          requiredAmount: capitalRequirement.requiredAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCapitalRequirementResponse(capitalRequirement);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCapitalRequirementSchema))
    body: UpdateCapitalRequirementInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.capitalRequirementService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_UPDATED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }

  @Post(':id/propose')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async propose(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.capitalRequirementService.propose(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_PROPOSED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async approve(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.capitalRequirementService.approve(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_APPROVED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }

  @Post(':id/fund')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async fund(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.capitalRequirementService.fund(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_FUNDED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }

  @Post(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async complete(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.capitalRequirementService.complete(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_COMPLETED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.capitalRequirementService.cancel(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.CAPITAL_REQUIREMENT_CANCELLED,
      entityType: 'CapitalRequirement',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toCapitalRequirementResponse(updated);
  }
}

export function toCapitalRequirementResponse(requirement: CapitalRequirement) {
  return {
    id: requirement.id,
    title: requirement.title,
    description: requirement.description,
    requiredAmount: requirement.requiredAmount,
    requiredDate: requirement.requiredDate,
    type: requirement.type,
    status: requirement.status,
    priority: requirement.priority,
    budgetId: requirement.budgetId,
    budgetLineId: requirement.budgetLineId,
    costCentreId: requirement.costCentreId,
    notes: requirement.notes,
    approvedAt: requirement.approvedAt,
    fundedAt: requirement.fundedAt,
    completedAt: requirement.completedAt,
    cancelledAt: requirement.cancelledAt,
    createdAt: requirement.createdAt,
    updatedAt: requirement.updatedAt,
  };
}
