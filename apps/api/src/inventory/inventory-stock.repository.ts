import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  InventoryStock,
  InventoryTransaction,
  InventoryTransactionType,
  Prisma,
  ProductStatus,
  ProductType,
  StockArrangement,
  StockOwnership,
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

/** Added Phase 2B — thrown when `recordOpeningStock` is called for a
 *  `(organisation, product, location)` that already has an `InventoryStock` row. The
 *  existence of a row IS the "this location's balance for this product is already
 *  confirmed" marker (brief §6: "Distinguish a confirmed opening balance from an
 *  unconfirmed location") — a second attempt is never merged into the existing
 *  balance, only rejected, which is also what makes a duplicate/retried submission
 *  safe without any separate `idempotencyKey` column (see `recordOpeningStock`'s own
 *  doc comment). */
export class OpeningStockAlreadyRecordedError extends Error {}

export interface RecordOpeningStockData {
  organisationId: string;
  productId: string;
  locationId: string;
  /** May be zero — a confirmed physical count of zero is a legitimate, deliberate
   *  reconciliation outcome, distinct from no count ever having been recorded. */
  quantity: number;
  ownership: StockOwnership;
  arrangement: StockArrangement;
  notes?: string;
  createdById: string;
}

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

  /**
   * Added Phase 2B (brief §6 "Opening Stock and Reconciliation") — establishes the
   * FIRST confirmed physical count of a product at a location. Deliberately a
   * dedicated method, not a widened `adjustStock`: an opening count is not a delta
   * against an existing balance, it IS the balance, and it carries `ownership`/
   * `arrangement` (which `adjustStock` has no reason to touch — see that method's own
   * "never touches averageUnitCost" rationale, now extended to these two fields).
   *
   * Idempotency/duplicate-prevention needs no new column: the attempted `create()`
   * either succeeds (no prior row existed — this really is the first count) or hits
   * `InventoryStock`'s own `@@unique([organisationId, productId, locationId])`
   * constraint, which this method catches and translates to
   * `OpeningStockAlreadyRecordedError` rather than silently merging into, or
   * overwriting, whatever balance already exists — the same "find-then-create-then-
   * recover-from-P2002" convention `SalesOrder.idempotencyKey`'s own schema comment
   * already documents elsewhere in this codebase, specialised here to a natural
   * uniqueness check instead of a client-supplied key.
   *
   * `averageUnitCost` is always recorded as `0` — there is no reliable cost basis for
   * a manual physical count (brief: "Do not fabricate... where reliable evidence is
   * missing"). This is a deliberate, conservative simplification: opening stock
   * recorded this way contributes nothing to inventory valuation until a later, COSTED
   * movement (e.g. a `Transfer` FROM a costed warehouse location) establishes a real
   * cost at that location — see the Phase 2B completion report's "Known Limitations".
   */
  async recordOpeningStock(data: RecordOpeningStockData): Promise<AdjustStockResult> {
    return this.prisma.$transaction(async (tx) => {
      let stock: InventoryStock;
      try {
        stock = await tx.inventoryStock.create({
          data: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            quantityOnHand: data.quantity,
            averageUnitCost: 0,
            ownership: data.ownership,
            arrangement: data.arrangement,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new OpeningStockAlreadyRecordedError(
            'An opening balance has already been recorded for this product at this location',
          );
        }
        throw error;
      }

      const stockWithRelations = await tx.inventoryStock.findUniqueOrThrow({
        where: { id: stock.id },
        include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          organisationId: data.organisationId,
          productId: data.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ADJUSTMENT,
          quantity: data.quantity,
          referenceType: 'OpeningStock',
          referenceId: null,
          adjustmentReason: AdjustmentReason.PHYSICAL_COUNT,
          notes: data.notes,
          createdById: data.createdById,
        },
      });

      return { stock: stockWithRelations, transaction };
    });
  }
}
