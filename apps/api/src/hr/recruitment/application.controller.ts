import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import {
  RejectApplicationInput,
  ScreenApplicationInput,
  rejectApplicationSchema,
  screenApplicationSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ApplicationService } from './application.service';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"HR Screening"). Every route requires an
 * `hr.recruitment.application.*` permission — candidate applications are
 * private HR information, never visible to an ordinary organisation user
 * merely because they belong to the organisation (recruitment.md §"Candidate
 * Privacy").
 */
@Controller('hr/recruitment/applications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApplicationController {
  constructor(
    private readonly applicationService: ApplicationService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('hr.recruitment.application.view')
  list(
    @CurrentUser() user: TokenPayload,
    @Query('vacancyId') vacancyId?: string,
    @Query('status') status?: ApplicationStatus,
  ) {
    return this.applicationService.list(user.organisationId, { vacancyId, status });
  }

  @Get(':id')
  @RequirePermission('hr.recruitment.application.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.applicationService.getByIdWithRelations(user.organisationId, id);
  }

  @Post(':id/screen')
  @RequirePermission('hr.recruitment.application.screen')
  async screen(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(screenApplicationSchema)) body: ScreenApplicationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const application = await this.applicationService.screen(
      user.organisationId,
      id,
      user.sub,
      body.screeningNotes,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.APPLICATION_SCREENED,
      entityType: 'Application',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return application;
  }

  @Post(':id/shortlist')
  @RequirePermission('hr.recruitment.application.screen')
  async shortlist(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(screenApplicationSchema)) body: ScreenApplicationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const application = await this.applicationService.shortlist(
      user.organisationId,
      id,
      user.sub,
      body.screeningNotes,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.APPLICATION_SHORTLISTED,
      entityType: 'Application',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return application;
  }

  @Post(':id/reject')
  @RequirePermission('hr.recruitment.application.screen')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectApplicationSchema)) body: RejectApplicationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const application = await this.applicationService.reject(
      user.organisationId,
      id,
      user.sub,
      body.screeningNotes,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.APPLICATION_REJECTED,
      entityType: 'Application',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return application;
  }
}
