import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmployeeDocumentType, EmploymentStatus, EmploymentType } from '@prisma/client';
import {
  AssignEmployeeDepartmentInput,
  AssignEmployeeManagerInput,
  AssignEmployeePositionInput,
  AssignEmployeeWorkScheduleInput,
  CompleteOnboardingInput,
  CreateEmployeeInput,
  LinkEmployeeUserInput,
  SeparateEmployeeInput,
  StartOnboardingInput,
  SuspendEmployeeInput,
  UpdateEmployeeDocumentInput,
  UpdateEmployeeInput,
  assignEmployeeDepartmentSchema,
  assignEmployeeManagerSchema,
  assignEmployeePositionSchema,
  assignEmployeeWorkScheduleSchema,
  completeOnboardingSchema,
  createEmployeeSchema,
  linkEmployeeUserSchema,
  paginationSchema,
  separateEmployeeSchema,
  startOnboardingSchema,
  suspendEmployeeSchema,
  updateEmployeeDocumentSchema,
  updateEmployeeSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AttendanceService } from './attendance.service';
import { EmployeeDocumentService } from './employee-document.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeTrainingService } from './employee-training.service';
import { EmployeeService } from './employee.service';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';
import { PolicyService } from './policy.service';

@Controller('hr/employees')
@UseGuards(JwtAuthGuard)
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly onboardingService: EmployeeOnboardingService,
    private readonly documentService: EmployeeDocumentService,
    private readonly attendanceService: AttendanceService,
    private readonly policyService: PolicyService,
    private readonly employeeTrainingService: EmployeeTrainingService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('positionId') positionId?: string,
    @Query('employmentType') employmentType?: EmploymentType,
    @Query('employmentStatus') employmentStatus?: EmploymentStatus,
    @Query('unlinkedOnly') unlinkedOnlyRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const result = await this.employeeService.list(user.organisationId, {
      page,
      pageSize,
      search: search || undefined,
      departmentId: departmentId || undefined,
      positionId: positionId || undefined,
      employmentType: employmentType || undefined,
      employmentStatus: employmentStatus || undefined,
      unlinkedOnly: unlinkedOnlyRaw === 'true',
    });
    return { items: result.items, total: result.total, page, pageSize };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.employeeService.getByIdWithRelations(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const employee = await this.employeeService.create(user.organisationId, body, user.sub);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_CREATED,
      entityType: 'Employee',
      entityId: employee.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { employeeCode: employee.employeeCode },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return employee;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_UPDATED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/department')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async assignDepartment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignEmployeeDepartmentSchema))
    body: AssignEmployeeDepartmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.assignDepartment(
      user.organisationId,
      id,
      body.departmentId,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_DEPARTMENT_ASSIGNED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { departmentId: body.departmentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/position')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async assignPosition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignEmployeePositionSchema)) body: AssignEmployeePositionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.assignPosition(
      user.organisationId,
      id,
      body.positionId,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_POSITION_ASSIGNED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { positionId: body.positionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/manager')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async assignManager(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignEmployeeManagerSchema)) body: AssignEmployeeManagerInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.assignManager(
      user.organisationId,
      id,
      body.managerEmployeeId,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_MANAGER_ASSIGNED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { managerEmployeeId: body.managerEmployeeId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/work-schedule')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async assignWorkSchedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignEmployeeWorkScheduleSchema))
    body: AssignEmployeeWorkScheduleInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.assignWorkSchedule(
      user.organisationId,
      id,
      body.workScheduleId,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_WORK_SCHEDULE_ASSIGNED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { workScheduleId: body.workScheduleId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/link-user')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async linkUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linkEmployeeUserSchema)) body: LinkEmployeeUserInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.linkUser(user.organisationId, id, body.userId);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_USER_LINKED,
      entityType: 'Employee',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { userId: body.userId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/unlink-user')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async unlinkUser(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.employeeService.unlinkUser(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_USER_UNLINKED,
      entityType: 'Employee',
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
  activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.employeeService.activate(user.organisationId, id),
      'EMPLOYEE_ACTIVATED',
    );
  }

  @Post(':id/suspend')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  suspend(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(suspendEmployeeSchema)) _body: SuspendEmployeeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.employeeService.suspend(user.organisationId, id),
      'EMPLOYEE_SUSPENDED',
    );
  }

  @Post(':id/reactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  reactivate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.employeeService.reactivate(user.organisationId, id),
      'EMPLOYEE_REACTIVATED',
    );
  }

  @Post(':id/separate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  separate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(separateEmployeeSchema)) body: SeparateEmployeeInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.employeeService.separate(user.organisationId, id, body),
      'EMPLOYEE_SEPARATED',
    );
  }

  // --- Documents ---------------------------------------------------------

  @Get(':id/documents')
  async listDocuments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.documentService.list(user.organisationId, id);
    return { items };
  }

  @Post(':id/documents')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FileInterceptor('file'))
  async addDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('documentType') documentType: EmployeeDocumentType,
    @Body('name') name: string,
    @Body('description') description: string | undefined,
    @Body('issuedDate') issuedDate: string | undefined,
    @Body('expiryDate') expiryDate: string | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    const document = await this.documentService.add(
      user.organisationId,
      id,
      documentType,
      name,
      description,
      issuedDate ? new Date(issuedDate) : undefined,
      expiryDate ? new Date(expiryDate) : undefined,
      { mimeType: file.mimetype, buffer: file.buffer },
      user.sub,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_ADDED,
      entityType: 'Employee',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentId: document.id, documentType },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return document;
  }

  @Patch(':id/documents/:documentId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body(new ZodValidationPipe(updateEmployeeDocumentSchema)) body: UpdateEmployeeDocumentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.documentService.update(user.organisationId, id, documentId, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_UPDATED,
      entityType: 'Employee',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  // --- Onboarding ----------------------------------------------------------

  @Get(':id/onboarding')
  getOnboarding(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.onboardingService.getByEmployeeId(user.organisationId, id);
  }

  @Post(':id/onboarding/start')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async startOnboarding(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startOnboardingSchema)) body: StartOnboardingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { onboarding, wasCreated } = await this.onboardingService.start(
      user.organisationId,
      id,
      body.targetCompletionDate,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.ONBOARDING_STARTED,
        entityType: 'Employee',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { onboardingId: onboarding.id },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return onboarding;
  }

  @Patch(':id/onboarding/tasks/:taskId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async completeOnboardingTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { task, wasCompleted } = await this.onboardingService.completeTask(
      user.organisationId,
      id,
      taskId,
      user.sub,
    );
    if (wasCompleted) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.ONBOARDING_TASK_COMPLETED,
        entityType: 'Employee',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { taskId, title: task.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return task;
  }

  @Post(':id/onboarding/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async completeOnboarding(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeOnboardingSchema)) body: CompleteOnboardingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { onboarding, wasCompleted } = await this.onboardingService.complete(
      user.organisationId,
      id,
      body.notes,
    );
    if (wasCompleted) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.ONBOARDING_COMPLETED,
        entityType: 'Employee',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { onboardingId: onboarding.id },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return onboarding;
  }

  // --- Sprint 24: attendance / policy / training summaries -----------------

  @Get(':id/attendance')
  getAttendance(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('dateFrom') dateFromRaw?: string,
    @Query('dateTo') dateToRaw?: string,
  ) {
    const now = new Date();
    const dateTo = dateToRaw ? new Date(dateToRaw) : now;
    const dateFrom = dateFromRaw ? new Date(dateFromRaw) : new Date(now.getTime() - 30 * 86400000);
    return this.attendanceService.listForEmployee(user.organisationId, id, dateFrom, dateTo);
  }

  @Get(':id/training')
  async getTraining(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.employeeTrainingService.listForEmployee(user.organisationId, id);
    return { items };
  }

  @Get(':id/policy-acknowledgements')
  async getPolicyAcknowledgements(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.policyService.listAcknowledgementsForEmployee(user.organisationId, id);
    return { items };
  }

  // --- Audit -----------------------------------------------------------

  /** Read-only composition over the existing `AuditLog` table — the exact
   *  pattern `WorkOrderController.getAuditHistory()` established. */
  @Get(':id/audit')
  async getAuditHistory(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const events = await this.auditService.listByOrganisation(user.organisationId, {
      entityType: 'Employee',
      take: 200,
    });
    const items = events.filter((event) => event.entityId === id);
    return { items };
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ employee: { id: string }; transitioned: boolean }>,
    actionKey: keyof typeof HR_AUDIT_ACTIONS,
  ) {
    const { employee, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS[actionKey],
        entityType: 'Employee',
        entityId: employee.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return employee;
  }
}
