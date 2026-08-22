import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { OutletPhoto, OutletStatus, OutletType } from '@prisma/client';
import {
  AddOutletPhotosInput,
  CreateOutletInput,
  UpdateOutletInput,
  addOutletPhotosSchema,
  createOutletSchema,
  updateOutletSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { assertValidImageFile } from '../../identity/common/image-upload-validation';
import { OUTLET_AUDIT_ACTIONS } from './outlet-audit-actions';
import { OutletWithRelations } from './outlet.repository';
import { OutletService } from './outlet.service';

const MAX_PHOTOS_PER_REQUEST = 6;

/**
 * Outlet HTTP surface (Sprint 4.8, docs/domains/outlets.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role (`RolesGuard`).
 *
 * The photo endpoints are the first multi-file upload in this codebase
 * (`FilesInterceptor('files', 6)` + `@UploadedFiles()`, vs. every other domain's
 * single-file `FileInterceptor('file')` + `@UploadedFile()`).
 *
 * Tenant isolation: every method resolves the target outlet by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('retail/outlets')
@UseGuards(JwtAuthGuard)
export class OutletController {
  constructor(
    private readonly outletService: OutletService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: OutletStatus,
    @Query('outletType') outletType?: OutletType,
    @Query('customerId') customerId?: string,
    @Query('territoryId') territoryId?: string,
    @Query('search') search?: string,
  ) {
    const outlets = await this.outletService.list(user.organisationId, {
      status,
      outletType,
      customerId,
      territoryId,
      search: search?.trim() || undefined,
    });
    return { items: outlets.map(toOutletResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const outlet = await this.outletService.getById(user.organisationId, id);
    if (!outlet) {
      throw new NotFoundException('Outlet not found');
    }
    return toOutletResponse(outlet);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createOutletSchema)) body: CreateOutletInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.outletService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.CREATED,
      entityType: 'Outlet',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        outletCode: created.outletCode,
        name: created.name,
        customerId: created.customerId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOutletResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOutletSchema)) body: UpdateOutletInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.outletService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.UPDATED,
      entityType: 'Outlet',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOutletResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.outletService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.ACTIVATED,
      entityType: 'Outlet',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOutletResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.outletService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.DEACTIVATED,
      entityType: 'Outlet',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOutletResponse(updated);
  }

  @Post(':id/photos')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FilesInterceptor('files', MAX_PHOTOS_PER_REQUEST))
  async addPhotos(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body(new ZodValidationPipe(addOutletPhotosSchema)) body: AddOutletPhotosInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded — attach them as multipart field "files"');
    }
    for (const file of files) {
      assertValidImageFile(file, this.config, 'Outlet photo');
    }

    const photos = await this.outletService.addPhotos(
      user.organisationId,
      id,
      files.map((file) => ({ mimeType: file.mimetype, buffer: file.buffer })),
      body,
      user.sub,
    );

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.PHOTO_ADDED,
      entityType: 'Outlet',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { count: photos.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { items: photos.map(toOutletPhotoResponse) };
  }

  @Delete(':id/photos/:photoId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.outletService.removePhoto(user.organisationId, id, photoId);

    await this.auditService.record({
      action: OUTLET_AUDIT_ACTIONS.PHOTO_REMOVED,
      entityType: 'Outlet',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { photoId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { success: true };
  }
}

function toOutletPhotoResponse(photo: OutletPhoto) {
  return {
    id: photo.id,
    url: photo.url,
    photoType: photo.photoType,
    caption: photo.caption,
    createdAt: photo.createdAt,
  };
}

function toOutletResponse(outlet: OutletWithRelations) {
  return {
    id: outlet.id,
    outletCode: outlet.outletCode,
    outletType: outlet.outletType,
    name: outlet.name,
    contactPersonName: outlet.contactPersonName,
    phoneNumber: outlet.phoneNumber,
    address: outlet.address,
    city: outlet.city,
    state: outlet.state,
    country: outlet.country,
    territoryId: outlet.territoryId,
    latitude: outlet.latitude,
    longitude: outlet.longitude,
    status: outlet.status,
    notes: outlet.notes,
    createdAt: outlet.createdAt,
    updatedAt: outlet.updatedAt,
    customer: outlet.customer,
    territory: outlet.territory,
    photos: outlet.photos.map(toOutletPhotoResponse),
  };
}
