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
import { PurchaseOrderStatus } from '@prisma/client';
import {
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PURCHASE_ORDER_AUDIT_ACTIONS } from './purchase-order-audit-actions';
import { PurchaseOrderWithRelations } from './purchase-order.repository';
import { PurchaseOrderService } from './purchase-order.service';

/**
 * Procurement HTTP surface (Sprint 4.3 brief). `GET` requires only authentication —
 * Member has read-only access, same "Owner: Full access, Administrator: Full access,
 * Member: Read only" table every domain since Sprint 2.1 uses; every write
 * (`POST`/`PATCH`/cancel) additionally requires the Owner or Administrator role
 * (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target purchase order by
 * `(id, organisationId)` together, scoped to the caller's own `organisationId` from
 * their JWT — a cross-tenant id 404s exactly like a nonexistent one, same convention as
 * `SupplierController`.
 *
 * No `DELETE` endpoint exists at all (brief: "No DELETE. Cancelled POs remain in
 * history").
 */
@Controller('procurement/purchase-orders')
@UseGuards(JwtAuthGuard)
export class PurchaseOrderController {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('status') status?: PurchaseOrderStatus,
    @Query('supplierId') supplierId?: string,
  ) {
    const purchaseOrders = await this.purchaseOrderService.list(user.organisationId, {
      search: search?.trim() || undefined,
      status,
      supplierId,
    });
    return { items: purchaseOrders.map(toPurchaseOrderResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const purchaseOrder = await this.purchaseOrderService.getById(user.organisationId, id);
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }
    return toPurchaseOrderResponse(purchaseOrder);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: CreatePurchaseOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.purchaseOrderService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PURCHASE_ORDER_AUDIT_ACTIONS.CREATED,
      entityType: 'PurchaseOrder',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        purchaseOrderNumber: created.purchaseOrderNumber,
        supplierId: created.supplierId,
        total: created.total,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toPurchaseOrderResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.purchaseOrderService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: PURCHASE_ORDER_AUDIT_ACTIONS.UPDATED,
      entityType: 'PurchaseOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toPurchaseOrderResponse(updated);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.purchaseOrderService.cancel(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PURCHASE_ORDER_AUDIT_ACTIONS.CANCELLED,
      entityType: 'PurchaseOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toPurchaseOrderResponse(updated);
  }
}

function toPurchaseOrderResponse(purchaseOrder: PurchaseOrderWithRelations) {
  return {
    id: purchaseOrder.id,
    purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
    supplier: purchaseOrder.supplier,
    orderDate: purchaseOrder.orderDate,
    expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
    status: purchaseOrder.status,
    remarks: purchaseOrder.remarks,
    subtotal: purchaseOrder.subtotal,
    total: purchaseOrder.total,
    items: purchaseOrder.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    createdAt: purchaseOrder.createdAt,
    updatedAt: purchaseOrder.updatedAt,
    createdById: purchaseOrder.createdById,
    updatedById: purchaseOrder.updatedById,
    approvedById: purchaseOrder.approvedById,
  };
}
