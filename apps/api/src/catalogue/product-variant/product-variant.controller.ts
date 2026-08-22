import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProductVariant, ProductVariantStatus } from '@prisma/client';
import {
  CreateProductVariantInput,
  UpdateProductVariantInput,
  createProductVariantSchema,
  updateProductVariantSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PRODUCT_VARIANT_AUDIT_ACTIONS } from './product-variant-audit-actions';
import { ProductVariantService } from './product-variant.service';

/**
 * Product Variant HTTP surface (Sprint 4.7 brief, docs/domains/catalogue.md). `GET`
 * requires only authentication — Member has read-only access; every write additionally
 * requires the Owner or Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target variant by `(id, organisationId)`
 * together, same convention as `ProductController`/`ProductFamilyController`.
 */
@Controller('product-variants')
@UseGuards(JwtAuthGuard)
export class ProductVariantController {
  constructor(
    private readonly productVariantService: ProductVariantService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('productFamilyId') productFamilyId?: string,
    @Query('search') search?: string,
    @Query('status') status?: ProductVariantStatus,
  ) {
    const variants = await this.productVariantService.list(user.organisationId, {
      productFamilyId,
      search: search?.trim() || undefined,
      status,
    });
    return { items: variants.map(toProductVariantResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const variant = await this.productVariantService.getById(user.organisationId, id);
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    return toProductVariantResponse(variant);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createProductVariantSchema)) body: CreateProductVariantInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.productVariantService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PRODUCT_VARIANT_AUDIT_ACTIONS.CREATED,
      entityType: 'ProductVariant',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        code: created.code,
        name: created.name,
        productFamilyId: created.productFamilyId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductVariantResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductVariantSchema)) body: UpdateProductVariantInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.productVariantService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: PRODUCT_VARIANT_AUDIT_ACTIONS.UPDATED,
      entityType: 'ProductVariant',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductVariantResponse(updated);
  }
}

function toProductVariantResponse(variant: ProductVariant) {
  return {
    id: variant.id,
    productFamilyId: variant.productFamilyId,
    code: variant.code,
    name: variant.name,
    description: variant.description,
    status: variant.status,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}
