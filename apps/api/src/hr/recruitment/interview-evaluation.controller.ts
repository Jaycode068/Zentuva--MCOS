import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ReopenInterviewEvaluationInput,
  SubmitInterviewEvaluationInput,
  reopenInterviewEvaluationSchema,
  submitInterviewEvaluationSchema,
} from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InterviewEvaluationService } from './interview-evaluation.service';
import { InterviewService } from './interview.service';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Evaluation" / §"Mobile"). SELF-SCOPED —
 * `JwtAuthGuard` alone on `my-evaluations`/`:id`/`:id/evaluate` (the same "my
 * own data" precedent `AccountController` established), since a panelist may
 * hold NONE of the `hr.recruitment.*` permissions. The real authorization —
 * "is this actually YOUR assigned interview" — is enforced inside
 * `InterviewEvaluationService`/`InterviewService` via a direct
 * `InterviewParticipant` row lookup, never by this controller's guards alone
 * (recruitment.md §"Interviewer Authorization").
 *
 * `reopen` is the one HR-gated exception on this controller — an
 * administrative action, not a self-service one.
 */
@Controller('hr-interviews')
@UseGuards(JwtAuthGuard)
export class InterviewEvaluationController {
  constructor(
    private readonly interviewService: InterviewService,
    private readonly evaluationService: InterviewEvaluationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('my-evaluations')
  myEvaluations(@CurrentUser() user: TokenPayload) {
    return this.interviewService.listForParticipant(user.organisationId, user.sub);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const full = await this.interviewService.getByIdWithRelations(user.organisationId, id);
    const ownEvaluation = await this.evaluationService.getOwnEvaluation(
      user.organisationId,
      id,
      user.sub,
    );
    // Independence (recruitment.md §"Independent Evaluation Privacy"): this
    // self-scoped view NEVER includes other participants' evaluations, only
    // the caller's own (`null` until they submit) — an HR user with broader
    // visibility uses `GET /hr/recruitment/interviews/:id` instead. Stage
    // decisions are likewise HR-internal, not a panelist's concern, so
    // neither `evaluations` nor `decisions` is forwarded here.
    const interview = {
      id: full.id,
      scheduledAt: full.scheduledAt,
      durationMinutes: full.durationMinutes,
      location: full.location,
      meetingLink: full.meetingLink,
      status: full.status,
      interviewStage: full.interviewStage,
      application: full.application,
    };
    return { interview, ownEvaluation };
  }

  @Post(':id/evaluate')
  async submit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitInterviewEvaluationSchema))
    body: SubmitInterviewEvaluationInput,
    @CurrentUser() user: TokenPayload,
  ) {
    const evaluation = await this.evaluationService.submit(user.organisationId, id, user.sub, body);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_EVALUATION_SUBMITTED,
      entityType: 'Interview',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { score: body.score, recommendation: body.recommendation },
    });
    return evaluation;
  }

  @Post('evaluations/:evaluationId/reopen')
  @UseGuards(PermissionsGuard)
  @RequirePermission('hr.recruitment.interview.decide')
  async reopen(
    @Param('evaluationId') evaluationId: string,
    @Body(new ZodValidationPipe(reopenInterviewEvaluationSchema))
    body: ReopenInterviewEvaluationInput,
    @CurrentUser() user: TokenPayload,
  ) {
    const evaluation = await this.evaluationService.reopen(user.organisationId, evaluationId);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_EVALUATION_REOPENED,
      entityType: 'InterviewEvaluation',
      entityId: evaluationId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { reason: body.reason },
    });
    return evaluation;
  }
}
