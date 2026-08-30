import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CostCentre, CostCentreStatus } from '@prisma/client';
import {
  CreateCostCentreInput,
  UpdateCostCentreInput,
  createCostCentreSchema,
  updateCostCentreSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { BUDGETING_AUDIT_ACTIONS } from '../budgeting-audit-actions';
import { CostCentreService } from './cost-centre.service';

/**
 * Cost Centre HTTP surface (Sprint 16, docs/domains/budgeting.md §10). `GET`
 * requires only authentication; every write additionally requires the Owner
 * or Administrator role.
 */
@Controller('finance/cost-centres')
@UseGuards(JwtAuthGuard)
export class CostCentreController {
  constructor(
    private readonly costCentreService: CostCentreService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: CostCentreStatus) {
    const items = await this.costCentreService.list(user.organisationId, { status });
    return { items: items.map(toCostCentreResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const costCentre = await this.costCentreService.getById(user.organisationId, id);
    return toCostCentreResponse(costCentre);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCostCentreSchema)) body: CreateCostCentreInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { costCentre, wasCreated } = await this.costCentreService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: BUDGETING_AUDIT_ACTIONS.COST_CENTRE_CREATED,
        entityType: 'CostCentre',
        entityId: costCentre.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: costCentre.code, name: costCentre.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCostCentreResponse(costCentre);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCostCentreSchema)) body: UpdateCostCentreInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.costCentreService.update(user.organisationId, id, body);

    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.COST_CENTRE_UPDATED,
      entityType: 'CostCentre',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCostCentreResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.costCentreService.deactivate(user.organisationId, id);

    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.COST_CENTRE_DEACTIVATED,
      entityType: 'CostCentre',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCostCentreResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.costCentreService.activate(user.organisationId, id);

    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.COST_CENTRE_ACTIVATED,
      entityType: 'CostCentre',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCostCentreResponse(updated);
  }
}

export function toCostCentreResponse(costCentre: CostCentre) {
  return {
    id: costCentre.id,
    code: costCentre.code,
    name: costCentre.name,
    description: costCentre.description,
    status: costCentre.status,
    createdAt: costCentre.createdAt,
    updatedAt: costCentre.updatedAt,
  };
}
