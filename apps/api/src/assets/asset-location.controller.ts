import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AssetLocation, AssetLocationStatus } from '@prisma/client';
import {
  CreateAssetLocationInput,
  UpdateAssetLocationInput,
  createAssetLocationSchema,
  updateAssetLocationSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ASSET_AUDIT_ACTIONS } from './asset-audit-actions';
import { AssetLocationService } from './asset-location.service';

/**
 * Asset Location HTTP surface (Sprint 20, docs/domains/assets.md). `GET`
 * requires only authentication; every write additionally requires the
 * Owner or Administrator role.
 */
@Controller('assets/locations')
@UseGuards(JwtAuthGuard)
export class AssetLocationController {
  constructor(
    private readonly assetLocationService: AssetLocationService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: AssetLocationStatus) {
    const items = await this.assetLocationService.list(user.organisationId, { status });
    return { items: items.map(toAssetLocationResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const assetLocation = await this.assetLocationService.getById(user.organisationId, id);
    return toAssetLocationResponse(assetLocation);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createAssetLocationSchema)) body: CreateAssetLocationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { assetLocation, wasCreated } = await this.assetLocationService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: ASSET_AUDIT_ACTIONS.ASSET_LOCATION_CREATED,
        entityType: 'AssetLocation',
        entityId: assetLocation.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: assetLocation.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toAssetLocationResponse(assetLocation);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAssetLocationSchema)) body: UpdateAssetLocationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetLocationService.update(user.organisationId, id, body);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_LOCATION_UPDATED,
      entityType: 'AssetLocation',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetLocationResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetLocationService.deactivate(user.organisationId, id);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_LOCATION_DEACTIVATED,
      entityType: 'AssetLocation',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetLocationResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.assetLocationService.activate(user.organisationId, id);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_LOCATION_ACTIVATED,
      entityType: 'AssetLocation',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetLocationResponse(updated);
  }
}

export function toAssetLocationResponse(assetLocation: AssetLocation) {
  return {
    id: assetLocation.id,
    name: assetLocation.name,
    parentLocationId: assetLocation.parentLocationId,
    status: assetLocation.status,
    createdAt: assetLocation.createdAt,
    updatedAt: assetLocation.updatedAt,
  };
}
