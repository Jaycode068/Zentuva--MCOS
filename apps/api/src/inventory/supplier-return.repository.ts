import { Injectable } from '@nestjs/common';
import {
  DiscrepancyResolutionAction,
  DiscrepancyStatus,
  InventoryTransactionType,
  JournalEntryStatus,
  Prisma,
  RejectionReason,
  SupplierReturn,
  SupplierReturnItem,
} from '@prisma/client';

import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';
import { PrismaService } from '../prisma/prisma.service';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type SupplierReturnWithRelations = SupplierReturn & {
  supplier: { id: string; supplierCode: string; supplierName: string };
  purchaseOrder: { id: string; purchaseOrderNumber: string };
  goodsReceipt: { id: string; goodsReceiptNumber: string };
  location: { id: string; name: string };
  items: (SupplierReturnItem & {
    product: { id: string; code: string; name: string; unit: string };
  })[];
};

const RELATIONS_INCLUDE = {
  supplier: { select: { id: true, supplierCode: true, supplierName: true } },
  purchaseOrder: { select: { id: true, purchaseOrderNumber: true } },
  goodsReceipt: { select: { id: true, goodsReceiptNumber: true } },
  location: { select: { id: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

export interface ListSupplierReturnsParams {
  supplierId?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  search?: string;
}

export interface CreateSupplierReturnItemData {
  goodsReceiptItemId: string;
  quantityReturned: number;
}

export interface CreateSupplierReturnData {
  organisationId: string;
  returnCode: string;
  supplierId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  locationId: string;
  returnDate: Date;
  reason: RejectionReason;
  reasonNotes?: string;
  notes?: string;
  createdById: string;
  idempotencyKey?: string;
  items: CreateSupplierReturnItemData[];
}

export interface CreateSupplierReturnResult {
  supplierReturn: SupplierReturnWithRelations;
  journalEntry: JournalEntrySummary | null;
  wasCreated: boolean;
}

/** Thrown when a return item claims more than what remains eligible on the referenced
 *  `GoodsReceiptItem` (`acceptedQuantity - returnedQuantity`) — brief §19: cumulative
 *  returns must never exceed the eligible received/accepted quantity. */
export class OverReturnError extends Error {}

/** Thrown when the referenced `GoodsReceiptItem` doesn't belong to the given Goods
 *  Receipt/organisation. */
export class InvalidGoodsReceiptReferenceError extends Error {}

/** Thrown when the location's current `quantityOnHand` can't cover the quantity being
 *  physically removed — same role as `InsufficientStockError` elsewhere. */
export class InsufficientReturnableStockError extends Error {}

/**
 * Thin Prisma access for the `SupplierReturn` aggregate (Sprint 11,
 * docs/domains/procurement.md "Supplier Returns"). Created and posted atomically in
 * one call (unlike `CustomerReturnRepository`'s two-phase request/receive — see
 * docs/domains/procurement.md for why a supplier return needs no separate inspection
 * step).
 *
 * The excess-vs-payable allocation (brief §17-19, docs/domains/accounting.md "Supplier
 * Return Accounting") draws down each `GoodsReceiptItem`'s remaining excess/GRNI
 * balance *first*, only spilling into the payable/AP balance once excess is
 * exhausted — this reproduces both worked scenarios exactly (returning the 50-unit
 * excess allocates 100% to `GRNI_PENDING_APPROVAL`, leaving `AP` untouched; returning
 * from a fully-payable receipt allocates 100% to `AP`). Valued at the *original*
 * `PurchaseOrderItem.unitPrice` the receipt itself was posted at — never the current
 * `averageUnitCost` — so the reversal ties out exactly to the original receipt
 * journal.
 *
 * Writing directly into `GoodsReceiptItem`/`GoodsReceipt`/`InventoryStock`/
 * `InventoryTransaction` here is the same deliberate, narrow exception to ADR-002's
 * domain-ownership convention that `GoodsReceiptRepository` already establishes.
 */
@Injectable()
export class SupplierReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<SupplierReturnWithRelations | null> {
    return this.prisma.supplierReturn.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSupplierReturnsParams = {},
  ): Promise<SupplierReturnWithRelations[]> {
    return this.prisma.supplierReturn.findMany({
      where: {
        organisationId,
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.purchaseOrderId ? { purchaseOrderId: params.purchaseOrderId } : {}),
        ...(params.goodsReceiptId ? { goodsReceiptId: params.goodsReceiptId } : {}),
        ...(params.search
          ? {
              OR: [
                { returnCode: { contains: params.search, mode: 'insensitive' } },
                { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async existsByCode(returnCode: string): Promise<boolean> {
    const count = await this.prisma.supplierReturn.count({ where: { returnCode } });
    return count > 0;
  }

  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    supplierReturnId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'SUPPLIER_RETURN',
          sourceId: supplierReturnId,
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

  async create(data: CreateSupplierReturnData): Promise<CreateSupplierReturnResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.supplierReturn.findUnique({
          where: {
            goodsReceiptId_idempotencyKey: {
              goodsReceiptId: data.goodsReceiptId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
          return { supplierReturn: existing, journalEntry, wasCreated: false };
        }
      }

      const goodsReceiptItemIds = data.items.map((item) => item.goodsReceiptItemId);
      const goodsReceiptItems = await tx.goodsReceiptItem.findMany({
        where: {
          id: { in: goodsReceiptItemIds },
          goodsReceiptId: data.goodsReceiptId,
          goodsReceipt: { organisationId: data.organisationId },
        },
        include: { purchaseOrderItem: { select: { unitPrice: true } } },
      });
      const goodsReceiptItemById = new Map(goodsReceiptItems.map((row) => [row.id, row]));

      const resolvedItems = data.items.map((item) => {
        const goodsReceiptItem = goodsReceiptItemById.get(item.goodsReceiptItemId);
        if (!goodsReceiptItem) {
          throw new InvalidGoodsReceiptReferenceError(
            'One or more items do not belong to this goods receipt',
          );
        }
        const remainingAccepted = roundQuantity(
          goodsReceiptItem.acceptedQuantity - goodsReceiptItem.returnedQuantity,
        );
        if (roundQuantity(item.quantityReturned) > remainingAccepted) {
          throw new OverReturnError(
            `Cannot return ${item.quantityReturned} — only ${remainingAccepted} of this receipt line remains eligible for return`,
          );
        }
        const remainingExcess = Math.max(
          0,
          roundQuantity(
            goodsReceiptItem.acceptedQuantity -
              goodsReceiptItem.payableQuantity -
              goodsReceiptItem.returnedExcessQuantity,
          ),
        );
        const excessPortion = roundQuantity(Math.min(item.quantityReturned, remainingExcess));
        return {
          goodsReceiptItem,
          quantityReturned: item.quantityReturned,
          unitCost: goodsReceiptItem.purchaseOrderItem.unitPrice,
          excessPortion,
        };
      });

      const supplierReturn = await tx.supplierReturn.create({
        data: {
          organisationId: data.organisationId,
          returnCode: data.returnCode,
          supplierId: data.supplierId,
          purchaseOrderId: data.purchaseOrderId,
          goodsReceiptId: data.goodsReceiptId,
          locationId: data.locationId,
          returnDate: data.returnDate,
          reason: data.reason,
          reasonNotes: data.reasonNotes,
          notes: data.notes,
          createdById: data.createdById,
          idempotencyKey: data.idempotencyKey,
          items: {
            create: resolvedItems.map((resolved) => ({
              productId: resolved.goodsReceiptItem.productId,
              goodsReceiptItemId: resolved.goodsReceiptItem.id,
              quantityReturned: resolved.quantityReturned,
              unitCost: resolved.unitCost,
              excessPortion: resolved.excessPortion,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      let totalExcessValue = 0;
      let totalPayableValue = 0;
      for (const resolved of resolvedItems) {
        const payablePortion = roundQuantity(resolved.quantityReturned - resolved.excessPortion);
        totalExcessValue = roundCurrency(
          totalExcessValue + roundCurrency(resolved.excessPortion * resolved.unitCost),
        );
        totalPayableValue = roundCurrency(
          totalPayableValue + roundCurrency(payablePortion * resolved.unitCost),
        );

        await tx.goodsReceiptItem.update({
          where: { id: resolved.goodsReceiptItem.id },
          data: {
            returnedQuantity: { increment: resolved.quantityReturned },
            returnedExcessQuantity: { increment: resolved.excessPortion },
          },
        });

        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: resolved.goodsReceiptItem.productId,
              locationId: data.locationId,
            },
          },
        });
        const currentQuantity = existingStock?.quantityOnHand ?? 0;
        const newQuantity = roundQuantity(currentQuantity - resolved.quantityReturned);
        if (newQuantity < 0) {
          throw new InsufficientReturnableStockError(
            `Insufficient stock to return ${resolved.quantityReturned} of product ${resolved.goodsReceiptItem.productId} (available: ${currentQuantity})`,
          );
        }
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: resolved.goodsReceiptItem.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: resolved.goodsReceiptItem.productId,
            locationId: data.locationId,
            quantityOnHand: newQuantity,
          },
          update: { quantityOnHand: newQuantity },
        });
        await tx.inventoryTransaction.create({
          data: {
            organisationId: data.organisationId,
            productId: resolved.goodsReceiptItem.productId,
            locationId: data.locationId,
            transactionType: InventoryTransactionType.RETURN,
            quantity: resolved.quantityReturned,
            referenceType: 'SupplierReturn',
            referenceId: supplierReturn.id,
          },
        });
      }

      // Discrepancy auto-resolution (brief §20) — a return against a receipt that
      // still has an open discrepancy is treated as its resolution.
      const goodsReceipt = await tx.goodsReceipt.findUniqueOrThrow({
        where: { id: data.goodsReceiptId },
        select: { discrepancyStatus: true },
      });
      if (
        goodsReceipt.discrepancyStatus !== DiscrepancyStatus.NONE &&
        goodsReceipt.discrepancyStatus !== DiscrepancyStatus.RESOLVED
      ) {
        await tx.goodsReceipt.update({
          where: { id: data.goodsReceiptId },
          data: {
            discrepancyStatus: DiscrepancyStatus.RESOLVED,
            discrepancyResolutionAction: DiscrepancyResolutionAction.RETURN,
          },
        });
      }

      // Accounting reversal (brief §17-19, docs/domains/accounting.md "Supplier
      // Return Accounting") — `DR AP` for the payable-sourced portion, `DR
      // GRNI_PENDING_APPROVAL` for the excess-sourced portion, `CR Inventory` for the
      // total. Zero-skipped (no journal at all) when nothing was returned at a
      // non-zero cost.
      const totalInventoryValue = roundCurrency(totalExcessValue + totalPayableValue);
      let journalEntry: JournalEntrySummary | null = null;
      if (totalInventoryValue > 0) {
        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: data.returnDate,
          description: `Supplier return ${data.returnCode} — Goods Receipt ${supplierReturn.goodsReceipt.goodsReceiptNumber}`,
          reference: data.returnCode,
          sourceType: 'SUPPLIER_RETURN',
          sourceId: supplierReturn.id,
          actorUserId: data.createdById,
          lines: [
            ...(totalPayableValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.AP, debit: totalPayableValue }]
              : []),
            ...(totalExcessValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.GRNI_PENDING_APPROVAL, debit: totalExcessValue }]
              : []),
            { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY, credit: totalInventoryValue },
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: totalInventoryValue,
        };
      }

      return { supplierReturn, journalEntry, wasCreated: true };
    });
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Rounds to 2 decimal places (currency) — same convention as every other file's own
 *  local `roundCurrency` helper in this codebase. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
