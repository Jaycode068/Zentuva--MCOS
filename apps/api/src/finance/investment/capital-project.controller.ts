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
import { CapitalProject, CapitalProjectStatus } from '@prisma/client';
import {
  CreateCapitalProjectCostLineInput,
  CreateCapitalProjectFundingInput,
  CreateCapitalProjectInput,
  UpdateCapitalProjectInput,
  createCapitalProjectCostLineSchema,
  createCapitalProjectFundingSchema,
  createCapitalProjectSchema,
  updateCapitalProjectSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CAPITAL_PROJECT_AUDIT_ACTIONS } from '../capital-project-audit-actions';
import { CapitalProjectService } from './capital-project.service';

/**
 * Capital Project HTTP surface (Sprint 18, docs/domains/
 * investment-projects.md). `GET` requires only authentication; every write
 * additionally requires the Owner or Administrator role.
 */
@Controller('finance/investment/projects')
@UseGuards(JwtAuthGuard)
export class CapitalProjectController {
  constructor(
    private readonly capitalProjectService: CapitalProjectService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: CapitalProjectStatus) {
    const items = await this.capitalProjectService.list(user.organisationId, { status });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.capitalProjectService.getById(user.organisationId, id);
  }

  @Get(':id/budget-allocation')
  getBudgetAllocation(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.capitalProjectService.getBudgetAllocation(user.organisationId, id);
  }

  @Get(':id/spending')
  getSpending(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.capitalProjectService.getSpending(user.organisationId, id);
  }

  @Get(':id/cost-lines')
  async listCostLines(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.capitalProjectService.listCostLines(user.organisationId, id);
    return { items };
  }

  @Get(':id/funding')
  async listFunding(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.capitalProjectService.listFunding(user.organisationId, id);
    return { items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCapitalProjectSchema)) body: CreateCapitalProjectInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { capitalProject, wasCreated } = await this.capitalProjectService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_CREATED,
        entityType: 'CapitalProject',
        entityId: capitalProject.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { projectCode: capitalProject.projectCode, name: capitalProject.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return capitalProject;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCapitalProjectSchema)) body: UpdateCapitalProjectInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.capitalProjectService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_UPDATED,
      entityType: 'CapitalProject',
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
      () => this.capitalProjectService.submit(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_SUBMITTED,
    );
  }

  @Post(':id/start-review')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async startReview(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.startReview(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_UNDER_REVIEW,
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
      () => this.capitalProjectService.approve(user.organisationId, id, user.sub),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_APPROVED,
    );
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async reject(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.reject(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_REJECTED,
    );
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.activate(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_ACTIVATED,
    );
  }

  @Post(':id/hold')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async hold(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.hold(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_ON_HOLD,
    );
  }

  @Post(':id/resume')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async resume(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.resume(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_RESUMED,
    );
  }

  @Post(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async complete(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.complete(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_COMPLETED,
    );
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.capitalProjectService.cancel(user.organisationId, id),
      CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_CANCELLED,
    );
  }

  @Post(':id/cost-lines')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async addCostLine(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCapitalProjectCostLineSchema))
    body: CreateCapitalProjectCostLineInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const costLine = await this.capitalProjectService.addCostLine(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_COST_LINE_ADDED,
      entityType: 'CapitalProjectCostLine',
      entityId: costLine.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { capitalProjectId: id, plannedAmount: costLine.plannedAmount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return costLine;
  }

  @Delete(':id/cost-lines/:costLineId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async removeCostLine(
    @Param('id') id: string,
    @Param('costLineId') costLineId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.capitalProjectService.removeCostLine(user.organisationId, id, costLineId);
    await this.auditService.record({
      action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_COST_LINE_REMOVED,
      entityType: 'CapitalProjectCostLine',
      entityId: costLineId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { capitalProjectId: id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  @Post(':id/funding')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async addFunding(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCapitalProjectFundingSchema))
    body: CreateCapitalProjectFundingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { capitalProjectFunding, wasCreated } = await this.capitalProjectService.addFunding(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_FUNDING_ADDED,
        entityType: 'CapitalProjectFunding',
        entityId: capitalProjectFunding.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          capitalProjectId: id,
          fundingType: capitalProjectFunding.fundingType,
          amount: capitalProjectFunding.amount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return capitalProjectFunding;
  }

  @Delete(':id/funding/:fundingId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async removeFunding(
    @Param('id') id: string,
    @Param('fundingId') fundingId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.capitalProjectService.removeFunding(user.organisationId, id, fundingId);
    await this.auditService.record({
      action: CAPITAL_PROJECT_AUDIT_ACTIONS.CAPITAL_PROJECT_FUNDING_REMOVED,
      entityType: 'CapitalProjectFunding',
      entityId: fundingId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { capitalProjectId: id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ capitalProject: CapitalProject; transitioned: boolean }>,
    action: string,
  ) {
    const { capitalProject, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action,
        entityType: 'CapitalProject',
        entityId: capitalProject.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return capitalProject;
  }
}
