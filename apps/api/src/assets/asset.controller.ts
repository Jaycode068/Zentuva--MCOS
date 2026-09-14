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
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Asset,
  AssetAcquisitionType,
  AssetCondition,
  AssetDocumentType,
  AssetStatus,
} from '@prisma/client';
import {
  CreateAssetInput,
  CreateAssetMeterInput,
  RecordMeterReadingInput,
  TransferAssetInput,
  UpdateAssetInput,
  createAssetMeterSchema,
  createAssetSchema,
  recordMeterReadingSchema,
  transferAssetSchema,
  updateAssetSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { assertValidImageFile } from '../identity/common/image-upload-validation';
import { ASSET_AUDIT_ACTIONS } from './asset-audit-actions';
import { AssetDocumentService } from './asset-document.service';
import { AssetMeterService } from './asset-meter.service';
import { AssetService } from './asset.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

/**
 * Asset HTTP surface (Sprint 20, docs/domains/assets.md). `GET` (including
 * every calculation/read endpoint) requires only authentication; every
 * write additionally requires the Owner or Administrator role.
 */
@Controller('assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly assetDocumentService: AssetDocumentService,
    private readonly assetMeterService: AssetMeterService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @RequirePermission('assets.asset.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: AssetStatus,
    @Query('condition') condition?: AssetCondition,
    @Query('categoryId') categoryId?: string,
    @Query('locationId') locationId?: string,
    @Query('custodianId') custodianId?: string,
    @Query('acquisitionType') acquisitionType?: AssetAcquisitionType,
    @Query('search') search?: string,
  ) {
    const items = await this.assetService.list(user.organisationId, {
      status,
      condition,
      categoryId,
      locationId,
      custodianId,
      acquisitionType,
      search,
    });
    return { items };
  }

  @Get('custodians')
  @RequirePermission('assets.asset.view')
  async listCustodians(@CurrentUser() user: TokenPayload) {
    const items = await this.assetService.listCustodianCandidates(user.organisationId);
    return {
      items: items.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      })),
    };
  }

  @Get(':id')
  @RequirePermission('assets.asset.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.assetService.getById(user.organisationId, id);
  }

  @Get(':id/children')
  @RequirePermission('assets.asset.view')
  async getChildren(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.assetService.getChildren(user.organisationId, id);
    return { items };
  }

  @Get(':id/tree')
  @RequirePermission('assets.asset.view')
  getTree(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.assetService.getTree(user.organisationId, id);
  }

  @Get(':id/movements')
  @RequirePermission('assets.asset.view')
  async listMovements(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.assetService.listMovements(user.organisationId, id);
    return { items };
  }

  @Post()
  @RequirePermission('assets.asset.manage')
  async create(
    @Body(new ZodValidationPipe(createAssetSchema)) body: CreateAssetInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { asset, wasCreated } = await this.assetService.create(
      user.organisationId,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: ASSET_AUDIT_ACTIONS.ASSET_CREATED,
        entityType: 'Asset',
        entityId: asset.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { assetCode: asset.assetCode, name: asset.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return asset;
  }

  @Patch(':id')
  @RequirePermission('assets.asset.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: UpdateAssetInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/activate')
  @RequirePermission('assets.asset.manage')
  activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.activate(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_ACTIVATED,
    );
  }

  @Post(':id/commission')
  @RequirePermission('assets.asset.manage')
  commission(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.commission(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_COMMISSIONED,
    );
  }

  @Post(':id/start-maintenance')
  @RequirePermission('assets.asset.manage')
  startMaintenance(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.startMaintenance(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_STATUS_CHANGED,
    );
  }

  @Post(':id/resume-service')
  @RequirePermission('assets.asset.manage')
  resumeService(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.resumeService(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_STATUS_CHANGED,
    );
  }

  @Post(':id/take-out-of-service')
  @RequirePermission('assets.asset.manage')
  takeOutOfService(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.takeOutOfService(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_STATUS_CHANGED,
    );
  }

  @Post(':id/return-to-service')
  @RequirePermission('assets.asset.manage')
  returnToService(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.returnToService(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_STATUS_CHANGED,
    );
  }

  @Post(':id/dispose')
  @RequirePermission('assets.asset.manage')
  dispose(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.dispose(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_DISPOSED,
    );
  }

  @Post(':id/retire')
  @RequirePermission('assets.asset.manage')
  retire(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    return this.handleTransition(
      id,
      user,
      req,
      () => this.assetService.retire(user.organisationId, id),
      ASSET_AUDIT_ACTIONS.ASSET_RETIRED,
    );
  }

  @Post(':id/transfer')
  @RequirePermission('assets.asset.manage')
  async transfer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transferAssetSchema)) body: TransferAssetInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { asset, wasCreated } = await this.assetService.transfer(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    if (wasCreated) {
      await this.auditService.record({
        action: ASSET_AUDIT_ACTIONS.ASSET_TRANSFERRED,
        entityType: 'Asset',
        entityId: asset.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { newLocationId: body.newLocationId, newCustodianId: body.newCustodianId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return asset;
  }

  @Post(':id/image')
  @RequirePermission('assets.asset.manage')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    assertValidImageFile(file, this.config, 'Asset photo');

    const updated = await this.assetService.setImage(
      user.organisationId,
      id,
      { mimeType: file.mimetype, buffer: file.buffer },
      user.sub,
    );

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_IMAGE_UPLOADED,
      entityType: 'Asset',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return updated;
  }

  @Delete(':id/image')
  @RequirePermission('assets.asset.manage')
  async deleteImage(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetService.removeImage(user.organisationId, id);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_IMAGE_REMOVED,
      entityType: 'Asset',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return updated;
  }

  @Get(':id/documents')
  @RequirePermission('assets.asset.view')
  async listDocuments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.assetDocumentService.list(user.organisationId, id);
    return { items };
  }

  @Post(':id/documents')
  @RequirePermission('assets.asset.manage')
  @UseInterceptors(FileInterceptor('file'))
  async addDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('documentType') documentType: AssetDocumentType,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    const document = await this.assetDocumentService.add(
      user.organisationId,
      id,
      documentType ?? 'OTHER',
      { mimeType: file.mimetype, buffer: file.buffer, originalName: file.originalname },
      caption,
      user.sub,
    );

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_DOCUMENT_ADDED,
      entityType: 'Asset',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentType: document.documentType, fileName: file.originalname },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return document;
  }

  @Delete(':id/documents/:documentId')
  @RequirePermission('assets.asset.manage')
  async removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.assetDocumentService.remove(user.organisationId, id, documentId);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_DOCUMENT_REMOVED,
      entityType: 'Asset',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { documentId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { success: true };
  }

  @Get(':id/meters')
  @RequirePermission('assets.asset.view')
  async listMeters(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.assetMeterService.list(user.organisationId, id);
    return { items };
  }

  @Post(':id/meters')
  @RequirePermission('assets.asset.manage')
  async addMeter(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createAssetMeterSchema)) body: CreateAssetMeterInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const meter = await this.assetMeterService.create(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_METER_CREATED,
      entityType: 'Asset',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { meterType: meter.meterType, unit: meter.unit },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return meter;
  }

  @Get(':id/meters/:meterId/readings')
  @RequirePermission('assets.asset.view')
  async listMeterReadings(@CurrentUser() user: TokenPayload, @Param('meterId') meterId: string) {
    const items = await this.assetMeterService.listReadings(user.organisationId, meterId);
    return { items };
  }

  @Post(':id/meters/:meterId/readings')
  @RequirePermission('assets.asset.manage')
  async recordMeterReading(
    @Param('id') id: string,
    @Param('meterId') meterId: string,
    @Body(new ZodValidationPipe(recordMeterReadingSchema)) body: RecordMeterReadingInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { reading, meter, wasCreated } = await this.assetMeterService.recordReading(
      user.organisationId,
      meterId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: ASSET_AUDIT_ACTIONS.ASSET_METER_READING_RECORDED,
        entityType: 'Asset',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { meterId, reading: reading.reading },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return { reading, meter };
  }

  /** Read-only composition over the existing `AuditLog` table — the exact
   *  pattern `DecisionAnalysisController` established (Sprint 19). */
  @Get(':id/audit')
  @RequirePermission('assets.asset.view')
  async getAuditHistory(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const events = await this.auditService.listByOrganisation(user.organisationId, {
      entityType: 'Asset',
      take: 200,
    });
    const items = events.filter((event) => event.entityId === id);
    return { items };
  }

  private async handleTransition(
    id: string,
    user: TokenPayload,
    req: Request,
    run: () => Promise<{ asset: Asset; transitioned: boolean }>,
    action: string,
  ) {
    const { asset, transitioned } = await run();
    if (transitioned) {
      await this.auditService.record({
        action,
        entityType: 'Asset',
        entityId: asset.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return asset;
  }
}
