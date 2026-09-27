import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { HiringRequestStatus } from '@prisma/client';
import {
  CreateHiringRequestInput,
  HiringRequestDecisionInput,
  createHiringRequestSchema,
  hiringRequestDecisionSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';
import { HiringRequestService } from './hiring-request.service';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Hiring Request"). `submit`/`approve`/`reject` here are
 * the DIRECT-action path used when an organisation has no
 * `HIRING_REQUEST_APPROVAL` `WorkflowDefinition` configured; routing a
 * request through the actual Workflow engine instead uses the GENERIC
 * `POST /workflows/instances` + `.../submit` + `.../approve` endpoints
 * directly (never a recruitment-owned wrapper) — recruitment.md §"Workflow
 * Integration".
 */
@Controller('hr/recruitment/hiring-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HiringRequestController {
  constructor(
    private readonly hiringRequestService: HiringRequestService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('hr.recruitment.hiring_request.view')
  list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: HiringRequestStatus,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.hiringRequestService.list(user.organisationId, { status, departmentId });
  }

  @Get(':id')
  @RequirePermission('hr.recruitment.hiring_request.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.hiringRequestService.getByIdWithRelations(user.organisationId, id);
  }

  @Post()
  @RequirePermission('hr.recruitment.hiring_request.manage')
  async create(
    @Body(new ZodValidationPipe(createHiringRequestSchema)) body: CreateHiringRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const hiringRequest = await this.hiringRequestService.create(
      user.organisationId,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.HIRING_REQUEST_CREATED,
      entityType: 'HiringRequest',
      entityId: hiringRequest.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { departmentId: body.departmentId, positionId: body.positionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return hiringRequest;
  }

  @Post(':id/submit')
  @RequirePermission('hr.recruitment.hiring_request.manage')
  async submit(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.hiringRequestService.submit(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.HIRING_REQUEST_SUBMITTED,
      entityType: 'HiringRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/approve')
  @RequirePermission('hr.recruitment.hiring_request.approve')
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hiringRequestDecisionSchema)) body: HiringRequestDecisionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.hiringRequestService.approve(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.HIRING_REQUEST_APPROVED,
      entityType: 'HiringRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { comment: body.comment },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/reject')
  @RequirePermission('hr.recruitment.hiring_request.approve')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hiringRequestDecisionSchema)) body: HiringRequestDecisionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.hiringRequestService.reject(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.HIRING_REQUEST_REJECTED,
      entityType: 'HiringRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { comment: body.comment },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/cancel')
  @RequirePermission('hr.recruitment.hiring_request.manage')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.hiringRequestService.cancel(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.HIRING_REQUEST_CANCELLED,
      entityType: 'HiringRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }
}
