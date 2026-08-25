import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ProductionOrderStatus } from '@prisma/client';
import {
  CompleteProductionOrderInput,
  CreateMaterialIssueInput,
  CreateProductionOrderInput,
  UpdateProductionOrderInput,
  completeProductionOrderSchema,
  createMaterialIssueSchema,
  createProductionOrderSchema,
  updateProductionOrderSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ProductionMaterialIssueWithItems } from './production-material-issue.repository';
import { ProductionOrderWithRelations } from './production-order.repository';
import { ProductionOrderService } from './production-order.service';
import { PRODUCTION_AUDIT_ACTIONS } from './production-audit-actions';

/**
 * Production Order HTTP surface (Sprint 4.6 brief, docs/domains/production.md). `GET`
 * requires only authentication — Member has read-only access; every write additionally
 * requires the Owner or Administrator role (`RolesGuard`), same convention as every
 * other domain controller.
 *
 * Every path here has a literal prefix (`orders/`, `.../plan`, `.../material-issues`,
 * ...) — there is no wildcard/`:id`-only catch-all route in this controller, so the
 * "literal segments before the wildcard" ordering discipline other controllers need
 * doesn't apply here.
 */
@Controller('production/orders')
@UseGuards(JwtAuthGuard)
export class ProductionOrderController {
  constructor(
    private readonly productionOrderService: ProductionOrderService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: ProductionOrderStatus,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
  ) {
    const orders = await this.productionOrderService.list(user.organisationId, {
      status,
      productId,
      search: search?.trim() || undefined,
    });
    return { items: orders.map(toOrderResponse) };
  }

  @Get(':id')
  async getById(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const order = await this.productionOrderService.getById(user.organisationId, id);
    return toOrderResponse(order);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createProductionOrderSchema)) body: CreateProductionOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const order = await this.productionOrderService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.ORDER_CREATED,
      entityType: 'ProductionOrder',
      entityId: order.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        productionOrderNumber: order.productionOrderNumber,
        productId: order.productId,
        plannedQuantity: order.plannedQuantity,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOrderResponse(order);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductionOrderSchema)) body: UpdateProductionOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const order = await this.productionOrderService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.ORDER_UPDATED,
      entityType: 'ProductionOrder',
      entityId: order.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { productionOrderNumber: order.productionOrderNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOrderResponse(order);
  }

  @Get(':id/availability')
  async getAvailability(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.productionOrderService.getAvailability(user.organisationId, id);
    return { items };
  }

  @Post(':id/plan')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async plan(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const order = await this.productionOrderService.plan(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.ORDER_PLANNED,
      entityType: 'ProductionOrder',
      entityId: order.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { productionOrderNumber: order.productionOrderNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOrderResponse(order);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const order = await this.productionOrderService.cancel(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: PRODUCTION_AUDIT_ACTIONS.ORDER_CANCELLED,
      entityType: 'ProductionOrder',
      entityId: order.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { productionOrderNumber: order.productionOrderNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOrderResponse(order);
  }

  @Get(':id/material-issues')
  async listMaterialIssues(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const issues = await this.productionOrderService.listMaterialIssues(user.organisationId, id);
    return { items: issues.map(toMaterialIssueResponse) };
  }

  /** Added Sprint 9 — read-only accounting summary (brief §14/§15), see
   *  `ProductionOrderService.getAccountingSummary`. */
  @Get(':id/accounting')
  getAccountingSummary(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.productionOrderService.getAccountingSummary(user.organisationId, id);
  }

  @Post(':id/material-issues')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async issueMaterial(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createMaterialIssueSchema)) body: CreateMaterialIssueInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { materialIssue, transitionedToInProgress, journalEntry, wasCreated } =
      await this.productionOrderService.issueMaterial(user.organisationId, id, body, user.sub);

    // Sprint 9: every audit block below is gated on `wasCreated` — an idempotent
    // replay (a retried request with the same `idempotencyKey`) returns the original
    // issue but must never re-emit any of these events.
    if (wasCreated) {
      await this.auditService.record({
        action: PRODUCTION_AUDIT_ACTIONS.MATERIAL_ISSUED,
        entityType: 'ProductionMaterialIssue',
        entityId: materialIssue.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          productionOrderId: id,
          items: materialIssue.items.map((item) => ({
            componentProductId: item.componentProductId,
            productName: item.componentProduct.name,
            quantityIssued: item.quantityIssued,
          })),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (transitionedToInProgress) {
        await this.auditService.record({
          action: PRODUCTION_AUDIT_ACTIONS.ORDER_STARTED,
          entityType: 'ProductionOrder',
          entityId: id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      if (journalEntry) {
        await this.auditService.record({
          action: PRODUCTION_AUDIT_ACTIONS.MATERIAL_ISSUE_JOURNAL_POSTED,
          entityType: 'ProductionMaterialIssue',
          entityId: materialIssue.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            journalEntryId: journalEntry.id,
            journalNumber: journalEntry.journalNumber,
            amount: journalEntry.totalAmount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return { ...toMaterialIssueResponse(materialIssue), journalEntry };
  }

  @Get(':id/production-run')
  async getProductionRun(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.productionOrderService.getProductionRun(user.organisationId, id);
  }

  @Post(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeProductionOrderSchema)) body: CompleteProductionOrderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { productionOrder, productionRun, journalEntry, wasCreated } =
      await this.productionOrderService.completeProduction(user.organisationId, id, body, user.sub);

    if (wasCreated) {
      await this.auditService.record({
        action: PRODUCTION_AUDIT_ACTIONS.COMPLETED,
        entityType: 'ProductionOrder',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          productionOrderNumber: productionOrder.productionOrderNumber,
          producedQuantity: productionRun.producedQuantity,
          rejectedQuantity: productionRun.rejectedQuantity,
          acceptedQuantity: productionRun.acceptedQuantity,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (productionRun.acceptedQuantity > 0) {
        await this.auditService.record({
          action: PRODUCTION_AUDIT_ACTIONS.FINISHED_GOODS_RECEIVED,
          entityType: 'ProductionRun',
          entityId: productionRun.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: { productionOrderId: id, acceptedQuantity: productionRun.acceptedQuantity },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      if (journalEntry) {
        await this.auditService.record({
          action: PRODUCTION_AUDIT_ACTIONS.COMPLETION_JOURNAL_POSTED,
          entityType: 'ProductionRun',
          entityId: productionRun.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            journalEntryId: journalEntry.id,
            journalNumber: journalEntry.journalNumber,
            amount: journalEntry.totalAmount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return {
      productionOrder: toOrderResponse(productionOrder),
      productionRun,
      journalEntry,
    };
  }
}

function toOrderResponse(order: ProductionOrderWithRelations) {
  return {
    id: order.id,
    productionOrderNumber: order.productionOrderNumber,
    product: order.product,
    billOfMaterial: order.billOfMaterial,
    plannedQuantity: order.plannedQuantity,
    location: order.location,
    status: order.status,
    notes: order.notes,
    items: order.items.map((item) => ({
      id: item.id,
      componentProduct: item.componentProduct,
      requiredQuantity: item.requiredQuantity,
      unitOfMeasure: item.unitOfMeasure,
    })),
    productionRun: order.productionRun,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function toMaterialIssueResponse(materialIssue: ProductionMaterialIssueWithItems) {
  return {
    id: materialIssue.id,
    productionOrderId: materialIssue.productionOrderId,
    issuedDate: materialIssue.issuedDate,
    issuedById: materialIssue.issuedById,
    notes: materialIssue.notes,
    items: materialIssue.items.map((item) => ({
      id: item.id,
      componentProduct: item.componentProduct,
      quantityIssued: item.quantityIssued,
    })),
    createdAt: materialIssue.createdAt,
  };
}
