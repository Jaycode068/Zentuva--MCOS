import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PositionStatus } from '@prisma/client';
import {
  CreatePositionInput,
  UpdatePositionInput,
  createPositionSchema,
  updatePositionSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { EmployeeService } from './employee.service';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';
import { PositionService } from './position.service';

@Controller('hr/positions')
@UseGuards(JwtAuthGuard)
export class PositionController {
  constructor(
    private readonly positionService: PositionService,
    private readonly employeeService: EmployeeService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: PositionStatus,
    @Query('departmentId') departmentId?: string,
  ) {
    const items = await this.positionService.list(user.organisationId, { status, departmentId });
    const withCounts = await Promise.all(
      items.map(async (position) => ({
        ...position,
        employeeCount: await this.positionService.countEmployees(user.organisationId, position.id),
      })),
    );
    return { items: withCounts };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const position = await this.positionService.getById(user.organisationId, id);
    const employeeCount = await this.positionService.countEmployees(user.organisationId, id);
    return { ...position, employeeCount };
  }

  @Get(':id/employees')
  async listEmployees(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.positionService.getById(user.organisationId, id);
    const result = await this.employeeService.list(user.organisationId, {
      positionId: id,
      page: 1,
      pageSize: 100,
    });
    return { items: result.items };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createPositionSchema)) body: CreatePositionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { position, wasCreated } = await this.positionService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.POSITION_CREATED,
        entityType: 'Position',
        entityId: position.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: position.code, title: position.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return position;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePositionSchema)) body: UpdatePositionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.positionService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POSITION_UPDATED,
      entityType: 'Position',
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
    const updated = await this.positionService.activate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POSITION_ACTIVATED,
      entityType: 'Position',
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
    const updated = await this.positionService.deactivate(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POSITION_DEACTIVATED,
      entityType: 'Position',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
