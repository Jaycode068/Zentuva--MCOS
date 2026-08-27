import { Injectable } from '@nestjs/common';
import {
  DiscrepancyResolutionAction,
  DiscrepancyStatus,
  GoodsReceipt,
  GoodsReceiptItem,
  InventoryTransactionType,
  JournalEntryStatus,
  Prisma,
  PurchaseOrderStatus,
  RejectionReason,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';

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
  /** Added Sprint 8 — cumulative `payableQuantity` across every receipt against this
   *  Purchase Order item, see `GoodsReceiptItem.payableQuantity`. */
  payableQuantity: number;
}

export interface ReceiveGoodsItemData {
  purchaseOrderItemId: string;
  productId: string;
  deliveredQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  /** Added Sprint 8 — the Purchase Order item's own frozen `unitPrice`, supplied by
   *  `InventoryService` (already has it from `PurchaseOrderRepository.findById`). Used
   *  only for the accounting posting below — never written to `InventoryStock`, which
   *  stays purely a quantity ledger. */
  unitPrice: number;
  rejectionReason?: RejectionReason;
  rejectionNotes?: string;
  /** Added Sprint 11 (brief §21/§39) — when this item is a replacement for a
   *  previously-rejected line, the id of that original `GoodsReceiptItem`. Reuses
   *  `receive()`'s existing payable/GRNI computation completely unmodified (see
   *  `GoodsReceiptItem.replacesRejectedItemId` schema comment) — the only extra work
   *  is validating `deliveredQuantity` doesn't exceed what's still un-replaced on the
   *  original line, and recording the traceability link. */
  replacesRejectedItemId?: string;
}

export interface ReceiveGoodsData {
  organisationId: string;
  purchaseOrderId: string;
  /** Every one of the Purchase Order's own items (id + ordered quantity), supplied by
   *  `InventoryService` — it already has them from `PurchaseOrderRepository.findById`, so
   *  this transaction never needs to read `purchase_order_items` itself; only the final
   *  `purchase_orders.status` write below touches Procurement's tables at all. */
  purchaseOrderItems: { id: string; quantity: number }[];
  /** Added Sprint 8 — used only in the Journal Entry's `description`; cheap to pass
   *  since the caller already has it, avoids a second in-transaction read. */
  purchaseOrderNumber: string;
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
  /** Added Sprint 8 — same double-submit protection every other write-path in this
   *  codebase has. Optional: a caller that omits it gets no dedup protection, same
   *  convention as `SalesFulfilmentRepository.create`/`DeliveryRepository.create`. */
  idempotencyKey?: string;
  items: ReceiveGoodsItemData[];
  /** Added Sprint 11 — set when this entire receipt is a supplier's replacement
   *  shipment for a prior receipt's discrepancy (brief §21/§39). Purely a
   *  traceability/auto-resolution link — `receive()`'s payable/GRNI math is completely
   *  unchanged by its presence (see `GoodsReceipt.replacesGoodsReceiptId` schema
   *  comment). */
  replacesGoodsReceiptId?: string;
}

/** Minimal Journal Entry summary surfaced on the goods-receipt response so Procurement/
 *  Inventory UI can show "Accounting: JE-000123" without a second round trip.
 *  `totalAmount` is the posting's total debit (== total credit, by construction) —
 *  not a persisted `JournalEntry` column, computed at posting time. */
export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

export interface ReceiveGoodsResult {
  goodsReceipt: GoodsReceiptWithRelations;
  purchaseOrderStatus: PurchaseOrderStatus;
  /** `null` only when nothing on this receipt was accepted (an all-rejected receipt) —
   *  see docs/domains/accounting.md "Goods Receipt Posting": rejected quantity must
   *  never create accounting value, so no journal entry is posted at all in that case,
   *  not even a zero-amount one. */
  journalEntry: JournalEntrySummary | null;
  /** `true` only when this call created a new `GoodsReceipt`; `false` when an existing
   *  `(purchaseOrderId, idempotencyKey)` match was returned instead — the caller uses
   *  this to skip re-emitting audit events on a replay, same convention as `wasCreated`
   *  on `PaymentRepository.create()`/`SalesFulfilmentRepository.create()`. */
  wasCreated: boolean;
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

/** Added Sprint 11 — thrown when a replacement item's `replacesRejectedItemId` doesn't
 *  reference a real, same-organisation `GoodsReceiptItem`, or when the replacement
 *  quantity claimed (across this and every prior replacement) would exceed that line's
 *  own `rejectedQuantity` (brief §39: never over-replace). */
export class InvalidReplacementError extends Error {}

/**
 * Thin Prisma access for the GoodsReceipt aggregate (Sprint 4.4, refined Sprint 4.4.1,
 * extended Sprint 8 with automatic accounting posting, docs/domains/inventory.md).
 *
 * `receive` runs the entire "record one delivery event against a Purchase Order"
 * operation inside a single `$transaction`: an idempotency check-then-return, creating
 * the GoodsReceipt + items (each item's `payableQuantity` capped at what the Purchase
 * Order's own ordered quantity still commercially covers — see
 * docs/domains/accounting.md "Accepted vs. Payable"), incrementing `InventoryStock` by
 * each item's *accepted* quantity (never delivered — see docs/domains/inventory.md
 * "Important Business Rule"), appending `InventoryTransaction` (`RECEIPT`) rows, setting
 * the Purchase Order's status to `PARTIALLY_RECEIVED`/`RECEIVED`, and — new in Sprint 8
 * — posting a Journal Entry (`DR Inventory` for the full accepted value, `CR Accounts
 * Payable` for the payable portion, `CR Goods Received – Pending Approval` for any
 * accepted-but-unapproved excess) via `postSystemJournalEntry`, sharing this same
 * transaction so the whole business event is atomic: either everything succeeds
 * together, or everything (including the journal) rolls back together. Sprint 4.4.1
 * removed the old "received once" restriction — a Purchase Order may have many
 * `GoodsReceipt` rows, including against an order already `RECEIVED` (a supplier's
 * later replacement shipment, brief §6/§7). The transaction's own conditional
 * `updateMany` (matching every status except `DRAFT`/`CANCELLED`) exists to close the
 * race against a *concurrent cancel*, not to block legitimate repeat receiving.
 *
 * The `purchaseOrder.updateMany` call is a deliberate, narrow exception to ADR-002's
 * domain-ownership convention — see the Sprint 4.4 completion report and
 * docs/domains/inventory.md §6 for the full rationale (atomicity: splitting the status
 * write into a second call after this transaction commits would reintroduce the
 * non-atomicity this design exists to avoid). `postSystemJournalEntry` is the same
 * narrow, documented exception applied to Finance's tables — a plain, non-DI function
 * import (not a NestJS module dependency), exactly the pattern
 * `PaymentRepository.create()`/`CreditNoteRepository.issue()` already established in
 * Sprint 7 (see docs/domains/accounting.md "Accounting Posting Boundary"). Every other
 * *read* this domain needs stays within its own tables or goes through Procurement's
 * exported `PurchaseOrderRepository` — see `InventoryService`.
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

  /** Cumulative delivered/accepted/rejected/payable quantity per `PurchaseOrderItem`,
   *  summed across every `GoodsReceipt` ever recorded against this Purchase Order — the
   *  raw material `InventoryService` combines with each item's *ordered* quantity (read
   *  via `PurchaseOrderRepository`, not here) to compute outstanding/excess. Scoped
   *  through `goodsReceipt.organisationId` — same tenant-safety convention as every
   *  other lookup, even though `purchaseOrderId` alone is already a globally unique
   *  cuid. */
  async getReceivingTotals(
    organisationId: string,
    purchaseOrderId: string,
  ): Promise<Map<string, ReceivingTotals>> {
    const rows = await this.prisma.goodsReceiptItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: { goodsReceipt: { organisationId, purchaseOrderId } },
      _sum: {
        deliveredQuantity: true,
        acceptedQuantity: true,
        rejectedQuantity: true,
        payableQuantity: true,
      },
    });
    const totals = new Map<string, ReceivingTotals>();
    for (const row of rows) {
      totals.set(row.purchaseOrderItemId, {
        deliveredQuantity: row._sum.deliveredQuantity ?? 0,
        acceptedQuantity: row._sum.acceptedQuantity ?? 0,
        rejectedQuantity: row._sum.rejectedQuantity ?? 0,
        payableQuantity: row._sum.payableQuantity ?? 0,
      });
    }
    return totals;
  }

  /** Batch lookup of the Journal Entry (if any) posted for each of the given Goods
   *  Receipts — used by `InventoryService.listGoodsReceipts`/`getGoodsReceiptById` so
   *  the read paths (not just the create response) can surface "Accounting: JE-000123"
   *  in the UI. Same polymorphic `sourceType`/`sourceId` lookup as `findJournalEntry`,
   *  batched via `sourceId: { in: ids } }` rather than one query per receipt. */
  async findJournalEntriesByGoodsReceiptIds(
    organisationId: string,
    goodsReceiptIds: string[],
  ): Promise<Map<string, JournalEntrySummary>> {
    if (goodsReceiptIds.length === 0) {
      return new Map();
    }
    const journalEntries = await this.prisma.journalEntry.findMany({
      where: { organisationId, sourceType: 'GOODS_RECEIPT', sourceId: { in: goodsReceiptIds } },
      include: { lines: { select: { debit: true } } },
    });
    const map = new Map<string, JournalEntrySummary>();
    for (const journalEntry of journalEntries) {
      if (!journalEntry.sourceId) {
        continue;
      }
      map.set(journalEntry.sourceId, {
        id: journalEntry.id,
        journalNumber: journalEntry.journalNumber,
        status: journalEntry.status,
        totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
      });
    }
    return map;
  }

  /** Looks up the Journal Entry (if any) posted for a given Goods Receipt, via the
   *  same polymorphic `sourceType`/`sourceId` `JournalEntry` already uses for every
   *  other system posting — no FK exists (deliberately, see `journal-posting.ts`). */
  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    goodsReceiptId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'GOODS_RECEIPT',
          sourceId: goodsReceiptId,
        },
      },
      include: { lines: { select: { debit: true } } },
    });
    if (!journalEntry) {
      return null;
    }
    return {
      id: journalEntry.id,
      journalNumber: journalEntry.journalNumber,
      status: journalEntry.status,
      totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
    };
  }

  async receive(data: ReceiveGoodsData): Promise<ReceiveGoodsResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.goodsReceipt.findUnique({
          where: {
            purchaseOrderId_idempotencyKey: {
              purchaseOrderId: data.purchaseOrderId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const purchaseOrder = await tx.purchaseOrder.findUniqueOrThrow({
            where: { id: data.purchaseOrderId },
            select: { status: true },
          });
          const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
          return {
            goodsReceipt: existing,
            purchaseOrderStatus: purchaseOrder.status,
            journalEntry,
            wasCreated: false,
          };
        }
      }

      const priorTotalsRows = await tx.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: {
          goodsReceipt: {
            organisationId: data.organisationId,
            purchaseOrderId: data.purchaseOrderId,
          },
        },
        _sum: { deliveredQuantity: true, payableQuantity: true },
      });
      const priorDelivered = new Map(
        priorTotalsRows.map((row) => [row.purchaseOrderItemId, row._sum.deliveredQuantity ?? 0]),
      );
      const priorPayable = new Map(
        priorTotalsRows.map((row) => [row.purchaseOrderItemId, row._sum.payableQuantity ?? 0]),
      );
      const orderedQuantityById = new Map(
        data.purchaseOrderItems.map((poItem) => [poItem.id, poItem.quantity]),
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

      // Accepted-vs-payable (Sprint 8, docs/domains/accounting.md "Accepted vs.
      // Payable"): physically accepting goods into inventory does not by itself create
      // a supplier liability for more than the Purchase Order's own ordered quantity
      // commercially covers. `payableQuantity` is capped per item at whatever's still
      // "remaining" on the order after every prior receipt's own payable total — never
      // accepted from the client, computed here alongside `acceptedQuantity`. This
      // tracks *cumulative payable consumed*, independent of `priorDelivered`: a
      // replacement receipt's accepted quantity was never counted as payable by the
      // receipt it replaces (that receipt's rejected portion contributed nothing to
      // `payableQuantity`), so it correctly still has room against the order.
      const itemsWithPayable = data.items.map((item) => {
        const orderedQuantity = orderedQuantityById.get(item.purchaseOrderItemId) ?? 0;
        const remainingOrderedQuantity = Math.max(
          0,
          orderedQuantity - (priorPayable.get(item.purchaseOrderItemId) ?? 0),
        );
        const payableQuantity = roundQuantity(
          Math.min(item.acceptedQuantity, remainingOrderedQuantity),
        );
        return { ...item, payableQuantity };
      });

      // Replacement goods (Sprint 11, brief §21/§39) — validate every
      // `replacesRejectedItemId` references a real, same-organisation
      // `GoodsReceiptItem` and that the cumulative replacement quantity claimed never
      // exceeds that line's own `rejectedQuantity`. Deliberately does NOT touch
      // `payableQuantity`/the journal math above in any way — see the schema comment
      // on `GoodsReceiptItem.replacesRejectedItemId`.
      const replacementItems = itemsWithPayable.filter((item) => item.replacesRejectedItemId);
      const replacedItemIds = [
        ...new Set(replacementItems.map((item) => item.replacesRejectedItemId as string)),
      ];
      if (replacedItemIds.length > 0) {
        const originalItems = await tx.goodsReceiptItem.findMany({
          where: {
            id: { in: replacedItemIds },
            goodsReceipt: { organisationId: data.organisationId },
          },
        });
        const originalById = new Map(originalItems.map((row) => [row.id, row]));
        const claimedByOriginalId = new Map<string, number>();
        for (const item of replacementItems) {
          const originalId = item.replacesRejectedItemId as string;
          claimedByOriginalId.set(
            originalId,
            (claimedByOriginalId.get(originalId) ?? 0) + item.deliveredQuantity,
          );
        }
        for (const [originalId, claimed] of claimedByOriginalId) {
          const original = originalById.get(originalId);
          if (!original) {
            throw new InvalidReplacementError('Referenced rejected item not found');
          }
          const remainingReplaceable = roundQuantity(
            original.rejectedQuantity - original.replacedQuantity,
          );
          if (roundQuantity(claimed) > remainingReplaceable) {
            throw new InvalidReplacementError(
              `Cannot replace ${claimed} — only ${remainingReplaceable} of the original rejection remains un-replaced`,
            );
          }
        }
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
          idempotencyKey: data.idempotencyKey,
          replacesGoodsReceiptId: data.replacesGoodsReceiptId,
          items: {
            create: itemsWithPayable.map((item) => ({
              purchaseOrderItemId: item.purchaseOrderItemId,
              productId: item.productId,
              deliveredQuantity: item.deliveredQuantity,
              rejectedQuantity: item.rejectedQuantity,
              acceptedQuantity: item.acceptedQuantity,
              payableQuantity: item.payableQuantity,
              rejectionReason: item.rejectionReason,
              rejectionNotes: item.rejectionNotes,
              replacesRejectedItemId: item.replacesRejectedItemId,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      if (replacementItems.length > 0) {
        const claimedByOriginalId = new Map<string, number>();
        for (const item of replacementItems) {
          const originalId = item.replacesRejectedItemId as string;
          claimedByOriginalId.set(
            originalId,
            (claimedByOriginalId.get(originalId) ?? 0) + item.deliveredQuantity,
          );
        }
        for (const [originalId, claimed] of claimedByOriginalId) {
          await tx.goodsReceiptItem.update({
            where: { id: originalId },
            data: { replacedQuantity: { increment: claimed } },
          });
        }
      }

      if (data.replacesGoodsReceiptId) {
        const originalReceiptItems = await tx.goodsReceiptItem.findMany({
          where: { goodsReceiptId: data.replacesGoodsReceiptId },
        });
        // Re-fetched after the `replacedQuantity` increments above, so this already
        // reflects this transaction's own replacement.
        const fullyReplaced = originalReceiptItems.every(
          (item) => roundQuantity(item.replacedQuantity) >= roundQuantity(item.rejectedQuantity),
        );
        await tx.goodsReceipt.update({
          where: { id: data.replacesGoodsReceiptId },
          data: {
            discrepancyResolutionAction: DiscrepancyResolutionAction.REPLACEMENT,
            discrepancyStatus: fullyReplaced
              ? DiscrepancyStatus.RESOLVED
              : DiscrepancyStatus.REPLACEMENT_RECEIVED,
          },
        });
      }

      // Only the accepted portion ever becomes usable stock (brief's "Important
      // Business Rule": inventory must only increase by Accepted Quantity, never
      // Delivered Quantity) — a line that was entirely rejected writes no stock/ledger
      // row at all.
      const acceptedItems = itemsWithPayable.filter((item) => item.acceptedQuantity > 0);
      for (const item of acceptedItems) {
        // Sprint 9 — the first writer of `InventoryStock.averageUnitCost`: a moving
        // weighted average blending whatever stock already existed with this
        // receipt's own accepted quantity, valued at the PO's frozen `unitPrice`. On
        // a first-ever receipt into empty stock this reduces to `unitPrice` exactly,
        // byte-identical to what Sprint 8 already computed transiently for the
        // journal — this just makes that figure durably reusable (by Production's
        // Material Issue) instead of discarding it after the journal posts.
        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
        });
        const priorQuantity = existingStock?.quantityOnHand ?? 0;
        const priorCost = existingStock?.averageUnitCost ?? 0;
        const newQuantity = priorQuantity + item.acceptedQuantity;
        const newAverageCost =
          newQuantity > 0
            ? roundCurrency(
                (priorQuantity * priorCost + item.acceptedQuantity * item.unitPrice) / newQuantity,
              )
            : 0;
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
            averageUnitCost: newAverageCost,
          },
          update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
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

      // Accounting posting (Sprint 8, docs/domains/accounting.md "Goods Receipt
      // Posting") — shares this same transaction, so it either succeeds together with
      // everything above or rolls back together with it (e.g. `NoOpenPeriodError` for a
      // closed accounting period, `MissingSystemAccountError` for a misconfigured
      // Chart of Accounts). `DR Inventory` always carries the *full* accepted value;
      // the credit side splits into the commercially-payable portion (`AP`) and any
      // accepted-but-unapproved excess (`GRNI_PENDING_APPROVAL`) — see decision #2-#4
      // in the Sprint 8 plan. Rejected quantity never contributes to any of these sums.
      const inventoryValue = roundCurrency(
        acceptedItems.reduce((sum, item) => sum + item.acceptedQuantity * item.unitPrice, 0),
      );
      const payableValue = roundCurrency(
        acceptedItems.reduce((sum, item) => sum + item.payableQuantity * item.unitPrice, 0),
      );
      const excessValue = roundCurrency(inventoryValue - payableValue);

      let journalEntry: JournalEntrySummary | null = null;
      if (inventoryValue > 0) {
        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: data.receivedDate,
          description: `Goods receipt ${data.goodsReceiptNumber} — PO ${data.purchaseOrderNumber}`,
          reference: data.goodsReceiptNumber,
          sourceType: 'GOODS_RECEIPT',
          sourceId: goodsReceipt.id,
          actorUserId: data.receivedById,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY, debit: inventoryValue },
            ...(payableValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.AP, credit: payableValue }]
              : []),
            ...(excessValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.GRNI_PENDING_APPROVAL, credit: excessValue }]
              : []),
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: inventoryValue,
        };
      }

      return { goodsReceipt, purchaseOrderStatus: newStatus, journalEntry, wasCreated: true };
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
    /** Added Sprint 11 — the manual resolution actions (`CREDIT`/`ACCEPT_AS_IS`/
     *  `PRICE_ADJUSTMENT`/`OTHER`); `REPLACEMENT`/`RETURN` are set automatically by
     *  `receive()`/`SupplierReturnRepository.create()` instead, never via this path. */
    resolutionAction?: DiscrepancyResolutionAction,
  ): Promise<GoodsReceiptWithRelations | null> {
    const result = await this.prisma.goodsReceipt.updateMany({
      where: { id, organisationId },
      data: {
        discrepancyStatus: status,
        discrepancyNotes: notes,
        ...(resolutionAction ? { discrepancyResolutionAction: resolutionAction } : {}),
      },
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

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Same 2-decimal-place money rounding convention as every other file that computes
 *  currency values in this codebase (`journal-posting.ts`, Finance's repositories). */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
