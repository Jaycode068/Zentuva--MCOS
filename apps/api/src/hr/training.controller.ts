import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { EmployeeTrainingStatus, TrainingCourseStatus } from '@prisma/client';
import {
  AssignTrainingInput,
  CompleteEmployeeTrainingInput,
  CreateTrainingCourseInput,
  UpdateEmployeeTrainingInput,
  UpdateTrainingCourseInput,
  assignTrainingSchema,
  completeEmployeeTrainingSchema,
  createTrainingCourseSchema,
  paginationSchema,
  updateEmployeeTrainingSchema,
  updateTrainingCourseSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { EmployeeTrainingService } from './employee-training.service';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';
import { TrainingCourseService } from './training-course.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

@Controller('hr/training')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrainingController {
  constructor(
    private readonly trainingCourseService: TrainingCourseService,
    private readonly employeeTrainingService: EmployeeTrainingService,
    private readonly auditService: AuditService,
  ) {}

  // --- Courses --------------------------------------------------------------

  @Get('courses')
  @RequirePermission('hr.training.view')
  async listCourses(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: TrainingCourseStatus,
  ) {
    const items = await this.trainingCourseService.list(user.organisationId, { status });
    return { items };
  }

  @Get('courses/:id')
  @RequirePermission('hr.training.view')
  getCourse(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.trainingCourseService.getById(user.organisationId, id);
  }

  @Post('courses')
  @RequirePermission('hr.training.manage')
  async createCourse(
    @Body(new ZodValidationPipe(createTrainingCourseSchema)) body: CreateTrainingCourseInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { trainingCourse, wasCreated } = await this.trainingCourseService.create(
      user.organisationId,
      body,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.TRAINING_COURSE_CREATED,
        entityType: 'TrainingCourse',
        entityId: trainingCourse.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: trainingCourse.code, title: trainingCourse.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return trainingCourse;
  }

  @Patch('courses/:id')
  @RequirePermission('hr.training.manage')
  async updateCourse(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTrainingCourseSchema)) body: UpdateTrainingCourseInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.trainingCourseService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_COURSE_UPDATED,
      entityType: 'TrainingCourse',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post('courses/:id/activate')
  @RequirePermission('hr.training.manage')
  async activateCourse(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.trainingCourseService.activate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_COURSE_ACTIVATED,
      entityType: 'TrainingCourse',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post('courses/:id/archive')
  @RequirePermission('hr.training.manage')
  async archiveCourse(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.trainingCourseService.archive(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_COURSE_ARCHIVED,
      entityType: 'TrainingCourse',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post('courses/:id/assignments')
  @RequirePermission('hr.training.manage')
  async assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTrainingSchema)) body: AssignTrainingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const assignment = await this.employeeTrainingService.assign(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_ASSIGNED,
      entityType: 'TrainingCourse',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { employeeId: body.employeeId, assignmentId: assignment.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return assignment;
  }

  // --- Assignments ------------------------------------------------------------

  @Get('assignments')
  @RequirePermission('hr.training.view')
  async listAssignments(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('employeeId') employeeId?: string,
    @Query('trainingCourseId') trainingCourseId?: string,
    @Query('status') status?: EmployeeTrainingStatus,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const result = await this.employeeTrainingService.list(user.organisationId, {
      page,
      pageSize,
      employeeId: employeeId || undefined,
      trainingCourseId: trainingCourseId || undefined,
      status: status || undefined,
    });
    return { items: result.items, total: result.total, page, pageSize };
  }

  @Get('assignments/:id')
  @RequirePermission('hr.training.view')
  getAssignment(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.employeeTrainingService.getById(user.organisationId, id);
  }

  @Patch('assignments/:id')
  @RequirePermission('hr.training.manage')
  async updateAssignment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeTrainingSchema)) body: UpdateEmployeeTrainingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeTrainingService.update(user.organisationId, id, body);
    if (body.status === 'IN_PROGRESS') {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.TRAINING_STARTED,
        entityType: 'EmployeeTraining',
        entityId: updated.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return updated;
  }

  @Post('assignments/:id/complete')
  @RequirePermission('hr.training.manage')
  async complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeEmployeeTrainingSchema))
    body: CompleteEmployeeTrainingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeTrainingService.complete(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_COMPLETED,
      entityType: 'EmployeeTraining',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post('assignments/:id/cancel')
  @RequirePermission('hr.training.manage')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.employeeTrainingService.cancel(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.TRAINING_CANCELLED,
      entityType: 'EmployeeTraining',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
