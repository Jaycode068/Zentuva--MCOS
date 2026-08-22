import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import {
  CreateSalesFulfilmentInput,
  CreateSalesOrderInput,
  UpdateSalesOrderInput,
  createSalesFulfilmentSchema,
  createSalesOrderSchema,
  updateSalesOrderSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { SALES_AUDIT_ACTIONS } from './sales-audit-actions';
import { SalesFulfilmentWithItems } from './sales-fulfilment.repository';
import { SalesFulfilmentService } from './sales-fulfilment.service';
import { SalesOrderWithRelations } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

/**
 * Sales Order HTTP surface (Sprint 4.8, docs/domains/sales.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role (`RolesGuard`) — see docs/domains/sales.md "Known
 * Limitations" for why "Sales Agent" is not yet its own role.
 *
 * Tenant isolation: every method resolves the target order by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('sales/orders')
@UseGuards(JwtAuthGuard)
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly salesFulfilmentService: SalesFulfilmentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: SalesOrderStatus,
    @Query('customerId') customerId?: string,
    @Query('outletId') outletId?: string,
    @Query('search') search?: string,
  ) {
    const orders = await this.salesOrderService.list(user.organisationId, {
      status,
      customerId,
      outletId,
      search: search?.trim() || undefined,
    });
    return { items: orders.map(toSalesOrderResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const order = await this.salesOrderService.getById(user.organisationId, id);
    return toSalesOrderResponse(order);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createSalesOrderSchema)) body: CreateSalesOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.salesOrderService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CREATED,
      entityType: 'SalesOrder',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        orderCode: created.orderCode,
        customerId: created.customerId,
        outletId: created.outletId,
        total: created.total,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalesOrderSchema)) body: UpdateSalesOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.salesOrderService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_UPDATED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  @Post(':id/confirm')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async confirm(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.salesOrderService.confirm(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CONFIRMED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.salesOrderService.cancel(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.ORDER_CANCELLED,
      entityType: 'SalesOrder',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSalesOrderResponse(updated);
  }

  /** `GET /:id/availability` (Sprint 4.9) — read-only, auth-only (Member can see it).
   *  Never gates `fulfil()`; purely informational. */
  @Get(':id/availability')
  async getAvailability(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    const items = await this.salesFulfilmentService.getAvailability(
      user.organisationId,
      id,
      locationId,
    );
    return { items };
  }

  /** `GET /:id/fulfilments` (Sprint 4.9) — fulfilment history, auth-only. */
  @Get(':id/fulfilments')
  async listFulfilments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.salesFulfilmentService.listFulfilments(user.organisationId, id);
    return { items: items.map(toSalesFulfilmentResponse) };
  }

  /** `POST /:id/fulfil` (Sprint 4.9) — THE one write in this domain that actually moves
   *  inventory. Only emits an audit event when `wasCreated === true` — a replayed
   *  idempotent request (same `idempotencyKey`) must not double-record history. */
  @Post(':id/fulfil')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async fulfil(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSalesFulfilmentSchema)) body: CreateSalesFulfilmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { fulfilment, order, wasCreated } = await this.salesFulfilmentService.fulfil(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: SALES_AUDIT_ACTIONS.ORDER_FULFILLED,
        entityType: 'SalesOrder',
        entityId: order.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          fulfilmentId: fulfilment.id,
          newStatus: order.status,
          items: fulfilment.items.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toSalesOrderResponse(order);
  }
}

function toSalesFulfilmentResponse(fulfilment: SalesFulfilmentWithItems) {
  return {
    id: fulfilment.id,
    fulfilmentDate: fulfilment.fulfilmentDate,
    location: fulfilment.location,
    notes: fulfilment.notes,
    items: fulfilment.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantityFulfilled: item.quantityFulfilled,
    })),
    createdAt: fulfilment.createdAt,
  };
}

function toSalesOrderResponse(order: SalesOrderWithRelations) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    customer: order.customer,
    outlet: order.outlet,
    salesAgentId: order.salesAgentId,
    status: order.status,
    orderDate: order.orderDate,
    notes: order.notes,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    items: order.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      quantityFulfilled: item.quantityFulfilled,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
