import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { WorkflowInstanceStatus } from '@prisma/client';
import {
  CreateWorkflowInstanceInput,
  WorkflowDecisionInput,
  WorkflowRequiredCommentInput,
  createWorkflowInstanceSchema,
  workflowDecisionInputSchema,
  workflowRequiredCommentInputSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { WORKFLOW_AUDIT_ACTIONS } from './workflow-audit-actions';
import { WorkflowInstanceService } from './workflow-instance.service';

/**
 * Workflow Instances + Approvals (docs/domains/workflow.md §10). Two authorization
 * layers throughout (workflow.md §2.2): the `@RequirePermission` on each route is a
 * coarse "may use this part of the workflow engine at all" gate; whether THIS specific
 * user may act on THIS specific step is a dynamic check `WorkflowInstanceService`
 * performs itself via `WorkflowEligibilityService` — never expressible as a single
 * static decorator, since it depends on the workflow definition's own configuration.
 */
@Controller('workflows/instances')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkflowInstanceController {
  constructor(
    private readonly workflowInstanceService: WorkflowInstanceService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('workflow.instance.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: WorkflowInstanceStatus,
    @Query('subjectType') subjectType?: string,
    @Query('overdue') overdue?: string,
  ) {
    const items = await this.workflowInstanceService.list(user.organisationId, {
      status,
      subjectType,
      overdue: overdue === 'true',
    });
    return { items };
  }

  @Get('my-approvals')
  @RequirePermission('workflow.approval.view')
  async myApprovals(@CurrentUser() user: TokenPayload) {
    const items = await this.workflowInstanceService.listMyApprovals(user.organisationId, user.sub);
    return { items };
  }

  @Get(':id')
  @RequirePermission('workflow.instance.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.workflowInstanceService.getByIdOrThrow(user.organisationId, id);
  }

  @Get(':id/history')
  @RequirePermission('workflow.audit.view')
  async history(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    // Confirms the instance belongs to this organisation before returning its
    // decisions — `findDecisionsByInstance` itself isn't organisation-scoped (it
    // reads by `workflowInstanceId` alone), so tenant isolation is enforced here.
    await this.workflowInstanceService.getByIdOrThrow(user.organisationId, id);
    const items = await this.workflowInstanceService.getDecisionHistory(id);
    return { items };
  }

  @Get(':id/events')
  @RequirePermission('workflow.audit.view')
  async events(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    // Same tenant-isolation-via-getByIdOrThrow pattern as `history` above —
    // `WorkflowEventRepository.findManyByInstance` isn't organisation-scoped itself.
    await this.workflowInstanceService.getByIdOrThrow(user.organisationId, id);
    const items = await this.workflowInstanceService.getEvents(id);
    return { items };
  }

  @Get(':id/eligible-approvers')
  @RequirePermission('workflow.instance.view')
  async eligibleApprovers(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.workflowInstanceService.listEligibleApprovers(user.organisationId, id);
    return { items };
  }

  @Post()
  @RequirePermission('workflow.instance.submit')
  async create(
    @Body(new ZodValidationPipe(createWorkflowInstanceSchema)) body: CreateWorkflowInstanceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const instance = await this.workflowInstanceService.create(user.organisationId, body, user.sub);
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.INSTANCE_CREATED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { subjectType: instance.subjectType, subjectId: instance.subjectId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  @Post(':id/submit')
  @RequirePermission('workflow.instance.submit')
  async submit(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const instance = await this.workflowInstanceService.submit(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.INSTANCE_SUBMITTED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  @Post(':id/approve')
  @RequirePermission('workflow.approval.approve')
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(workflowDecisionInputSchema)) body: WorkflowDecisionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const instance = await this.workflowInstanceService.approve(
      user.organisationId,
      id,
      user.sub,
      body.comment,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.APPROVAL_GRANTED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { comment: body.comment, resultingStatus: instance.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  @Post(':id/reject')
  @RequirePermission('workflow.approval.reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(workflowRequiredCommentInputSchema))
    body: WorkflowRequiredCommentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const instance = await this.workflowInstanceService.reject(
      user.organisationId,
      id,
      user.sub,
      body.comment,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.APPROVAL_REJECTED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { comment: body.comment },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  @Post(':id/return')
  @RequirePermission('workflow.approval.return')
  async return(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(workflowRequiredCommentInputSchema))
    body: WorkflowRequiredCommentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const instance = await this.workflowInstanceService.return_(
      user.organisationId,
      id,
      user.sub,
      body.comment,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.APPROVAL_RETURNED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { comment: body.comment },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  @Post(':id/cancel')
  @RequirePermission('workflow.instance.cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const instance = await this.workflowInstanceService.cancel(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.INSTANCE_CANCELLED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  /** Sprint 26.1 §3 — gated by the same `workflow.instance.submit` permission as
   *  `create`/`submit` above (resubmission IS a submission action; no new permission
   *  is warranted for it). */
  @Post(':id/resubmit')
  @RequirePermission('workflow.instance.submit')
  async resubmit(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const instance = await this.workflowInstanceService.resubmit(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.INSTANCE_RESUBMITTED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { previousInstanceId: instance.previousInstanceId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }

  /** Sprint 26.1 §9 — deliberately reuses `workflow.instance.cancel` rather than
   *  adding a new permission (workflow.md §9 "Expiry" documents this choice):
   *  expiring a stuck workflow is the same trust level as cancelling one, and this
   *  sprint's brief explicitly keeps automatic/scheduled expiry out of scope, so a
   *  dedicated permission for a manually-triggered interim path would be premature. */
  @Post(':id/expire')
  @RequirePermission('workflow.instance.cancel')
  async expire(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const instance = await this.workflowInstanceService.expire(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.INSTANCE_EXPIRED,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return instance;
  }
}
