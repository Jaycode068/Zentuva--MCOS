import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BillOfMaterialStatus } from '@prisma/client';
import {
  CreateBillOfMaterialInput,
  UpdateBillOfMaterialInput,
  createBillOfMaterialSchema,
  updateBillOfMaterialSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { BillOfMaterialService } from './bill-of-material.service';
import { BillOfMaterialWithRelations } from './bill-of-material.repository';
import { PRODUCTION_AUDIT_ACTIONS } from './production-audit-actions';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

/**
 * Bill of Materials HTTP surface (Sprint 4.6 brief, docs/domains/production.md). `GET`
 * requires only authentication — Member has read-only access, same "Owner/Administrator:
 * write, Member: Read Only" table every domain since Sprint 2.1 uses; every write
 * (`POST`, `PATCH`, `.../activate`, `.../deactivate`) additionally requires the Owner or
 * Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves its target by `(id, organisationId)` together,
 * scoped to the caller's own `organisationId` from their JWT — same convention as every
 * other domain controller.
 */
@Controller('production/boms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BillOfMaterialController {
  constructor(
    private readonly billOfMaterialService: BillOfMaterialService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('production.bill_of_material.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('productId') productId?: string,
    @Query('status') status?: BillOfMaterialStatus,
    @Query('search') search?: string,
  ) {
    const boms = await this.billOfMaterialService.list(user.organisationId, {
      productId,
      status,
      search: search?.trim() || undefined,
    });
    return { items: boms.map(toBomResponse) };
  }

  @Get(':id')
  @RequirePermission('production.bill_of_material.view')
  async getById(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const bom = await this.billOfMaterialService.getById(user.organisationId, id);
    return toBomResponse(bom);
  }

  @Post()
  @RequirePermission('production.bill_of_material.manage')
  async create(
    @Body(new ZodValidationPipe(createBillOfMaterialSchema)) body: CreateBillOfMaterialInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const bom = await this.billOfMaterialService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.BOM_CREATED,
      entityType: 'BillOfMaterial',
      entityId: bom.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        bomNumber: bom.bomNumber,
        productId: bom.productId,
        productName: bom.product.name,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toBomResponse(bom);
  }

  @Patch(':id')
  @RequirePermission('production.bill_of_material.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBillOfMaterialSchema)) body: UpdateBillOfMaterialInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const bom = await this.billOfMaterialService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.BOM_UPDATED,
      entityType: 'BillOfMaterial',
      entityId: bom.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { bomNumber: bom.bomNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toBomResponse(bom);
  }

  @Post(':id/activate')
  @RequirePermission('production.bill_of_material.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const bom = await this.billOfMaterialService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.BOM_ACTIVATED,
      entityType: 'BillOfMaterial',
      entityId: bom.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { bomNumber: bom.bomNumber, productId: bom.productId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toBomResponse(bom);
  }

  @Post(':id/deactivate')
  @RequirePermission('production.bill_of_material.manage')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const bom = await this.billOfMaterialService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.BOM_DEACTIVATED,
      entityType: 'BillOfMaterial',
      entityId: bom.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { bomNumber: bom.bomNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toBomResponse(bom);
  }
}

function toBomResponse(bom: BillOfMaterialWithRelations) {
  return {
    id: bom.id,
    bomNumber: bom.bomNumber,
    product: bom.product,
    name: bom.name,
    status: bom.status,
    yieldQuantity: bom.yieldQuantity,
    notes: bom.notes,
    items: bom.items.map((item) => ({
      id: item.id,
      componentProduct: item.componentProduct,
      quantity: item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      notes: item.notes,
    })),
    createdAt: bom.createdAt,
    updatedAt: bom.updatedAt,
  };
}
