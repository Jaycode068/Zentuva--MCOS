import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  InventoryStock,
  InventoryTransaction,
  InventoryTransactionType,
  ProductStatus,
  ProductType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { applyStockAdjustmentIfNonNegative } from './inventory-stock-concurrency.util';

export interface ListInventoryStockParams {
  /** Simple case-insensitive substring match against the product's name or code (same
   *  convention as `ProductRepository.findManyByOrganisation`). */
  search?: string;
  productType?: ProductType;
  /** Added Sprint 4.5 brief §11 — filter by the Product Catalogue's own lifecycle
   *  status (Draft/Active/Archived), not this table's own status (it has none). */
  productStatus?: ProductStatus;
  /** Added Sprint 4.5 — narrow the summary to one physical location. */
  locationId?: string;
}

export type InventoryStockWithProduct = InventoryStock & {
  product: {
    id: string;
    code: string;
    name: string;
    type: ProductType;
    unit: string;
    status: ProductStatus;
  };
  location: { id: string; name: string };
};

const PRODUCT_SELECT = { id: true, code: true, name: true, type: true, unit: true, status: true };
const LOCATION_SELECT = { id: true, name: true };

export interface AdjustStockData {
  organisationId: string;
  productId: string;
  locationId: string;
  /** Signed delta to apply — positive increases `quantityOnHand`, negative decreases
   *  it. Never a new absolute balance (brief: "the system must NOT simply overwrite
   *  quantityOnHand"). */
  quantity: number;
  reason: AdjustmentReason;
  notes?: string;
  createdById: string;
}

export interface AdjustStockResult {
  stock: InventoryStockWithProduct;
  transaction: InventoryTransaction;
}

/** Thrown when an adjustment would leave `quantityOnHand` negative (brief §8: "For MVP,
 *  do not allow an adjustment that would result in negative available/on-hand stock...
 *  Do not silently clamp it to zero"). Its own `Error` subclass (not
 *  `BadRequestException`) because this file has no Nest HTTP context — same
 *  "repository stays framework-agnostic, service throws HTTP exceptions" convention as
 *  `GoodsReceiptRepository`'s `GoodsReceiptConflictError`. */
export class NegativeStockError extends Error {}

/**
 * Thin Prisma access for the live `InventoryStock` balance (Sprint 4.4, extended Sprint
 * 4.5 for locations + controlled adjustments, docs/domains/inventory.md). Writes happen
 * in exactly two places: inside `GoodsReceiptRepository.receive`'s transaction
 * (receiving), and inside this file's own `adjustStock` transaction (corrections) — both
 * always paired with an `InventoryTransaction` row, per the brief's "Do NOT directly
 * mutate stock quantities without creating the corresponding transaction."
 */
@Injectable()
export class InventoryStockRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOrganisation(
    organisationId: string,
    params: ListInventoryStockParams = {},
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: {
        organisationId,
        ...(params.locationId ? { locationId: params.locationId } : {}),
        product: {
          ...(params.productType ? { type: params.productType } : {}),
          ...(params.productStatus ? { status: params.productStatus } : {}),
          ...(params.search
            ? {
                OR: [
                  { name: { contains: params.search, mode: 'insensitive' } },
                  { code: { contains: params.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Every `InventoryStock` row for this product, across every location — the caller
   *  (`InventoryService.getStockByProduct`) sums them into one aggregate view, since
   *  that endpoint predates locations and existing callers expect a single balance per
   *  product. */
  findManyByProduct(
    organisationId: string,
    productId: string,
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: { organisationId, productId },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  findByProductAndLocation(
    organisationId: string,
    productId: string,
    locationId: string,
  ): Promise<InventoryStockWithProduct | null> {
    return this.prisma.inventoryStock.findUnique({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  /** Batch read for a Production Order's material-availability check and material-issue
   *  pre-validation (Sprint 4.6) — one query for every BOM component instead of N.
   *  Consumed by `ProductionOrderService` via `InventoryModule`'s exported repository. */
  findManyByProductsAndLocation(
    organisationId: string,
    productIds: string[],
    locationId: string,
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: { organisationId, locationId, productId: { in: productIds } },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  /** The one write path for stock corrections (brief §7 "Atomicity": validate stock →
   *  create `InventoryTransaction` → update `InventoryStock`, all inside one
   *  transaction, rolled back together on any failure). Reads the current balance
   *  *inside* the transaction (not from a pre-check the caller already did) so the
   *  negative-stock guard is evaluated against a fresh, transaction-scoped value —
   *  closing the race between two concurrent adjustments a pre-check alone couldn't. */
  async adjustStock(data: AdjustStockData): Promise<AdjustStockResult> {
    return this.prisma.$transaction(async (tx) => {
      const stockRef = {
        organisationId: data.organisationId,
        productId: data.productId,
        locationId: data.locationId,
      };
      // Sprint 37.1 — atomic conditional adjustment, the database's own row lock is the
      // concurrency guard (see `inventory-stock-concurrency.util.ts`). Replaces a
      // read-then-upsert-with-precomputed-value pattern that shared the exact defect
      // class live-verified in `SalesFulfilmentRepository.create()`
      // (docs/domains/d2c.md §78) — two concurrent negative adjustments against the
      // same row could previously both read the same balance and lose one decrement.
      const applied = await applyStockAdjustmentIfNonNegative(tx, stockRef, data.quantity);
      if (!applied) {
        const current = await tx.inventoryStock.findUnique({
          where: { organisationId_productId_locationId: stockRef },
          select: { quantityOnHand: true },
        });
        throw new NegativeStockError(
          `Adjustment would result in negative stock (current: ${current?.quantityOnHand ?? 0}, adjustment: ${data.quantity})`,
        );
      }

      const stock = await tx.inventoryStock.findUniqueOrThrow({
        where: { organisationId_productId_locationId: stockRef },
        include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          organisationId: data.organisationId,
          productId: data.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ADJUSTMENT,
          quantity: data.quantity,
          referenceType: 'ManualAdjustment',
          referenceId: null,
          adjustmentReason: data.reason,
          notes: data.notes,
          createdById: data.createdById,
        },
      });

      return { stock, transaction };
    });
  }
}
