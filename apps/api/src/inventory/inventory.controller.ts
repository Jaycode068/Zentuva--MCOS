import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DiscrepancyStatus, InventoryTransactionType, ProductType } from '@prisma/client';
import {
  CreateGoodsReceiptInput,
  UpdateGoodsReceiptDiscrepancyInput,
  createGoodsReceiptSchema,
  updateGoodsReceiptDiscrepancySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { GoodsReceiptWithRelations } from './goods-receipt.repository';
import {
  InventoryStockSummary,
  InventoryService,
  PurchaseOrderReceivingSummary,
} from './inventory.service';
import { INVENTORY_AUDIT_ACTIONS } from './inventory-audit-actions';
import { InventoryTransactionWithProduct } from './inventory-transaction.repository';

/**
 * Inventory HTTP surface (Sprint 4.4 brief, extended Sprint 4.4.1). `GET` requires only
 * authentication — Member has read-only access, same "Owner/Administrator: Receive
 * Goods, Member: Read Only" table every domain since Sprint 2.1 uses; every write
 * (`POST .../goods-receipts`, `PATCH .../discrepancy`) additionally requires the Owner or
 * Administrator role (`RolesGuard`).
 *
 * Route order matters here: `transactions`, `goods-receipts`, and `purchase-orders` are
 * literal path segments and must be declared before the `:productId` wildcard route at
 * the bottom, or Nest/Express would match e.g. `GET /api/inventory/transactions` as
 * `productId === "transactions"` instead.
 *
 * Tenant isolation: every method resolves its target by `(id, organisationId)` together,
 * scoped to the caller's own `organisationId` from their JWT — same convention as every
 * other domain controller. Goods Receipts remain immutable (brief: "No editing. No
 * deleting.") — `PATCH .../discrepancy` is the sole, narrow exception, and only ever
 * touches the discrepancy-resolution fields, never what was actually received.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('productType') productType?: ProductType,
  ) {
    const stock = await this.inventoryService.listStock(user.organisationId, {
      search: search?.trim() || undefined,
      productType,
    });
    return { items: stock.map(toStockResponse) };
  }

  @Get('transactions')
  async listTransactions(
    @CurrentUser() user: TokenPayload,
    @Query('productId') productId?: string,
    @Query('transactionType') transactionType?: InventoryTransactionType,
  ) {
    const transactions = await this.inventoryService.listTransactions(user.organisationId, {
      productId,
      transactionType,
    });
    return { items: transactions.map(toTransactionResponse) };
  }

  @Get('goods-receipts')
  async listGoodsReceipts(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    const goodsReceipts = await this.inventoryService.listGoodsReceipts(user.organisationId, {
      search: search?.trim() || undefined,
      purchaseOrderId,
    });
    return { items: goodsReceipts.map(toGoodsReceiptResponse) };
  }

  @Get('goods-receipts/:id')
  async getGoodsReceipt(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const goodsReceipt = await this.inventoryService.getGoodsReceiptById(user.organisationId, id);
    return toGoodsReceiptResponse(goodsReceipt);
  }

  @Post('goods-receipts')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createGoodsReceipt(
    @Body(new ZodValidationPipe(createGoodsReceiptSchema)) body: CreateGoodsReceiptInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { goodsReceipt, purchaseOrderStatus, isFirstReceipt, hasDiscrepancy } =
      await this.inventoryService.receiveGoods(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: INVENTORY_AUDIT_ACTIONS.GOODS_RECEIVED,
      entityType: 'GoodsReceipt',
      entityId: goodsReceipt.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        goodsReceiptNumber: goodsReceipt.goodsReceiptNumber,
        purchaseOrderId: goodsReceipt.purchaseOrderId,
        purchaseOrderNumber: goodsReceipt.purchaseOrder.purchaseOrderNumber,
        purchaseOrderStatus,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const acceptedItems = goodsReceipt.items.filter((item) => item.acceptedQuantity > 0);
    if (acceptedItems.length > 0) {
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.INVENTORY_INCREASED,
        entityType: 'GoodsReceipt',
        entityId: goodsReceipt.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          items: acceptedItems.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            acceptedQuantity: item.acceptedQuantity,
          })),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    if (hasDiscrepancy) {
      const rejectedItems = goodsReceipt.items.filter((item) => item.rejectedQuantity > 0);
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.DISCREPANCY_RECORDED,
        entityType: 'GoodsReceipt',
        entityId: goodsReceipt.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          items: rejectedItems.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            rejectedQuantity: item.rejectedQuantity,
            rejectionReason: item.rejectionReason,
          })),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    if (!isFirstReceipt) {
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.REPLACEMENT_RECEIVED,
        entityType: 'GoodsReceipt',
        entityId: goodsReceipt.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          goodsReceiptNumber: goodsReceipt.goodsReceiptNumber,
          purchaseOrderId: goodsReceipt.purchaseOrderId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toGoodsReceiptResponse(goodsReceipt);
  }

  @Patch('goods-receipts/:id/discrepancy')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateDiscrepancy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGoodsReceiptDiscrepancySchema))
    body: UpdateGoodsReceiptDiscrepancyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.inventoryService.updateDiscrepancyStatus(
      user.organisationId,
      id,
      body.status as DiscrepancyStatus,
      body.notes,
    );

    if (body.status === 'RESOLVED') {
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.RESOLVED,
        entityType: 'GoodsReceipt',
        entityId: updated.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toGoodsReceiptResponse(updated);
  }

  @Get('purchase-orders/:purchaseOrderId/receiving')
  async getPurchaseOrderReceivingSummary(
    @CurrentUser() user: TokenPayload,
    @Param('purchaseOrderId') purchaseOrderId: string,
  ) {
    const summary = await this.inventoryService.getPurchaseOrderReceivingSummary(
      user.organisationId,
      purchaseOrderId,
    );
    return toReceivingSummaryResponse(summary);
  }

  /** Wildcard route — must stay last (see class doc comment). */
  @Get(':productId')
  async getByProduct(@CurrentUser() user: TokenPayload, @Param('productId') productId: string) {
    const stock = await this.inventoryService.getStockByProduct(user.organisationId, productId);
    return toStockResponse(stock);
  }
}

function toStockResponse(stock: InventoryStockSummary) {
  return {
    productId: stock.productId,
    product: stock.product,
    quantityOnHand: stock.quantityOnHand,
    updatedAt: stock.updatedAt,
  };
}

function toTransactionResponse(transaction: InventoryTransactionWithProduct) {
  return {
    id: transaction.id,
    product: transaction.product,
    transactionType: transaction.transactionType,
    quantity: transaction.quantity,
    referenceType: transaction.referenceType,
    referenceId: transaction.referenceId,
    createdAt: transaction.createdAt,
  };
}

function toGoodsReceiptResponse(goodsReceipt: GoodsReceiptWithRelations) {
  return {
    id: goodsReceipt.id,
    goodsReceiptNumber: goodsReceipt.goodsReceiptNumber,
    purchaseOrder: goodsReceipt.purchaseOrder,
    supplier: goodsReceipt.supplier,
    receivedDate: goodsReceipt.receivedDate,
    remarks: goodsReceipt.remarks,
    discrepancyStatus: goodsReceipt.discrepancyStatus,
    discrepancyNotes: goodsReceipt.discrepancyNotes,
    items: goodsReceipt.items.map((item) => ({
      id: item.id,
      purchaseOrderItemId: item.purchaseOrderItemId,
      product: item.product,
      deliveredQuantity: item.deliveredQuantity,
      rejectedQuantity: item.rejectedQuantity,
      acceptedQuantity: item.acceptedQuantity,
      rejectionReason: item.rejectionReason,
      rejectionNotes: item.rejectionNotes,
    })),
    createdAt: goodsReceipt.createdAt,
    receivedById: goodsReceipt.receivedById,
  };
}

function toReceivingSummaryResponse(summary: PurchaseOrderReceivingSummary) {
  return {
    purchaseOrder: summary.purchaseOrder,
    items: summary.items,
    receipts: summary.receipts.map(toGoodsReceiptResponse),
  };
}
