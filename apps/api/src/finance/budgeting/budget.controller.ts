import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Budget, BudgetLine, BudgetStatus } from '@prisma/client';
import {
  CreateBudgetInput,
  CreateBudgetLineInput,
  UpdateBudgetInput,
  UpdateBudgetLineInput,
  createBudgetLineSchema,
  createBudgetSchema,
  updateBudgetLineSchema,
  updateBudgetSchema,
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
import { BudgetActualsService } from './budget-actuals.service';
import { BudgetForecastService } from './budget-forecast.service';
import { BudgetLineService } from './budget-line.service';
import { BudgetService } from './budget.service';

/**
 * Budget HTTP surface (Sprint 16, docs/domains/budgeting.md). `GET` requires
 * only authentication; every write additionally requires the Owner or
 * Administrator role. Budget Line routes are nested here (`.../:id/lines`)
 * rather than a separate controller, matching the brief's own suggested API
 * shape.
 */
@Controller('finance/budgets')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly budgetLineService: BudgetLineService,
    private readonly budgetActualsService: BudgetActualsService,
    private readonly budgetForecastService: BudgetForecastService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: BudgetStatus,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('budgetCode') budgetCode?: string,
  ) {
    const budgets = await this.budgetService.list(user.organisationId, {
      status,
      fiscalYear: fiscalYear ? Number(fiscalYear) : undefined,
      budgetCode,
    });
    return { items: budgets.map(toBudgetResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const budget = await this.budgetService.getById(user.organisationId, id);
    return toBudgetResponse(budget);
  }

  @Get(':id/siblings')
  async siblings(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const budget = await this.budgetService.getById(user.organisationId, id);
    const siblings = await this.budgetService.listSiblings(
      user.organisationId,
      budget.budgetCode,
      budget.fiscalYear,
    );
    return { items: siblings.map(toBudgetResponse) };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createBudgetSchema)) body: CreateBudgetInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { budget, wasCreated } = await this.budgetService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: BUDGETING_AUDIT_ACTIONS.BUDGET_CREATED,
        entityType: 'Budget',
        entityId: budget.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { budgetCode: budget.budgetCode, scenarioName: budget.scenarioName },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toBudgetResponse(budget);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBudgetSchema)) body: UpdateBudgetInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.budgetService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_UPDATED,
      entityType: 'Budget',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetResponse(updated);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async approve(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.budgetService.approve(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_APPROVED,
      entityType: 'Budget',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.budgetService.activate(user.organisationId, id);
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_ACTIVATED,
      entityType: 'Budget',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetResponse(updated);
  }

  @Post(':id/close')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async close(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.budgetService.close(user.organisationId, id);
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_CLOSED,
      entityType: 'Budget',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetResponse(updated);
  }

  @Post(':id/revise')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async revise(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const revision = await this.budgetService.revise(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_REVISED,
      entityType: 'Budget',
      entityId: revision.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { revisesBudgetId: id, version: revision.version },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetResponse(revision);
  }

  @Get(':id/lines')
  async listLines(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.budgetService.getById(user.organisationId, id);
    const lines = await this.budgetLineService.list(id);
    return { items: lines.map(toBudgetLineResponse) };
  }

  @Post(':id/lines')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async upsertLine(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createBudgetLineSchema)) body: CreateBudgetLineInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { budgetLine, wasCreated } = await this.budgetLineService.upsert(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: wasCreated
        ? BUDGETING_AUDIT_ACTIONS.BUDGET_LINE_CREATED
        : BUDGETING_AUDIT_ACTIONS.BUDGET_LINE_UPDATED,
      entityType: 'BudgetLine',
      entityId: budgetLine.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { lineType: budgetLine.lineType, amount: budgetLine.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toBudgetLineResponse(budgetLine);
  }

  @Patch(':id/lines/:lineId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(updateBudgetLineSchema)) body: UpdateBudgetLineInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.budgetLineService.update(
      user.organisationId,
      id,
      lineId,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: BUDGETING_AUDIT_ACTIONS.BUDGET_LINE_UPDATED,
      entityType: 'BudgetLine',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toBudgetLineResponse(updated);
  }

  @Get(':id/vs-actual')
  async vsActual(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.budgetService.getById(user.organisationId, id);
    return this.budgetActualsService.getVarianceReport(user.organisationId, id);
  }

  @Get(':id/vs-forecast')
  async vsForecast(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.budgetService.getById(user.organisationId, id);
    return this.budgetForecastService.getBudgetVsForecast(user.organisationId, id);
  }
}

export function toBudgetResponse(budget: Budget) {
  return {
    id: budget.id,
    budgetCode: budget.budgetCode,
    name: budget.name,
    description: budget.description,
    fiscalYear: budget.fiscalYear,
    scenarioName: budget.scenarioName,
    version: budget.version,
    revisesBudgetId: budget.revisesBudgetId,
    cashflowScenarioId: budget.cashflowScenarioId,
    startDate: budget.startDate,
    endDate: budget.endDate,
    currency: budget.currency,
    status: budget.status,
    notes: budget.notes,
    approvedAt: budget.approvedAt,
    activatedAt: budget.activatedAt,
    closedAt: budget.closedAt,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  };
}

export function toBudgetLineResponse(line: BudgetLine) {
  return {
    id: line.id,
    budgetId: line.budgetId,
    chartOfAccountId: line.chartOfAccountId,
    costCentreId: line.costCentreId,
    lineType: line.lineType,
    periodMonth: line.periodMonth,
    amount: line.amount,
    description: line.description,
    notes: line.notes,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}
