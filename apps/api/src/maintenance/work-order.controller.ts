import {
  Body,
  Controller,
  Delete,
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
import {
  MaintenanceDocumentType,
  MaintenancePriority,
  WorkOrder,
  WorkOrderStatus,
} from '@prisma/client';
import {
  AssignWorkOrderInput,
  CancelWorkOrderInput,
  CompleteWorkOrderInput,
  CreateWorkOrderInput,
  CreateWorkOrderTaskInput,
  HoldWorkOrderInput,
  UpdateWorkOrderInput,
  UpdateWorkOrderTaskInput,
  assignWorkOrderSchema,
  cancelWorkOrderSchema,
  completeWorkOrderSchema,
  createWorkOrderSchema,
  createWorkOrderTaskSchema,
  holdWorkOrderSchema,
  updateWorkOrderSchema,
  updateWorkOrderTaskSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { MAINTENANCE_AUDIT_ACTIONS } from './maintenance-audit-actions';
import { MaintenanceDocumentService } from './maintenance-document.service';
import { WorkOrderService } from './work-order.service';

/**
 * Work Order HTTP surface (Sprint 21, docs/domains/maintenance.md). `GET`
 * requires only authentication (technicians need to read their own
 * assigned work); header/lifecycle writes require Owner/Administrator,
 * matching this codebase's one binary RBAC convention throughout (no
 * separate "Technician" role exists anywhere in this system — see
 * docs/domains/maintenance.md "RBAC").
 */
@Controller('maintenance/work-orders')
@UseGuards(JwtAuthGuard)
export class WorkOrderController {
  constructor(
    private readonly workOrderService: WorkOrderService,
    private readonly maintenanceDocumentService: MaintenanceDocumentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: WorkOrderStatus,
    @Query('priority') priority?: MaintenancePriority,
    @Query('assetId') assetId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('maintenanceTypeId') maintenanceTypeId?: string,
    @Query('isPreventive') isPreventive?: string,
    @Query('search') search?: string,
  ) {
    const items = await this.workOrderService.list(user.organisationId, {
      status,
      priority,
      assetId,
      assignedToId,
      maintenanceTypeId,
      isPreventive: isPreventive === undefined ? undefined : isPreventive === 'true',
      search,
    });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.workOrderService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createWorkOrderSchema)) body: CreateWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { workOrder, wasCreated } = await this.workOrderService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_CREATED,
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { workOrderCode: workOrder.workOrderCode, title: workOrder.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return workOrder;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkOrderSchema)) body: UpdateWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.workOrderService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_UPDATED,
      entityType: 'WorkOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignWorkOrderSchema)) body: AssignWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.workOrderService.assign(user.organisationId, id, body.assignedToId),
      MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_ASSIGNED,
      { assignedToId: body.assignedToId },
    );
  }

  @Post(':id/start')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  start(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.workOrderService.start(user.organisationId, id),
      MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_STARTED,
    );
  }

  @Post(':id/hold')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  hold(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(holdWorkOrderSchema)) body: HoldWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.workOrderService.hold(user.organisationId, id, body.reason),
      MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_ON_HOLD,
    );
  }

  @Post(':id/resume')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  resume(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.workOrderService.resume(user.organisationId, id),
      MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_RESUMED,
    );
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelWorkOrderSchema)) body: CancelWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.workOrderService.cancel(user.organisationId, id, body.reason),
      MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_CANCELLED,
    );
  }

  @Post(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeWorkOrderSchema)) body: CompleteWorkOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { workOrder, wasCompleted } = await this.workOrderService.complete(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    if (wasCompleted) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_COMPLETED,
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { resolution: body.resolution },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return workOrder;
  }

  @Get(':id/tasks')
  async listTasks(@Param('id') id: string) {
    const items = await this.workOrderService.listTasks(id);
    return { items };
  }

  @Post(':id/tasks')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  addTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createWorkOrderTaskSchema)) body: CreateWorkOrderTaskInput,
    @CurrentUser() user: TokenPayload,
  ) {
    return this.workOrderService.addTask(user.organisationId, id, body);
  }

  @Patch(':id/tasks/:taskId')
  async updateTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(updateWorkOrderTaskSchema)) body: UpdateWorkOrderTaskInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.workOrderService.updateTask(user.organisationId, id, taskId, body);
    if (body.status === 'COMPLETED') {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_TASK_COMPLETED,
        entityType: 'WorkOrder',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { taskId, title: updated.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return updated;
  }

  @Get(':id/documents')
  async listDocuments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.maintenanceDocumentService.list(user.organisationId, 'WORK_ORDER', id);
    return { items };
  }

  @Post(':id/documents')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FileInterceptor('file'))
  async addDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('documentType') documentType: MaintenanceDocumentType,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    const document = await this.maintenanceDocumentService.add(
      user.organisationId,
      'WORK_ORDER',
      id,
      documentType ?? 'OTHER',
      { mimeType: file.mimetype, buffer: file.buffer, originalName: file.originalname },
      caption,
      user.sub,
    );
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.DOCUMENT_ADDED,
      entityType: 'WorkOrder',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentType: document.documentType },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return document;
  }

  @Delete(':id/documents/:documentId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.maintenanceDocumentService.remove(user.organisationId, documentId);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.DOCUMENT_REMOVED,
      entityType: 'WorkOrder',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  /** Read-only composition over the existing `AuditLog` table — the exact
   *  pattern `AssetController.getAuditHistory()` established (Sprint 20). */
  @Get(':id/audit')
  async getAuditHistory(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const events = await this.auditService.listByOrganisation(user.organisationId, {
      entityType: 'WorkOrder',
      take: 200,
    });
    const items = events.filter((event) => event.entityId === id);
    return { items };
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ workOrder: WorkOrder; transitioned: boolean }>,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    const { workOrder, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action,
        entityType: 'WorkOrder',
        entityId: workOrder.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return workOrder;
  }
}
