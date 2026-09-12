import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DepartmentStatus } from '@prisma/client';
import {
  CreateDepartmentInput,
  UpdateDepartmentInput,
  createDepartmentSchema,
  updateDepartmentSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { DepartmentService } from './department.service';
import { EmployeeService } from './employee.service';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';

@Controller('hr/departments')
@UseGuards(JwtAuthGuard)
export class DepartmentController {
  constructor(
    private readonly departmentService: DepartmentService,
    private readonly employeeService: EmployeeService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: DepartmentStatus) {
    const items = await this.departmentService.list(user.organisationId, { status });
    const withCounts = await Promise.all(
      items.map(async (department) => ({
        ...department,
        employeeCount: await this.departmentService.countEmployees(
          user.organisationId,
          department.id,
        ),
      })),
    );
    return { items: withCounts };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const department = await this.departmentService.getById(user.organisationId, id);
    const employeeCount = await this.departmentService.countEmployees(user.organisationId, id);
    return { ...department, employeeCount };
  }

  @Get(':id/employees')
  async listEmployees(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.departmentService.getById(user.organisationId, id);
    const result = await this.employeeService.list(user.organisationId, {
      departmentId: id,
      page: 1,
      pageSize: 100,
    });
    return { items: result.items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createDepartmentSchema)) body: CreateDepartmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { department, wasCreated } = await this.departmentService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.DEPARTMENT_CREATED,
        entityType: 'Department',
        entityId: department.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: department.code, name: department.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return department;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.departmentService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.DEPARTMENT_UPDATED,
      entityType: 'Department',
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
    const updated = await this.departmentService.activate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.DEPARTMENT_ACTIVATED,
      entityType: 'Department',
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
    const updated = await this.departmentService.deactivate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.DEPARTMENT_DEACTIVATED,
      entityType: 'Department',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
