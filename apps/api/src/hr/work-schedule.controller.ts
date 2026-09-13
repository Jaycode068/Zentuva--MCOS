import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { WorkScheduleStatus } from '@prisma/client';
import {
  CreateWorkScheduleInput,
  UpdateWorkScheduleInput,
  createWorkScheduleSchema,
  updateWorkScheduleSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';
import { WorkScheduleService } from './work-schedule.service';

@Controller('hr/work-schedules')
@UseGuards(JwtAuthGuard)
export class WorkScheduleController {
  constructor(
    private readonly workScheduleService: WorkScheduleService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: WorkScheduleStatus) {
    const items = await this.workScheduleService.list(user.organisationId, { status });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.workScheduleService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createWorkScheduleSchema)) body: CreateWorkScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { workSchedule, wasCreated } = await this.workScheduleService.create(
      user.organisationId,
      body,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.WORK_SCHEDULE_CREATED,
        entityType: 'WorkSchedule',
        entityId: workSchedule.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: workSchedule.code, name: workSchedule.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return workSchedule;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkScheduleSchema)) body: UpdateWorkScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.workScheduleService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.WORK_SCHEDULE_UPDATED,
      entityType: 'WorkSchedule',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.workScheduleService.activate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.WORK_SCHEDULE_ACTIVATED,
      entityType: 'WorkSchedule',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.workScheduleService.deactivate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.WORK_SCHEDULE_DEACTIVATED,
      entityType: 'WorkSchedule',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
