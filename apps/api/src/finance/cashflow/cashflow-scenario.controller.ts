import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CashflowItemStatus, CashflowScenario } from '@prisma/client';
import {
  CreateCashflowScenarioInput,
  UpdateCashflowScenarioInput,
  createCashflowScenarioSchema,
  updateCashflowScenarioSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASHFLOW_AUDIT_ACTIONS } from '../cashflow-audit-actions';
import { CashflowScenarioService } from './cashflow-scenario.service';

/**
 * Cashflow Scenario HTTP surface (Sprint 15, docs/domains/cashflow.md §7). `GET`
 * requires only authentication; every write additionally requires the Owner or
 * Administrator role.
 */
@Controller('finance/cashflow/scenarios')
@UseGuards(JwtAuthGuard)
export class CashflowScenarioController {
  constructor(
    private readonly cashflowScenarioService: CashflowScenarioService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: CashflowItemStatus) {
    const scenarios = await this.cashflowScenarioService.list(user.organisationId, { status });
    return { items: scenarios.map(toCashflowScenarioResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const scenario = await this.cashflowScenarioService.getById(user.organisationId, id);
    return toCashflowScenarioResponse(scenario);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCashflowScenarioSchema)) body: CreateCashflowScenarioInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { cashflowScenario, wasCreated } = await this.cashflowScenarioService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASHFLOW_AUDIT_ACTIONS.SCENARIO_CREATED,
        entityType: 'CashflowScenario',
        entityId: cashflowScenario.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: cashflowScenario.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCashflowScenarioResponse(cashflowScenario);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCashflowScenarioSchema)) body: UpdateCashflowScenarioInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashflowScenarioService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.SCENARIO_UPDATED,
      entityType: 'CashflowScenario',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: updated.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowScenarioResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashflowScenarioService.deactivate(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.SCENARIO_DEACTIVATED,
      entityType: 'CashflowScenario',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowScenarioResponse(updated);
  }
}

export function toCashflowScenarioResponse(scenario: CashflowScenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    inflowDelayDays: scenario.inflowDelayDays,
    inflowMultiplier: scenario.inflowMultiplier,
    outflowDelayDays: scenario.outflowDelayDays,
    outflowMultiplier: scenario.outflowMultiplier,
    status: scenario.status,
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}
