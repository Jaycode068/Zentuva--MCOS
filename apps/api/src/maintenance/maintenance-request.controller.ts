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
  MaintenanceRequest,
  MaintenanceRequestStatus,
} from '@prisma/client';
import {
  ConvertMaintenanceRequestInput,
  CreateMaintenanceRequestInput,
  RejectMaintenanceRequestInput,
  UpdateMaintenanceRequestInput,
  convertMaintenanceRequestSchema,
  createMaintenanceRequestSchema,
  rejectMaintenanceRequestSchema,
  updateMaintenanceRequestSchema,
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
import { MaintenanceRequestService } from './maintenance-request.service';

/**
 * Maintenance Request HTTP surface (Sprint 21, docs/domains/
 * maintenance.md). `GET` requires only authentication; every write
 * additionally requires the Owner or Administrator role.
 */
@Controller('maintenance/requests')
@UseGuards(JwtAuthGuard)
export class MaintenanceRequestController {
  constructor(
    private readonly maintenanceRequestService: MaintenanceRequestService,
    private readonly maintenanceDocumentService: MaintenanceDocumentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: MaintenanceRequestStatus,
    @Query('assetId') assetId?: string,
    @Query('priority') priority?: MaintenancePriority,
  ) {
    const items = await this.maintenanceRequestService.list(user.organisationId, {
      status,
      assetId,
      priority,
    });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.maintenanceRequestService.getById(user.organisationId, id);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createMaintenanceRequestSchema))
    body: CreateMaintenanceRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { maintenanceRequest, wasCreated } = await this.maintenanceRequestService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_CREATED,
        entityType: 'MaintenanceRequest',
        entityId: maintenanceRequest.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { requestCode: maintenanceRequest.requestCode, title: maintenanceRequest.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return maintenanceRequest;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaintenanceRequestSchema))
    body: UpdateMaintenanceRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.maintenanceRequestService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_UPDATED,
      entityType: 'MaintenanceRequest',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  approve(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.maintenanceRequestService.approve(user.organisationId, id, user.sub),
      MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_APPROVED,
    );
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectMaintenanceRequestSchema))
    body: RejectMaintenanceRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.maintenanceRequestService.reject(user.organisationId, id, body, user.sub),
      MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_REJECTED,
    );
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.maintenanceRequestService.cancel(user.organisationId, id),
      MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_CANCELLED,
    );
  }

  @Post(':id/convert')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async convert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(convertMaintenanceRequestSchema))
    body: ConvertMaintenanceRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { maintenanceRequest, workOrder, wasCreated } =
      await this.maintenanceRequestService.convert(user.organisationId, id, body, user.sub);
    if (wasCreated) {
      await this.auditService.record({
        action: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_CONVERTED,
        entityType: 'MaintenanceRequest',
        entityId: maintenanceRequest.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { workOrderId: workOrder.id, workOrderCode: workOrder.workOrderCode },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return { maintenanceRequest, workOrder };
  }

  @Get(':id/documents')
  async listDocuments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.maintenanceDocumentService.list(user.organisationId, 'REQUEST', id);
    return { items };
  }

  @Post(':id/documents')
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
      'REQUEST',
      id,
      documentType ?? 'OTHER',
      { mimeType: file.mimetype, buffer: file.buffer, originalName: file.originalname },
      caption,
      user.sub,
    );
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.DOCUMENT_ADDED,
      entityType: 'MaintenanceRequest',
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
  async removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.maintenanceDocumentService.remove(user.organisationId, documentId);
    await this.auditService.record({
      action: MAINTENANCE_AUDIT_ACTIONS.DOCUMENT_REMOVED,
      entityType: 'MaintenanceRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ request: MaintenanceRequest; transitioned: boolean }>,
    action: string,
  ) {
    const { request, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action,
        entityType: 'MaintenanceRequest',
        entityId: request.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return request;
  }
}
