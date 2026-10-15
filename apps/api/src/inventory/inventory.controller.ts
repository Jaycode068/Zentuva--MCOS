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
  CreateInventoryTransferInput,
  CreateSupplierReturnInput,
  RecordOpeningStockInput,
  ReverseInventoryTransferInput,
  UpdateGoodsReceiptDiscrepancyInput,
  UpdateInventoryLocationInput,
  createGoodsReceiptSchema,
  createInventoryAdjustmentSchema,
  createInventoryLocationSchema,
  createInventoryTransferSchema,
  createSupplierReturnSchema,
  recordOpeningStockSchema,
  reverseInventoryTransferSchema,
  updateGoodsReceiptDiscrepancySchema,
  updateInventoryLocationSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { GoodsReceiptWithRelations } from './goods-receipt.repository';
import {
  CreateTransferResult,
  InventoryStockSummary,
  InventoryService,
  OpeningStockResult,
  PurchaseOrderReceivingSummary,
  StockAdjustmentResult,
  TransferSummary,
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly supplierReturnService: SupplierReturnService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('inventory.stock.view')
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
  @RequirePermission('inventory.stock.view')
  async listLocations(@CurrentUser() user: TokenPayload) {
    const locations = await this.inventoryService.listLocations(user.organisationId);
    return { items: locations };
  }

  @Post('locations')
  @RequirePermission('inventory.location.manage')
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
      // `locationType`/`outletId` added Phase 2A — the existing LOCATION_CREATED
      // action already covers this; no new audit action was introduced for it (see
      // docs/customer-location-inventory-architecture-audit.md §10).
      metadata: {
        name: location.name,
        locationType: location.locationType,
        outletId: location.outletId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return location;
  }

  @Patch('locations/:id')
  @RequirePermission('inventory.location.manage')
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

  /** Added Phase 2B (brief §5 "minimum useful view" for an Outlet's stock position) —
   *  a thin convenience wrapper over the existing `GET /inventory?locationId=` filter,
   *  scoped to one location and tenant-checked first so an unknown/cross-tenant id
   *  404s instead of silently returning an empty list. No new read logic: reuses
   *  `listStock` exactly as the top-level `list` route above already does. */
  @Get('locations/:id/stock')
  @RequirePermission('inventory.stock.view')
  async getLocationStock(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.inventoryService.getLocationOrThrow(user.organisationId, id);
    const stock = await this.inventoryService.listStock(user.organisationId, { locationId: id });
    return { items: stock.map(toStockResponse) };
  }

  /** Added Phase 2B (brief §6 "Opening Stock and Reconciliation"). See
   *  `InventoryService.recordOpeningStock`'s own doc comment. Reuses the existing
   *  `inventory.adjustment.create` permission — see the permission catalogue's own
   *  comment on why no new permission was added for this action. */
  @Post('locations/:id/opening-stock')
  @RequirePermission('inventory.adjustment.create')
  async recordOpeningStock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordOpeningStockSchema)) body: RecordOpeningStockInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.inventoryService.recordOpeningStock(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: INVENTORY_AUDIT_ACTIONS.OPENING_STOCK_RECORDED,
      entityType: 'InventoryStock',
      entityId: result.productId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        productId: result.productId,
        productName: result.product.name,
        locationId: result.location.id,
        locationName: result.location.name,
        quantity: result.quantity,
        ownership: result.ownership,
        arrangement: result.arrangement,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOpeningStockResponse(result);
  }

  /** Added Phase 2B (brief §3). Route declared before the `:productId` wildcard, same
   *  "literal segments first" rule as `locations`/`adjustments`/`transactions`. */
  @Get('transfers')
  @RequirePermission('inventory.stock.view')
  async listTransfers(
    @CurrentUser() user: TokenPayload,
    @Query('productId') productId?: string,
    @Query('locationId') locationId?: string,
  ) {
    const transfers = await this.inventoryService.listTransfers(user.organisationId, {
      productId,
      locationId,
    });
    return { items: transfers.map(toTransferResponse) };
  }

  @Get('transfers/:id')
  @RequirePermission('inventory.stock.view')
  async getTransfer(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const transfer = await this.inventoryService.getTransferById(user.organisationId, id);
    return toTransferResponse(transfer);
  }

  @Post('transfers')
  @RequirePermission('inventory.transfer.create')
  async createTransfer(
    @Body(new ZodValidationPipe(createInventoryTransferSchema)) body: CreateInventoryTransferInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.inventoryService.createTransfer(user.organisationId, body, user.sub);

    if (result.wasCreated) {
      await this.auditService.record({
        action: INVENTORY_AUDIT_ACTIONS.TRANSFER_CREATED,
        entityType: 'InventoryTransfer',
        entityId: result.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          transferNumber: result.transferNumber,
          productId: result.product.id,
          sourceLocationId: result.sourceLocation.id,
          destinationLocationId: result.destinationLocation.id,
          quantity: result.quantity,
          ownership: result.ownership,
          arrangement: result.arrangement,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toTransferResponse(result);
  }

  @Post('transfers/:id/reverse')
  @RequirePermission('inventory.transfer.reverse')
  async reverseTransfer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reverseInventoryTransferSchema))
    body: ReverseInventoryTransferInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const reversal = await this.inventoryService.reverseTransfer(
      user.organisationId,
      id,
      body.notes,
      user.sub,
    );

    await this.auditService.record({
      action: INVENTORY_AUDIT_ACTIONS.TRANSFER_REVERSED,
      entityType: 'InventoryTransfer',
      entityId: reversal.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        transferNumber: reversal.transferNumber,
        reversalOfTransferId: reversal.reversalOfTransferId,
        productId: reversal.product.id,
        quantity: reversal.quantity,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toTransferResponse(reversal);
  }

  @Post('adjustments')
  @RequirePermission('inventory.adjustment.create')
  async createAdjustment(
    @Body(new ZodValidationPipe(createInventoryAdjustmentSchema))
    body: CreateInventoryAdjustmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.inventoryService.adjustStock(user.organisationId, body, user.sub);

    // Added Stage 4E.4B — gated on `wasCreated` so a retried request (resolved to an
    // already-committed adjustment, no stock touched) does not write a second,
    // misleading audit entry for the same operation. Same convention as `createTransfer`
    // above.
    if (result.wasCreated) {
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

      // Stage 4E.4D — fired only when this (fresh) call actually posted a journal,
      // same "fired only when a journal was actually posted" gating convention as
      // `SUPPLIER_RETURN_JOURNAL_POSTED`.
      if (result.journalEntryId) {
        await this.auditService.record({
          action: INVENTORY_AUDIT_ACTIONS.ADJUSTMENT_JOURNAL_POSTED,
          entityType: 'InventoryStock',
          entityId: result.productId,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            productId: result.productId,
            locationId: result.location.id,
            journalEntryId: result.journalEntryId,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return toAdjustmentResponse(result);
  }

  @Get('transactions')
  @RequirePermission('inventory.stock.view')
  async listTransactions(
    @CurrentUser() user: TokenPayload,
    @Query('productId') productId?: string,
    @Query('transactionType') transactionType?: InventoryTransactionType,
    @Query('locationId') locationId?: string,
  ) {
    const transactions = await this.inventoryService.listTransactions(user.organisationId, {
      productId,
      transactionType,
      locationId,
    });
    return { items: transactions.map(toTransactionResponse) };
  }

  @Get('goods-receipts')
  @RequirePermission('inventory.stock.view')
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
  @RequirePermission('inventory.stock.view')
  async getGoodsReceipt(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const goodsReceipt = await this.inventoryService.getGoodsReceiptById(user.organisationId, id);
    return { ...toGoodsReceiptResponse(goodsReceipt), journalEntry: goodsReceipt.journalEntry };
  }

  @Post('goods-receipts')
  @UseGuards(PermissionsGuard)
  @RequirePermission('inventory.goods_receipt.create')
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
  @RequirePermission('inventory.goods_receipt.create')
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
  @RequirePermission('inventory.stock.view')
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
  @RequirePermission('inventory.stock.view')
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
  @RequirePermission('inventory.stock.view')
  async getSupplierReturn(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const supplierReturn = await this.supplierReturnService.getById(user.organisationId, id);
    return toSupplierReturnResponse(supplierReturn);
  }

  /** `POST /supplier-returns` (Sprint 11, brief §15-19) — a single atomic write: no
   *  separate request/receive phase, unlike Customer Returns. */
  @Post('supplier-returns')
  @RequirePermission('inventory.supplier_return.create')
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
  @RequirePermission('inventory.stock.view')
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

function toTransferResponse(transfer: TransferSummary | CreateTransferResult) {
  return {
    id: transfer.id,
    transferNumber: transfer.transferNumber,
    product: transfer.product,
    sourceLocation: transfer.sourceLocation,
    destinationLocation: transfer.destinationLocation,
    quantity: transfer.quantity,
    ownership: transfer.ownership,
    arrangement: transfer.arrangement,
    status: transfer.status,
    notes: transfer.notes,
    reversalOfTransferId: transfer.reversalOfTransferId,
    createdById: transfer.createdById,
    createdAt: transfer.createdAt,
  };
}

function toOpeningStockResponse(result: OpeningStockResult) {
  return {
    productId: result.productId,
    product: result.product,
    location: result.location,
    quantity: result.quantity,
    ownership: result.ownership,
    arrangement: result.arrangement,
    transactionId: result.transactionId,
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
    journalEntryId: result.journalEntryId,
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
