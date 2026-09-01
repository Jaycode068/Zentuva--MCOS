import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DecisionAnalysis, DecisionAnalysisStatus } from '@prisma/client';
import {
  CreateDecisionAnalysisInput,
  CreateDecisionScenarioInput,
  RejectDecisionAnalysisInput,
  UpdateDecisionAnalysisInput,
  UpdateDecisionScenarioInput,
  createDecisionAnalysisSchema,
  createDecisionScenarioSchema,
  rejectDecisionAnalysisSchema,
  updateDecisionAnalysisSchema,
  updateDecisionScenarioSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DECISION_ANALYSIS_AUDIT_ACTIONS } from '../decision-analysis-audit-actions';
import { DecisionAnalysisService } from './decision-analysis.service';
import { DecisionScenarioService } from './decision-scenario.service';

/**
 * Decision Analysis HTTP surface (Sprint 19, docs/domains/financial-
 * decision-analysis.md). `GET` (including every calculation endpoint)
 * requires only authentication; every write additionally requires the
 * Owner or Administrator role. Calculation endpoints are never audited
 * (ephemeral reads, not state changes).
 */
@Controller('finance/decisions')
@UseGuards(JwtAuthGuard)
export class DecisionAnalysisController {
  constructor(
    private readonly decisionAnalysisService: DecisionAnalysisService,
    private readonly decisionScenarioService: DecisionScenarioService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: DecisionAnalysisStatus) {
    const items = await this.decisionAnalysisService.list(user.organisationId, { status });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.decisionAnalysisService.getById(user.organisationId, id);
  }

  /** Read-only composition over the existing `AuditLog` table — never a new
   *  audit-writing path, just a filtered view for this one analysis and its
   *  scenarios. */
  @Get(':id/audit')
  async getAuditHistory(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const [analysisEvents, scenarioEvents] = await Promise.all([
      this.auditService.listByOrganisation(user.organisationId, {
        entityType: 'DecisionAnalysis',
        take: 200,
      }),
      this.auditService.listByOrganisation(user.organisationId, {
        entityType: 'DecisionScenario',
        take: 200,
      }),
    ]);
    const items = [
      ...analysisEvents.filter((event) => event.entityId === id),
      ...scenarioEvents.filter(
        (event) => (event.metadata as Record<string, unknown> | null)?.decisionAnalysisId === id,
      ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createDecisionAnalysisSchema)) body: CreateDecisionAnalysisInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { decisionAnalysis, wasCreated } = await this.decisionAnalysisService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_ANALYSIS_CREATED,
        entityType: 'DecisionAnalysis',
        entityId: decisionAnalysis.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: decisionAnalysis.name, decisionType: decisionAnalysis.decisionType },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return decisionAnalysis;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDecisionAnalysisSchema)) body: UpdateDecisionAnalysisInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.decisionAnalysisService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_ANALYSIS_UPDATED,
      entityType: 'DecisionAnalysis',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/submit')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async submit(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.decisionAnalysisService.submit(user.organisationId, id),
      DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_ANALYSIS_SUBMITTED,
    );
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async approve(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.decisionAnalysisService.approve(user.organisationId, id, user.sub),
      DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_ANALYSIS_APPROVED,
    );
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectDecisionAnalysisSchema)) body: RejectDecisionAnalysisInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () =>
        this.decisionAnalysisService.reject(
          user.organisationId,
          id,
          user.sub,
          body.rejectionReason,
        ),
      DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_ANALYSIS_REJECTED,
    );
  }

  @Get(':id/scenarios')
  async listScenarios(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.decisionScenarioService.list(user.organisationId, id);
    return { items };
  }

  @Post(':id/scenarios')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async addScenario(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDecisionScenarioSchema)) body: CreateDecisionScenarioInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { decisionScenario, wasCreated } = await this.decisionScenarioService.create(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_SCENARIO_CREATED,
        entityType: 'DecisionScenario',
        entityId: decisionScenario.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { decisionAnalysisId: id, name: decisionScenario.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return decisionScenario;
  }

  @Patch(':id/scenarios/:scenarioId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateScenario(
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @Body(new ZodValidationPipe(updateDecisionScenarioSchema)) body: UpdateDecisionScenarioInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.decisionScenarioService.update(
      user.organisationId,
      id,
      scenarioId,
      body,
    );
    await this.auditService.record({
      action: DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_SCENARIO_UPDATED,
      entityType: 'DecisionScenario',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { decisionAnalysisId: id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Delete(':id/scenarios/:scenarioId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async removeScenario(
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.decisionScenarioService.remove(user.organisationId, id, scenarioId);
    await this.auditService.record({
      action: DECISION_ANALYSIS_AUDIT_ACTIONS.DECISION_SCENARIO_REMOVED,
      entityType: 'DecisionScenario',
      entityId: scenarioId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { decisionAnalysisId: id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  @Get(':id/scenarios/:scenarioId/results')
  getResults(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.getResults(user.organisationId, id, scenarioId);
  }

  @Get(':id/scenarios/:scenarioId/sensitivity')
  getSensitivity(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.getSensitivity(user.organisationId, id, scenarioId);
  }

  @Get(':id/scenarios/:scenarioId/cashflow-impact')
  getCashflowImpact(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.previewCashflowImpact(user.organisationId, id, scenarioId);
  }

  @Get(':id/scenarios/:scenarioId/budget-impact')
  getBudgetImpact(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.getBudgetImpact(user.organisationId, id, scenarioId);
  }

  @Get(':id/scenarios/:scenarioId/debt-impact')
  getDebtImpact(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.getDebtImpact(user.organisationId, id, scenarioId);
  }

  @Get(':id/scenarios/:scenarioId/recommendation')
  getRecommendation(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.decisionScenarioService.getRecommendation(user.organisationId, id, scenarioId);
  }

  @Get(':id/funding-comparison')
  getFundingComparison(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('scenarioIds') scenarioIds: string,
  ) {
    const ids = (scenarioIds ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return this.decisionScenarioService.getFundingComparison(user.organisationId, id, ids);
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ decisionAnalysis: DecisionAnalysis; transitioned: boolean }>,
    action: string,
  ) {
    const { decisionAnalysis, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action,
        entityType: 'DecisionAnalysis',
        entityId: decisionAnalysis.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return decisionAnalysis;
  }
}
