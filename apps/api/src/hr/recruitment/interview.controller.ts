import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  CreateInterviewInput,
  RecordStageDecisionInput,
  createInterviewSchema,
  recordStageDecisionSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InterviewStageDecisionService } from './interview-stage-decision.service';
import { InterviewService } from './interview.service';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Scheduling" / §"Stage Summary" / §"HR Stage
 * Decision"). This is the HR-facing surface (gated by `hr.recruitment.*`
 * permissions) — the interviewer's OWN self-scoped evaluation surface is a
 * SEPARATE controller (`interview-evaluation.controller.ts`, `JwtAuthGuard`
 * alone), since a panelist may hold none of these permissions.
 */
@Controller('hr/recruitment/interviews')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InterviewController {
  constructor(
    private readonly interviewService: InterviewService,
    private readonly stageDecisionService: InterviewStageDecisionService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('hr.recruitment.application.view')
  listByApplication(
    @CurrentUser() user: TokenPayload,
    @Query('applicationId') applicationId: string,
  ) {
    return this.interviewService.listByApplication(user.organisationId, applicationId);
  }

  @Get(':id')
  @RequirePermission('hr.recruitment.application.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.interviewService.getByIdWithRelations(user.organisationId, id);
  }

  @Get(':id/summary')
  @RequirePermission('hr.recruitment.application.view')
  summary(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.stageDecisionService.summarize(user.organisationId, id);
  }

  @Post()
  @RequirePermission('hr.recruitment.interview.manage')
  async schedule(
    @Body(new ZodValidationPipe(createInterviewSchema)) body: CreateInterviewInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const interview = await this.interviewService.schedule(
      user.organisationId,
      body.applicationId,
      body.interviewStageId,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_SCHEDULED,
      entityType: 'Interview',
      entityId: interview.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { applicationId: body.applicationId, interviewStageId: body.interviewStageId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return interview;
  }

  @Post(':id/decide')
  @RequirePermission('hr.recruitment.interview.decide')
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordStageDecisionSchema)) body: RecordStageDecisionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const interview = await this.interviewService.getById(user.organisationId, id);
    const decision = await this.stageDecisionService.decide(
      user.organisationId,
      id,
      body.decision,
      user.sub,
      body.comment,
      interview.applicationId,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_STAGE_DECISION_RECORDED,
      entityType: 'Interview',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { decision: body.decision },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return decision;
  }
}
