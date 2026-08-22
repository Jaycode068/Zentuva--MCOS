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
import { ProductFamily, ProductFamilyStatus } from '@prisma/client';
import {
  CreateProductFamilyInput,
  UpdateProductFamilyInput,
  createProductFamilySchema,
  updateProductFamilySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PRODUCT_FAMILY_AUDIT_ACTIONS } from './product-family-audit-actions';
import { ProductFamilyService } from './product-family.service';

/**
 * Product Family HTTP surface (Sprint 4.7 brief, docs/domains/catalogue.md). `GET`
 * requires only authentication — Member has read-only access, same table every domain
 * since Sprint 2.1 uses; every write (`POST`/`PATCH`) additionally requires the Owner or
 * Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target family by `(id, organisationId)`
 * together, same convention as `ProductController`.
 */
@Controller('product-families')
@UseGuards(JwtAuthGuard)
export class ProductFamilyController {
  constructor(
    private readonly productFamilyService: ProductFamilyService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('status') status?: ProductFamilyStatus,
  ) {
    const families = await this.productFamilyService.list(user.organisationId, {
      search: search?.trim() || undefined,
      status,
    });
    return { items: families.map(toProductFamilyResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const family = await this.productFamilyService.getById(user.organisationId, id);
    if (!family) {
      throw new NotFoundException('Product family not found');
    }
    return toProductFamilyResponse(family);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createProductFamilySchema)) body: CreateProductFamilyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.productFamilyService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PRODUCT_FAMILY_AUDIT_ACTIONS.CREATED,
      entityType: 'ProductFamily',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: created.code, name: created.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductFamilyResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductFamilySchema)) body: UpdateProductFamilyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.productFamilyService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: PRODUCT_FAMILY_AUDIT_ACTIONS.UPDATED,
      entityType: 'ProductFamily',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductFamilyResponse(updated);
  }
}

function toProductFamilyResponse(family: ProductFamily) {
  return {
    id: family.id,
    code: family.code,
    name: family.name,
    description: family.description,
    status: family.status,
    createdAt: family.createdAt,
    updatedAt: family.updatedAt,
  };
}
