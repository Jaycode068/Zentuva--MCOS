import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  DiscrepancyResolutionAction,
  DiscrepancyStatus,
  InventoryTransactionType,
  LocationStatus,
  ProductStatus,
  ProductType,
} from '@prisma/client';
import {
  CreateGoodsReceiptInput,
  CreateInventoryAdjustmentInput,
  CreateInventoryLocationInput,
  CreateSupplierReturnInput,
  UpdateGoodsReceiptDiscrepancyInput,
  UpdateInventoryLocationInput,
  createGoodsReceiptSchema,
  createInventoryAdjustmentSchema,
  createInventoryLocationSchema,
  createSupplierReturnSchema,
  updateGoodsReceiptDiscrepancySchema,
  updateInventoryLocationSchema,
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
  StockAdjustmentResult,
} from './inventory.service';
import { INVENTORY_AUDIT_ACTIONS } from './inventory-audit-actions';
import { InventoryTransactionWithProduct } from './inventory-transaction.repository';
import { SupplierReturnWithRelations } from './supplier-return.repository';
import { SupplierReturnService } from './supplier-return.service';

/**
 * Inventory HTTP surface (Sprint 4.4 brief, extended Sprint 4.4.1, extended again Sprint
 * 4.5 for locations and manual stock adjustments). `GET` requires only authentication —
 * Member has read-only access, same "Owner/Administrator: write, Member: Read Only" table
 * every domain since Sprint 2.1 uses; every write (`POST .../goods-receipts`,
 * `PATCH .../discrepancy`, `POST .../adjustments`, `POST .../locations`,
 * `PATCH .../locations/:id`) additionally requires the Owner or Administrator role
 * (`RolesGuard`).
 *
 * Route order matters here: `locations`, `adjustments`, `transactions`, `goods-receipts`,
 * and `purchase-orders` are literal path segments and must be declared before the
 * `:productId` wildcard route at the bottom, or Nest/Express would match e.g.
 * `GET /api/inventory/transactions` as `productId === "transactions"` instead.
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
    private readonly supplierReturnService: SupplierReturnService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('search') search?: string,
    @Query('productType') productType?: ProductType,
    @Query('productStatus') productStatus?: ProductStatus,
    @Query('locationId') locationId?: string,
  ) {
    const stock = await this.inventoryService.listStock(user.organisationId, {
      search: search?.trim() || undefined,
      productType,
      productStatus,
      locationId,
    });
    return { items: stock.map(toStockResponse) };
  }

  @Get('locations')
  async listLocations(@CurrentUser() user: TokenPayload) {
    const locations = await this.inventoryService.listLocations(user.organisationId);
    return { items: locations };
  }

  @Post('locations')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createLocation(
    @Body(new ZodValidationPipe(createInventoryLocationSchema)) body: CreateInventoryLocationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const location = await this.inventoryService.createLocation(
      user.organisationId,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: INVENTORY_AUDIT_ACTIONS.LOCATION_CREATED,
      entityType: 'InventoryLocation',
      entityId: location.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: location.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return location;
  }

  @Patch('locations/:id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateLocation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInventoryLocationSchema)) body: UpdateInventoryLocationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const location = await this.inventoryService.updateLocation(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action:
        body.status === LocationStatus.INACTIVE
          ? INVENTORY_AUDIT_ACTIONS.LOCATION_DEACTIVATED
          : INVENTORY_AUDIT_ACTIONS.LOCATION_UPDATED,
      entityType: 'InventoryLocation',
      entityId: location.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: location.name, status: location.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return location;
  }

  @Post('adjustments')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createAdjustment(
    @Body(new ZodValidationPipe(createInventoryAdjustmentSchema))
    body: CreateInventoryAdjustmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.inventoryService.adjustStock(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: INVENTORY_AUDIT_ACTIONS.ADJUSTED,
      entityType: 'InventoryStock',
      entityId: result.productId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        productId: result.productId,
        productName: result.product.name,
        locationId: result.location.id,
        locationName: result.location.name,
        reason: result.reason,
        quantityDelta: result.quantityDelta,
        previousQuantity: result.previousQuantity,
        newQuantity: result.newQuantity,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAdjustmentResponse(result);
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
    return {
      items: goodsReceipts.map((goodsReceipt) => ({
        ...toGoodsReceiptResponse(goodsReceipt),
        journalEntry: goodsReceipt.journalEntry,
      })),
    };
  }

  @Get('goods-receipts/:id')
  async getGoodsReceipt(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const goodsReceipt = await this.inventoryService.getGoodsReceiptById(user.organisationId, id);
    return { ...toGoodsReceiptResponse(goodsReceipt), journalEntry: goodsReceipt.journalEntry };
  }

  @Post('goods-receipts')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createGoodsReceipt(
    @Body(new ZodValidationPipe(createGoodsReceiptSchema)) body: CreateGoodsReceiptInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const {
      goodsReceipt,
      purchaseOrderStatus,
      isFirstReceipt,
      hasDiscrepancy,
      journalEntry,
      wasCreated,
    } = await this.inventoryService.receiveGoods(user.organisationId, body, user.sub);

    // Sprint 8: every audit block below is gated on `wasCreated` — an idempotent
    // replay (a retried request with the same `idempotencyKey`) returns the original
    // receipt but must never re-emit any of these events, matching the brief's "must
    // never produce duplicate audit entries" requirement.
    if (wasCreated) {
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
              payableQuantity: item.payableQuantity,
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

      if (journalEntry) {
        await this.auditService.record({
          action: INVENTORY_AUDIT_ACTIONS.JOURNAL_ENTRY_POSTED,
          entityType: 'GoodsReceipt',
          entityId: goodsReceipt.id,
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

    return { ...toGoodsReceiptResponse(goodsReceipt), journalEntry };
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
      body.resolutionAction as DiscrepancyResolutionAction | undefined,
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

  @Get('supplier-returns')
  async listSupplierReturns(
    @CurrentUser() user: TokenPayload,
    @Query('supplierId') supplierId?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('goodsReceiptId') goodsReceiptId?: string,
    @Query('search') search?: string,
  ) {
    const items = await this.supplierReturnService.list(user.organisationId, {
      supplierId,
      purchaseOrderId,
      goodsReceiptId,
      search: search?.trim() || undefined,
    });
    return { items: items.map(toSupplierReturnResponse) };
  }

  @Get('supplier-returns/:id')
  async getSupplierReturn(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const supplierReturn = await this.supplierReturnService.getById(user.organisationId, id);
    return toSupplierReturnResponse(supplierReturn);
  }

  /** `POST /supplier-returns` (Sprint 11, brief §15-19) — a single atomic write: no
   *  separate request/receive phase, unlike Customer Returns. */
  @Post('supplier-returns')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createSupplierReturn(
    @Body(new ZodValidationPipe(createSupplierReturnSchema)) body: CreateSupplierReturnInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { supplierReturn, journalEntry, wasCreated } = await this.supplierReturnService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.SUPPLIER_RETURN_CREATED,
        entityType: 'SupplierReturn',
        entityId: supplierReturn.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          returnCode: supplierReturn.returnCode,
          goodsReceiptId: supplierReturn.goodsReceiptId,
          items: supplierReturn.items.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (journalEntry) {
        await this.auditService.record({
          action: INVENTORY_AUDIT_ACTIONS.SUPPLIER_RETURN_JOURNAL_POSTED,
          entityType: 'SupplierReturn',
          entityId: supplierReturn.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            journalEntryId: journalEntry.id,
            journalNumber: journalEntry.journalNumber,
            totalAmount: journalEntry.totalAmount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return { ...toSupplierReturnResponse(supplierReturn), journalEntry };
  }

  /** Wildcard route — must stay last (see class doc comment). */
  @Get(':productId')
  async getByProduct(@CurrentUser() user: TokenPayload, @Param('productId') productId: string) {
    const stock = await this.inventoryService.getStockByProduct(user.organisationId, productId);
    return toStockResponse(stock);
  }
}

function toSupplierReturnResponse(supplierReturn: SupplierReturnWithRelations) {
  return {
    id: supplierReturn.id,
    returnCode: supplierReturn.returnCode,
    supplier: supplierReturn.supplier,
    purchaseOrder: supplierReturn.purchaseOrder,
    goodsReceipt: supplierReturn.goodsReceipt,
    location: supplierReturn.location,
    status: supplierReturn.status,
    returnDate: supplierReturn.returnDate,
    reason: supplierReturn.reason,
    reasonNotes: supplierReturn.reasonNotes,
    notes: supplierReturn.notes,
    photoUrl: supplierReturn.photoUrl,
    items: supplierReturn.items.map((item) => ({
      id: item.id,
      product: item.product,
      goodsReceiptItemId: item.goodsReceiptItemId,
      quantityReturned: item.quantityReturned,
      unitCost: item.unitCost,
      excessPortion: item.excessPortion,
    })),
    createdAt: supplierReturn.createdAt,
  };
}

function toStockResponse(stock: InventoryStockSummary) {
  return {
    productId: stock.productId,
    product: stock.product,
    location: stock.location,
    quantityOnHand: stock.quantityOnHand,
    quantityReserved: stock.quantityReserved,
    quantityAvailable: stock.quantityAvailable,
    lastMovement: stock.lastMovement,
    updatedAt: stock.updatedAt,
  };
}

function toAdjustmentResponse(result: StockAdjustmentResult) {
  return {
    productId: result.productId,
    product: result.product,
    location: result.location,
    reason: result.reason,
    quantityDelta: result.quantityDelta,
    previousQuantity: result.previousQuantity,
    newQuantity: result.newQuantity,
    transactionId: result.transactionId,
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
      // Added Sprint 8 — see `GoodsReceiptItem.payableQuantity`. May be less than
      // `acceptedQuantity` when goods were accepted beyond the Purchase Order's own
      // ordered quantity (docs/domains/accounting.md "Accepted vs. Payable").
      payableQuantity: item.payableQuantity,
      // Added Sprint 11/12 — cumulative counters `SupplierReturnRepository`/
      // `SupplierInvoiceRepository` maintain on this same row from their own
      // transactions (docs/domains/accounting.md "Supplier Invoice Matching"). Exposed
      // here purely as more of this row's own data, same as `payableQuantity` above —
      // Inventory computes nothing from them.
      returnedQuantity: item.returnedQuantity,
      returnedExcessQuantity: item.returnedExcessQuantity,
      invoicedQuantity: item.invoicedQuantity,
      unitPrice: item.purchaseOrderItem.unitPrice,
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
