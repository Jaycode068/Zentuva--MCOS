import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import {
  CreateInterviewStageInput,
  CreateVacancyInput,
  UpdateInterviewStageParticipantsInput,
  UpdateVacancyInput,
  createInterviewStageSchema,
  createVacancySchema,
  updateInterviewStageParticipantsSchema,
  updateVacancySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { InterviewStageService } from './interview-stage.service';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';
import { VacancyService } from './vacancy.service';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Vacancy" / §"Configurable Interview Process"). Interview
 * stage configuration lives on this controller (nested under a vacancy) —
 * stages belong to exactly one `Vacancy`, never a standalone reusable
 * process (recruitment.md's own documented consolidation).
 */
@Controller('hr/recruitment/vacancies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VacancyController {
  constructor(
    private readonly vacancyService: VacancyService,
    private readonly interviewStageService: InterviewStageService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('hr.recruitment.vacancy.view')
  list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: VacancyStatus,
    @Query('search') search?: string,
  ) {
    return this.vacancyService.list(user.organisationId, { status, search });
  }

  @Get(':id')
  @RequirePermission('hr.recruitment.vacancy.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.vacancyService.getByIdWithRelations(user.organisationId, id);
  }

  @Post()
  @RequirePermission('hr.recruitment.vacancy.manage')
  async create(
    @Body(new ZodValidationPipe(createVacancySchema)) body: CreateVacancyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const vacancy = await this.vacancyService.create(user.organisationId, body, user.sub);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_CREATED,
      entityType: 'Vacancy',
      entityId: vacancy.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { title: vacancy.title, publicSlug: vacancy.publicSlug },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return vacancy;
  }

  @Patch(':id')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVacancySchema)) body: UpdateVacancyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const vacancy = await this.vacancyService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_UPDATED,
      entityType: 'Vacancy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return vacancy;
  }

  @Post(':id/publish')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async publish(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.vacancyService.publish(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_PUBLISHED,
      entityType: 'Vacancy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/pause')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async pause(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.vacancyService.pause(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_PAUSED,
      entityType: 'Vacancy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/close')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async close(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.vacancyService.close(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_CLOSED,
      entityType: 'Vacancy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/cancel')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.vacancyService.cancel(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.VACANCY_CANCELLED,
      entityType: 'Vacancy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Interview stage configuration (recruitment.md §"Configurable Interview
  // Process" / §"Participant Selection") — nested under a vacancy.
  // ---------------------------------------------------------------------------

  @Get(':id/interview-stages')
  @RequirePermission('hr.recruitment.vacancy.view')
  listStages(@CurrentUser() user: TokenPayload, @Param('id') vacancyId: string) {
    return this.interviewStageService.listByVacancy(user.organisationId, vacancyId);
  }

  @Post(':id/interview-stages')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async createStage(
    @Param('id') vacancyId: string,
    @Body(new ZodValidationPipe(createInterviewStageSchema)) body: CreateInterviewStageInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const stage = await this.interviewStageService.create(user.organisationId, vacancyId, body);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_STAGE_CONFIGURED,
      entityType: 'InterviewStage',
      entityId: stage.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { vacancyId, name: stage.name, sequence: stage.sequence },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return stage;
  }

  @Patch('interview-stages/:stageId/participants')
  @RequirePermission('hr.recruitment.vacancy.manage')
  async replaceStageParticipants(
    @Param('stageId') stageId: string,
    @Body(new ZodValidationPipe(updateInterviewStageParticipantsSchema))
    body: UpdateInterviewStageParticipantsInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const stage = await this.interviewStageService.replaceParticipants(
      user.organisationId,
      stageId,
      body.participantUserIds,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.INTERVIEW_STAGE_PARTICIPANT_ASSIGNED,
      entityType: 'InterviewStage',
      entityId: stageId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { participantCount: body.participantUserIds.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return stage;
  }
}
