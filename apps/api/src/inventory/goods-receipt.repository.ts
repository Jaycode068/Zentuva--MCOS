import { Injectable } from '@nestjs/common';
import {
  DiscrepancyStatus,
  GoodsReceipt,
  GoodsReceiptItem,
  InventoryTransactionType,
  PurchaseOrderStatus,
  RejectionReason,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListGoodsReceiptsParams {
  purchaseOrderId?: string;
  /** Simple case-insensitive substring match against the GRN number or the supplier's
   *  name (same convention as `PurchaseOrderRepository.findManyByOrganisation`). */
  search?: string;
}

export type GoodsReceiptWithRelations = GoodsReceipt & {
  items: (GoodsReceiptItem & {
    product: { id: string; code: string; name: string; unit: string };
  })[];
  supplier: { id: string; supplierCode: string; supplierName: string };
  purchaseOrder: { id: string; purchaseOrderNumber: string };
  location: { id: string; name: string };
};

const RELATIONS_INCLUDE = {
  items: {
    include: { product: { select: { id: true, code: true, name: true, unit: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  supplier: { select: { id: true, supplierCode: true, supplierName: true } },
  purchaseOrder: { select: { id: true, purchaseOrderNumber: true } },
  location: { select: { id: true, name: true } },
};

export interface ReceivingTotals {
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
}

export interface ReceiveGoodsItemData {
  purchaseOrderItemId: string;
  productId: string;
  deliveredQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  rejectionReason?: RejectionReason;
  rejectionNotes?: string;
}

export interface ReceiveGoodsData {
  organisationId: string;
  purchaseOrderId: string;
  /** Every one of the Purchase Order's own items (id + ordered quantity), supplied by
   *  `InventoryService` — it already has them from `PurchaseOrderRepository.findById`, so
   *  this transaction never needs to read `purchase_order_items` itself; only the final
   *  `purchase_orders.status` write below touches Procurement's tables at all. */
  purchaseOrderItems: { id: string; quantity: number }[];
  goodsReceiptNumber: string;
  supplierId: string;
  /** Sprint 4.5 — the physical location this delivery is received into. Resolved by
   *  `InventoryService` before this transaction runs (either the caller's explicit
   *  choice or `InventoryLocationRepository.getOrCreateDefault`), so this file never
   *  needs to touch that resolution itself. */
  locationId: string;
  receivedDate: Date;
  receivedById: string;
  remarks?: string;
  discrepancyStatus: DiscrepancyStatus;
  items: ReceiveGoodsItemData[];
}

export interface ReceiveGoodsResult {
  goodsReceipt: GoodsReceiptWithRelations;
  purchaseOrderStatus: PurchaseOrderStatus;
}

/** Thrown when the Purchase Order is `DRAFT`/`CANCELLED` at the moment the transaction
 *  actually runs — the same eligibility `InventoryService`'s pre-check already
 *  validated, re-checked here to close a race against a *concurrent cancel* landing
 *  between that pre-check and this transaction. Its own `Error` subclass (not
 *  `BadRequestException`) because this file has no Nest HTTP context — same
 *  "repository stays framework-agnostic, service throws HTTP exceptions" convention as
 *  `PurchaseOrderRepository`/`SupplierRepository`; `InventoryService` catches this and
 *  translates it into a `400`. */
export class GoodsReceiptConflictError extends Error {}

/**
 * Thin Prisma access for the GoodsReceipt aggregate (Sprint 4.4, refined Sprint 4.4.1,
 * docs/domains/inventory.md).
 *
 * `receive` runs the entire "record one delivery event against a Purchase Order"
 * operation inside a single `$transaction`: creating the GoodsReceipt + items,
 * incrementing `InventoryStock` by each item's *accepted* quantity (never delivered —
 * see docs/domains/inventory.md "Important Business Rule"), appending `InventoryTransaction`
 * (`RECEIPT`) rows, and setting the Purchase Order's status to `PARTIALLY_RECEIVED` or
 * `RECEIVED` depending on whether every item's cumulative delivered quantity (across this
 * and every prior receipt) now meets its ordered quantity. Sprint 4.4.1 removed the old
 * "received once" restriction — a Purchase Order may have many `GoodsReceipt` rows,
 * including against an order already `RECEIVED` (a supplier's later replacement
 * shipment, brief §6/§7). The transaction's own conditional `updateMany` (matching every
 * status except `DRAFT`/`CANCELLED`) exists to close the race against a *concurrent
 * cancel*, not to block legitimate repeat receiving.
 *
 * The `purchaseOrder.updateMany` call is a deliberate, narrow exception to ADR-002's
 * domain-ownership convention — see the Sprint 4.4 completion report and
 * docs/domains/inventory.md §6 for the full rationale (atomicity: splitting the status
 * write into a second call after this transaction commits would reintroduce the
 * non-atomicity this design exists to avoid). Every *read* this domain needs stays
 * within its own tables or goes through Procurement's exported `PurchaseOrderRepository`
 * — see `InventoryService`.
 */
@Injectable()
export class GoodsReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<GoodsReceiptWithRelations | null> {
    return this.prisma.goodsReceipt.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListGoodsReceiptsParams = {},
  ): Promise<GoodsReceiptWithRelations[]> {
    return this.prisma.goodsReceipt.findMany({
      where: {
        organisationId,
        ...(params.purchaseOrderId ? { purchaseOrderId: params.purchaseOrderId } : {}),
        ...(params.search
          ? {
              OR: [
                { goodsReceiptNumber: { contains: params.search, mode: 'insensitive' } },
                { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `GoodsReceipt.goodsReceiptNumber` schema comment) — checked
   *  without an `organisationId` filter, same convention as `Product.code`/
   *  `PurchaseOrder.purchaseOrderNumber`. */
  async existsByNumber(goodsReceiptNumber: string): Promise<boolean> {
    const count = await this.prisma.goodsReceipt.count({ where: { goodsReceiptNumber } });
    return count > 0;
  }

  /** Cumulative delivered/accepted/rejected quantity per `PurchaseOrderItem`, summed
   *  across every `GoodsReceipt` ever recorded against this Purchase Order — the raw
   *  material `InventoryService` combines with each item's *ordered* quantity (read via
   *  `PurchaseOrderRepository`, not here) to compute outstanding/excess. Scoped through
   *  `goodsReceipt.organisationId` — same tenant-safety convention as every other
   *  lookup, even though `purchaseOrderId` alone is already a globally unique cuid. */
  async getReceivingTotals(
    organisationId: string,
    purchaseOrderId: string,
  ): Promise<Map<string, ReceivingTotals>> {
    const rows = await this.prisma.goodsReceiptItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: { goodsReceipt: { organisationId, purchaseOrderId } },
      _sum: { deliveredQuantity: true, acceptedQuantity: true, rejectedQuantity: true },
    });
    const totals = new Map<string, ReceivingTotals>();
    for (const row of rows) {
      totals.set(row.purchaseOrderItemId, {
        deliveredQuantity: row._sum.deliveredQuantity ?? 0,
        acceptedQuantity: row._sum.acceptedQuantity ?? 0,
        rejectedQuantity: row._sum.rejectedQuantity ?? 0,
      });
    }
    return totals;
  }

  async receive(data: ReceiveGoodsData): Promise<ReceiveGoodsResult> {
    return this.prisma.$transaction(async (tx) => {
      const priorTotalsRows = await tx.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: {
          goodsReceipt: {
            organisationId: data.organisationId,
            purchaseOrderId: data.purchaseOrderId,
          },
        },
        _sum: { deliveredQuantity: true },
      });
      const priorDelivered = new Map(
        priorTotalsRows.map((row) => [row.purchaseOrderItemId, row._sum.deliveredQuantity ?? 0]),
      );
      const newlyDelivered = new Map<string, number>();
      for (const item of data.items) {
        newlyDelivered.set(
          item.purchaseOrderItemId,
          (newlyDelivered.get(item.purchaseOrderItemId) ?? 0) + item.deliveredQuantity,
        );
      }

      // Every item on the Purchase Order — not just the ones on this receipt — must have
      // met its ordered quantity for the order to be fully `RECEIVED`. An item this
      // receipt never touches simply carries forward its existing (possibly zero)
      // cumulative delivered total.
      const fullyDelivered = data.purchaseOrderItems.every((poItem) => {
        const cumulativeDelivered =
          (priorDelivered.get(poItem.id) ?? 0) + (newlyDelivered.get(poItem.id) ?? 0);
        return cumulativeDelivered >= poItem.quantity;
      });
      const newStatus = fullyDelivered
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;

      const transition = await tx.purchaseOrder.updateMany({
        where: {
          id: data.purchaseOrderId,
          organisationId: data.organisationId,
          // Every status except DRAFT (never issued) and CANCELLED is receivable,
          // including RECEIVED itself — a supplier's later replacement shipment must
          // still be recordable against an order that already fully met its ordered
          // quantity (brief §6/§7). This guard's real job is closing the race against a
          // *concurrent cancel*, not blocking legitimate repeat receiving.
          status: { notIn: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED] },
        },
        data: { status: newStatus, updatedById: data.receivedById },
      });
      if (transition.count === 0) {
        throw new GoodsReceiptConflictError('Purchase order is no longer eligible to be received');
      }

      const goodsReceipt = await tx.goodsReceipt.create({
        data: {
          organisationId: data.organisationId,
          goodsReceiptNumber: data.goodsReceiptNumber,
          purchaseOrderId: data.purchaseOrderId,
          supplierId: data.supplierId,
          locationId: data.locationId,
          receivedDate: data.receivedDate,
          receivedById: data.receivedById,
          remarks: data.remarks,
          discrepancyStatus: data.discrepancyStatus,
          items: {
            create: data.items.map((item) => ({
              purchaseOrderItemId: item.purchaseOrderItemId,
              productId: item.productId,
              deliveredQuantity: item.deliveredQuantity,
              rejectedQuantity: item.rejectedQuantity,
              acceptedQuantity: item.acceptedQuantity,
              rejectionReason: item.rejectionReason,
              rejectionNotes: item.rejectionNotes,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      // Only the accepted portion ever becomes usable stock (brief's "Important
      // Business Rule": inventory must only increase by Accepted Quantity, never
      // Delivered Quantity) — a line that was entirely rejected writes no stock/ledger
      // row at all.
      const acceptedItems = data.items.filter((item) => item.acceptedQuantity > 0);
      for (const item of acceptedItems) {
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: item.productId,
            locationId: data.locationId,
            quantityOnHand: item.acceptedQuantity,
          },
          update: { quantityOnHand: { increment: item.acceptedQuantity } },
        });
      }
      if (acceptedItems.length > 0) {
        await tx.inventoryTransaction.createMany({
          data: acceptedItems.map((item) => ({
            organisationId: data.organisationId,
            productId: item.productId,
            locationId: data.locationId,
            transactionType: InventoryTransactionType.RECEIPT,
            quantity: item.acceptedQuantity,
            referenceType: 'GoodsReceipt',
            referenceId: goodsReceipt.id,
          })),
        });
      }

      return { goodsReceipt, purchaseOrderStatus: newStatus };
    });
  }

  /** The one mutation ever applied to an otherwise-immutable `GoodsReceipt` — progressing
   *  the lightweight supplier-resolution state (Sprint 4.4.1 brief §5). Returns `null` if
   *  no row matched `(id, organisationId)`, same "tenant-scoped updateMany, then
   *  re-fetch" convention as every other domain's update method. */
  async updateDiscrepancyStatus(
    organisationId: string,
    id: string,
    status: DiscrepancyStatus,
    notes?: string,
  ): Promise<GoodsReceiptWithRelations | null> {
    const result = await this.prisma.goodsReceipt.updateMany({
      where: { id, organisationId },
      data: { discrepancyStatus: status, discrepancyNotes: notes },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }
}
