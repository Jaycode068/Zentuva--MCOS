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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Product } from '@prisma/client';
import {
  CreateProductInput,
  UpdateProductInput,
  createProductSchema,
  updateProductSchema,
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
import { PRODUCT_AUDIT_ACTIONS } from './product-audit-actions';
import { ProductWithHierarchy } from './product.repository';
import { ProductService } from './product.service';

/**
 * Product Catalogue HTTP surface (Sprint 4.1 brief). `GET` requires only authentication —
 * Member has read-only access, per the brief's exact "Owner: Full access, Administrator:
 * Full access, Member: Read only" table; every write (`POST`/`PATCH`/activate/archive/
 * image upload/removal) additionally requires the Owner or Administrator role
 * (`RolesGuard`, same mechanism as every other write surface since Sprint 2.1).
 *
 * Tenant isolation: every method resolves the target product by `(id, organisationId)`
 * together, scoped to the caller's own `organisationId` from their JWT — a cross-tenant id
 * 404s exactly like a nonexistent one, same convention as `UserController`.
 */
@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('search') search?: string) {
    const products = await this.productService.list(user.organisationId, {
      search: search?.trim() || undefined,
    });
    return { items: products.map(toProductResponseWithHierarchy) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const product = await this.productService.getById(user.organisationId, id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return toProductResponseWithHierarchy(product);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.productService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.CREATED,
      entityType: 'Product',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: created.code, name: created.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.productService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.UPDATED,
      entityType: 'Product',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.productService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.ACTIVATED,
      entityType: 'Product',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(updated);
  }

  @Post(':id/archive')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async archive(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.productService.archive(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.ARCHIVED,
      entityType: 'Product',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(updated);
  }

  @Post(':id/image')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
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
    assertValidImageFile(file, this.config, 'Product image');

    const updated = await this.productService.setImage(
      user.organisationId,
      id,
      { mimeType: file.mimetype, buffer: file.buffer },
      user.sub,
    );

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.IMAGE_UPLOADED,
      entityType: 'Product',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(updated);
  }

  @Delete(':id/image')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deleteImage(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.productService.removeImage(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCT_AUDIT_ACTIONS.IMAGE_REMOVED,
      entityType: 'Product',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toProductResponse(updated);
  }
}

function toProductResponse(product: Product) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    displayName: product.displayName,
    slug: product.slug,
    category: product.category,
    type: product.type,
    shortDescription: product.shortDescription,
    longDescription: product.longDescription,
    unit: product.unit,
    imageUrl: product.imageUrl,
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    createdById: product.createdById,
    updatedById: product.updatedById,
    productVariantId: product.productVariantId,
  };
}

/** Added Sprint 4.7 — used only by `list`/`getOne`, the two read endpoints
 *  `ProductService` now resolves with hierarchy context. Write endpoints
 *  (create/update/activate/archive/image) keep returning the flat
 *  {@link toProductResponse} shape unchanged. */
function toProductResponseWithHierarchy(product: ProductWithHierarchy) {
  return {
    ...toProductResponse(product),
    productVariant: product.productVariant
      ? {
          id: product.productVariant.id,
          code: product.productVariant.code,
          name: product.productVariant.name,
          productFamily: {
            id: product.productVariant.productFamily.id,
            code: product.productVariant.productFamily.code,
            name: product.productVariant.productFamily.name,
          },
        }
      : null,
  };
}
