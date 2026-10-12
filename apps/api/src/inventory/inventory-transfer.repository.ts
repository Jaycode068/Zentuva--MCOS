import { Injectable } from '@nestjs/common';
import { InventoryTransactionType, InventoryTransfer, TransferStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  decrementStockIfAvailable,
  incrementStockWithCostIfCompatible,
} from './inventory-stock-concurrency.util';

export type InventoryTransferWithRelations = InventoryTransfer & {
  product: { id: string; code: string; name: string; unit: string };
  sourceLocation: { id: string; name: string };
  destinationLocation: { id: string; name: string };
};

const RELATIONS_INCLUDE = {
  product: { select: { id: true, code: true, name: true, unit: true } },
  sourceLocation: { select: { id: true, name: true } },
  destinationLocation: { select: { id: true, name: true } },
};

export interface CreateTransferData {
  organisationId: string;
  transferNumber: string;
  productId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface TransferResult {
  transfer: InventoryTransferWithRelations;
  wasCreated: boolean;
}

/** Thrown when the source location has no recorded stock for this product, or not
 *  enough of it, at the moment the transaction actually runs — the database's own
 *  conditional `UPDATE` (`decrementStockIfAvailable`) is the authority, not a pre-check
 *  read moments earlier. Its own `Error` subclass, not `BadRequestException`, same
 *  "repository stays framework-agnostic" convention as `GoodsReceiptConflictError`/
 *  `NegativeStockError`. */
export class InsufficientStockError extends Error {}

/** Thrown when the destination location already holds this product under a DIFFERENT
 *  `StockOwnership`/`StockArrangement` than the source currently has — see
 *  `InventoryStock.ownership`'s own schema comment ("Phase 2B/2C design question") and
 *  `incrementStockWithCostIfCompatible`'s doc comment. Deliberately rejected, never
 *  silently merged. */
export class OwnershipMismatchError extends Error {}

/** Thrown when a transfer being reversed is not currently `COMPLETED` (already
 *  reversed, or a concurrent reversal attempt won the race). */
export class TransferNotReversibleError extends Error {}

/**
 * Thin Prisma access for the `InventoryTransfer` aggregate (Phase 2B — Customer Outlet
 * Stock Tracking & Transfers). Modelled exactly like `GoodsReceiptRepository`: an
 * idempotency check-then-return, then one atomic `$transaction` that validates and
 * moves stock, writes the two `InventoryTransaction` ledger rows the movement produces,
 * and creates the header row — all of it rolling back together on any failure. Never
 * accepts `ownership`/`arrangement` as input; both are always read off the SOURCE
 * `InventoryStock` row inside the same transaction (see `InventoryTransfer.ownership`'s
 * own schema comment) — this is the actual enforcement of "preserve ownership unless an
 * explicitly supported business event authorises a change" (brief §3.1), not a
 * convention the caller is trusted to follow.
 */
@Injectable()
export class InventoryTransferRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<InventoryTransferWithRelations | null> {
    return this.prisma.inventoryTransfer.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: { productId?: string; locationId?: string } = {},
  ): Promise<InventoryTransferWithRelations[]> {
    return this.prisma.inventoryTransfer.findMany({
      where: {
        organisationId,
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.locationId
          ? {
              OR: [
                { sourceLocationId: params.locationId },
                { destinationLocationId: params.locationId },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `InventoryTransfer.transferNumber` schema comment) — same
   *  convention as `GoodsReceiptRepository.existsByNumber`. */
  async existsByNumber(transferNumber: string): Promise<boolean> {
    const count = await this.prisma.inventoryTransfer.count({ where: { transferNumber } });
    return count > 0;
  }

  async create(data: CreateTransferData): Promise<TransferResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.inventoryTransfer.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { transfer: existing, wasCreated: false };
        }
      }

      const sourceStockRef = {
        organisationId: data.organisationId,
        productId: data.productId,
        locationId: data.sourceLocationId,
      };
      // Read BEFORE decrementing — we need the source's current ownership/arrangement/
      // cost to carry forward. Safe to read ahead of the atomic decrement below: unlike
      // `quantityOnHand`, nothing in this codebase ever mutates `ownership`/
      // `arrangement`/`averageUnitCost` concurrently with a decrement (no "change
      // ownership" or "re-cost" mutation exists), so there is no race on the values
      // actually being read here — only on `quantityOnHand`, which the conditional
      // decrement below re-checks atomically regardless of what was read here.
      const sourceStock = await tx.inventoryStock.findUnique({
        where: { organisationId_productId_locationId: sourceStockRef },
      });
      if (!sourceStock) {
        throw new InsufficientStockError(
          'No stock is recorded for this product at the source location',
        );
      }
      const { ownership, arrangement, averageUnitCost: sourceCost } = sourceStock;

      const decremented = await decrementStockIfAvailable(tx, sourceStockRef, data.quantity);
      if (!decremented) {
        throw new InsufficientStockError(
          `Insufficient stock at the source location (available: ${sourceStock.quantityOnHand}, requested: ${data.quantity})`,
        );
      }

      const incrementResult = await incrementStockWithCostIfCompatible(
        tx,
        {
          organisationId: data.organisationId,
          productId: data.productId,
          locationId: data.destinationLocationId,
        },
        data.quantity,
        sourceCost,
        ownership,
        arrangement,
      );
      if (!incrementResult.applied) {
        // The source decrement above already committed within this same transaction —
        // throwing here rolls the WHOLE transaction back, including that decrement, so
        // the source balance is restored exactly as if nothing had happened. A failed
        // transfer never leaves source and destination inconsistent (brief §3.1).
        if (incrementResult.ownershipMismatch) {
          throw new OwnershipMismatchError(
            'The destination location already holds this product under a different ownership/arrangement; this transfer cannot be completed without ambiguity',
          );
        }
        throw new Error('Failed to apply the destination stock increment');
      }

      const transfer = await tx.inventoryTransfer.create({
        data: {
          organisationId: data.organisationId,
          transferNumber: data.transferNumber,
          productId: data.productId,
          sourceLocationId: data.sourceLocationId,
          destinationLocationId: data.destinationLocationId,
          quantity: data.quantity,
          ownership,
          arrangement,
          status: TransferStatus.COMPLETED,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: [
          {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.sourceLocationId,
            transactionType: InventoryTransactionType.TRANSFER,
            quantity: data.quantity,
            referenceType: 'TransferOut',
            referenceId: transfer.id,
            createdById: data.createdById,
          },
          {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.destinationLocationId,
            transactionType: InventoryTransactionType.TRANSFER,
            quantity: data.quantity,
            referenceType: 'TransferIn',
            referenceId: transfer.id,
            createdById: data.createdById,
          },
        ],
      });

      return { transfer, wasCreated: true };
    });
  }

  /**
   * Reverses a `COMPLETED` transfer by recording a NEW `InventoryTransfer` row with
   * source/destination swapped and `reversalOfTransferId` set — the original row is
   * never deleted or mutated beyond its own `status` flip to `REVERSED` (brief §3.1:
   * "support a safe, traceable reversal without deleting original history"). Double
   * protection against a concurrent double-reversal: the conditional `updateMany`
   * below (`status: COMPLETED` → `REVERSED`) only succeeds for whichever concurrent
   * request gets there first, AND the schema's own `@unique([reversalOfTransferId])`
   * constraint would reject a second reversal row even if that conditional check were
   * ever bypassed.
   */
  async reverse(
    organisationId: string,
    originalTransferId: string,
    reversalTransferNumber: string,
    notes: string | undefined,
    actorUserId: string,
  ): Promise<TransferResult> {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.inventoryTransfer.findFirst({
        where: { id: originalTransferId, organisationId },
      });
      if (!original) {
        throw new TransferNotReversibleError('Transfer not found');
      }

      const claimed = await tx.inventoryTransfer.updateMany({
        where: { id: original.id, organisationId, status: TransferStatus.COMPLETED },
        data: { status: TransferStatus.REVERSED },
      });
      if (claimed.count === 0) {
        throw new TransferNotReversibleError(
          'This transfer is not COMPLETED (already reversed, or a concurrent reversal won the race)',
        );
      }

      // Mirror movement: destination → source, same product/quantity/ownership/
      // arrangement the original transfer carried (never re-derived — a reversal must
      // undo exactly what happened, not re-evaluate current stock state at the
      // destination).
      const reverseSourceRef = {
        organisationId,
        productId: original.productId,
        locationId: original.destinationLocationId,
      };
      // Read the destination's CURRENT cost before decrementing it — this is the
      // "incoming cost" the reversal carries back to the original source location,
      // the exact mirror of how `create()` above reads the source's cost before
      // decrementing it. Safe to read ahead of the atomic decrement for the same
      // reason noted in `create()`: nothing concurrently mutates `averageUnitCost`
      // outside a decrement/increment this same code already serializes on.
      const destinationStock = await tx.inventoryStock.findUnique({
        where: { organisationId_productId_locationId: reverseSourceRef },
      });
      if (!destinationStock) {
        throw new InsufficientStockError(
          'The destination location no longer holds any stock of this product to reverse',
        );
      }
      const reversalIncomingCost = destinationStock.averageUnitCost;

      const decremented = await decrementStockIfAvailable(tx, reverseSourceRef, original.quantity);
      if (!decremented) {
        throw new InsufficientStockError(
          'The destination location no longer holds enough stock to reverse this transfer (some may have already moved on)',
        );
      }

      const incrementResult = await incrementStockWithCostIfCompatible(
        tx,
        { organisationId, productId: original.productId, locationId: original.sourceLocationId },
        original.quantity,
        reversalIncomingCost,
        original.ownership,
        original.arrangement,
      );
      if (!incrementResult.applied) {
        if (incrementResult.ownershipMismatch) {
          throw new OwnershipMismatchError(
            'The original source location now holds this product under a different ownership/arrangement; this reversal cannot be completed without ambiguity',
          );
        }
        throw new Error('Failed to apply the reversal stock increment');
      }

      const reversal = await tx.inventoryTransfer.create({
        data: {
          organisationId,
          transferNumber: reversalTransferNumber,
          productId: original.productId,
          sourceLocationId: original.destinationLocationId,
          destinationLocationId: original.sourceLocationId,
          quantity: original.quantity,
          ownership: original.ownership,
          arrangement: original.arrangement,
          status: TransferStatus.COMPLETED,
          notes,
          reversalOfTransferId: original.id,
          createdById: actorUserId,
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: [
          {
            organisationId,
            productId: original.productId,
            locationId: original.destinationLocationId,
            transactionType: InventoryTransactionType.TRANSFER,
            quantity: original.quantity,
            referenceType: 'TransferReversalOut',
            referenceId: reversal.id,
            createdById: actorUserId,
          },
          {
            organisationId,
            productId: original.productId,
            locationId: original.sourceLocationId,
            transactionType: InventoryTransactionType.TRANSFER,
            quantity: original.quantity,
            referenceType: 'TransferReversalIn',
            referenceId: reversal.id,
            createdById: actorUserId,
          },
        ],
      });

      return { transfer: reversal, wasCreated: true };
    });
  }
}
