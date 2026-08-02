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
import { Supplier } from '@prisma/client';
import {
  CreateSupplierInput,
  UpdateSupplierInput,
  createSupplierSchema,
  updateSupplierSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { SUPPLIER_AUDIT_ACTIONS } from './supplier-audit-actions';
import { SupplierService } from './supplier.service';

/**
 * Supplier Management HTTP surface (Sprint 4.2 brief). `GET` requires only
 * authentication — Member has read-only access, same "Owner: Full access, Administrator:
 * Full access, Member: Read only" table every domain since Sprint 2.1 uses; every write
 * (`POST`/`PATCH`) additionally requires the Owner or Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target supplier by `(id, organisationId)`
 * together, scoped to the caller's own `organisationId` from their JWT — a cross-tenant id
 * 404s exactly like a nonexistent one, same convention as `ProductController`.
 *
 * No `DELETE` endpoint exists at all (brief: "Do not implement delete. Suppliers should
 * instead become INACTIVE" — a status change via `PATCH`).
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SupplierController {
  constructor(
    private readonly supplierService: SupplierService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('status') status?: Supplier['status'],
    @Query('category') category?: Supplier['supplierCategory'],
  ) {
    const suppliers = await this.supplierService.list(user.organisationId, {
      search: search?.trim() || undefined,
      status,
      category,
    });
    return { items: suppliers.map(toSupplierResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const supplier = await this.supplierService.getById(user.organisationId, id);
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return toSupplierResponse(supplier);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.supplierService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: SUPPLIER_AUDIT_ACTIONS.CREATED,
      entityType: 'Supplier',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { supplierCode: created.supplierCode, supplierName: created.supplierName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.supplierService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: resolveUpdateAuditAction(body),
      entityType: 'Supplier',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierResponse(updated);
  }
}

/** One audit event per `PATCH` call: a status change to `ACTIVE`/`INACTIVE` is recorded as
 *  activated/deactivated (the brief's four distinct actions), anything else as a generic
 *  update. If a request changes both status and other fields, the status event wins — same
 *  convention as `UserController.resolveUpdateAuditAction`. */
function resolveUpdateAuditAction(body: UpdateSupplierInput): string {
  if (body.status === 'ACTIVE') return SUPPLIER_AUDIT_ACTIONS.ACTIVATED;
  if (body.status === 'INACTIVE') return SUPPLIER_AUDIT_ACTIONS.DEACTIVATED;
  return SUPPLIER_AUDIT_ACTIONS.UPDATED;
}

function toSupplierResponse(supplier: Supplier) {
  return {
    id: supplier.id,
    supplierCode: supplier.supplierCode,
    supplierName: supplier.supplierName,
    displayName: supplier.displayName,
    contactPerson: supplier.contactPerson,
    email: supplier.email,
    phoneNumber: supplier.phoneNumber,
    website: supplier.website,
    country: supplier.country,
    state: supplier.state,
    city: supplier.city,
    address: supplier.address,
    taxIdentificationNumber: supplier.taxIdentificationNumber,
    supplierCategory: supplier.supplierCategory,
    status: supplier.status,
    notes: supplier.notes,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    createdById: supplier.createdById,
    updatedById: supplier.updatedById,
  };
}
