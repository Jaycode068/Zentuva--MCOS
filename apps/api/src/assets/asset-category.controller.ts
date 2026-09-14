import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AssetCategory, AssetCategoryStatus } from '@prisma/client';
import {
  CreateAssetCategoryInput,
  UpdateAssetCategoryInput,
  createAssetCategorySchema,
  updateAssetCategorySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ASSET_AUDIT_ACTIONS } from './asset-audit-actions';
import { AssetCategoryService } from './asset-category.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

/**
 * Asset Category HTTP surface (Sprint 20, docs/domains/assets.md). `GET`
 * requires only authentication; every write additionally requires the
 * Owner or Administrator role.
 */
@Controller('assets/categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssetCategoryController {
  constructor(
    private readonly assetCategoryService: AssetCategoryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('assets.asset.view')
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: AssetCategoryStatus) {
    const items = await this.assetCategoryService.list(user.organisationId, { status });
    return { items: items.map(toAssetCategoryResponse) };
  }

  @Get(':id')
  @RequirePermission('assets.asset.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const assetCategory = await this.assetCategoryService.getById(user.organisationId, id);
    return toAssetCategoryResponse(assetCategory);
  }

  @Post()
  @RequirePermission('assets.asset.manage')
  async create(
    @Body(new ZodValidationPipe(createAssetCategorySchema)) body: CreateAssetCategoryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { assetCategory, wasCreated } = await this.assetCategoryService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: ASSET_AUDIT_ACTIONS.ASSET_CATEGORY_CREATED,
        entityType: 'AssetCategory',
        entityId: assetCategory.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: assetCategory.code, name: assetCategory.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toAssetCategoryResponse(assetCategory);
  }

  @Patch(':id')
  @RequirePermission('assets.asset.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAssetCategorySchema)) body: UpdateAssetCategoryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetCategoryService.update(user.organisationId, id, body);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_CATEGORY_UPDATED,
      entityType: 'AssetCategory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetCategoryResponse(updated);
  }

  @Post(':id/deactivate')
  @RequirePermission('assets.asset.manage')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.assetCategoryService.deactivate(user.organisationId, id);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_CATEGORY_DEACTIVATED,
      entityType: 'AssetCategory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetCategoryResponse(updated);
  }

  @Post(':id/activate')
  @RequirePermission('assets.asset.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.assetCategoryService.activate(user.organisationId, id);

    await this.auditService.record({
      action: ASSET_AUDIT_ACTIONS.ASSET_CATEGORY_ACTIVATED,
      entityType: 'AssetCategory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAssetCategoryResponse(updated);
  }
}

export function toAssetCategoryResponse(assetCategory: AssetCategory) {
  return {
    id: assetCategory.id,
    code: assetCategory.code,
    name: assetCategory.name,
    description: assetCategory.description,
    parentCategoryId: assetCategory.parentCategoryId,
    status: assetCategory.status,
    createdAt: assetCategory.createdAt,
    updatedAt: assetCategory.updatedAt,
  };
}
