import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  ProductionOrderStatus,
  ProductionRejectionReason,
  ProductionRun,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CompleteProductionData {
  organisationId: string;
  productionOrderId: string;
  /** The order's own finished `productId`/`locationId` — resolved by
   *  `ProductionOrderService`, not re-derived here. */
  productId: string;
  locationId: string;
  producedQuantity: number;
  rejectedQuantity: number;
  /** Computed by `ProductionOrderService` as `producedQuantity - rejectedQuantity`
   *  before this method is ever called — never recomputed here, since this file has no
   *  business-rule responsibility, only atomic persistence. */
  acceptedQuantity: number;
  rejectionReason?: ProductionRejectionReason;
  rejectionNotes?: string;
  completedById: string;
}

/** Thrown when the Production Order isn't `IN_PROGRESS` at the moment the transaction
 *  actually runs — same "re-check inside the transaction to close a concurrency race"
 *  role as `ProductionMaterialIssueConflictError`/`GoodsReceiptConflictError`. */
export class ProductionCompletionConflictError extends Error {}

/**
 * Thin Prisma access for the `ProductionRun` aggregate (Sprint 4.6,
 * docs/domains/production.md).
 *
 * `complete()` runs the entire "finish a Production Order" operation inside one
 * `$transaction`: a conditional `updateMany` re-validates the order is still
 * `IN_PROGRESS` and performs the `IN_PROGRESS -> COMPLETED` transition, then the
 * `ProductionRun` row is created, and — only when `acceptedQuantity > 0` — the finished
 * product's `InventoryStock` increases and a paired `InventoryTransaction` `RECEIPT` row
 * is appended, exact mirror of `GoodsReceiptRepository.receive`'s "only the accepted
 * portion of a receipt ever upserts `InventoryStock`" rule. A fully-rejected run
 * (`acceptedQuantity === 0`) writes no stock/ledger row at all, same as a fully-rejected
 * `GoodsReceiptItem`.
 */
@Injectable()
export class ProductionRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async complete(data: CompleteProductionData): Promise<{ productionRun: ProductionRun }> {
    return this.prisma.$transaction(async (tx) => {
      const transition = await tx.productionOrder.updateMany({
        where: {
          id: data.productionOrderId,
          organisationId: data.organisationId,
          status: ProductionOrderStatus.IN_PROGRESS,
        },
        data: { status: ProductionOrderStatus.COMPLETED, updatedById: data.completedById },
      });
      if (transition.count === 0) {
        throw new ProductionCompletionConflictError(
          'Production order is not eligible for completion',
        );
      }

      const productionRun = await tx.productionRun.create({
        data: {
          organisationId: data.organisationId,
          productionOrderId: data.productionOrderId,
          producedQuantity: data.producedQuantity,
          rejectedQuantity: data.rejectedQuantity,
          acceptedQuantity: data.acceptedQuantity,
          rejectionReason: data.rejectionReason,
          rejectionNotes: data.rejectionNotes,
          completedById: data.completedById,
        },
      });

      if (data.acceptedQuantity > 0) {
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: data.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            quantityOnHand: data.acceptedQuantity,
          },
          update: { quantityOnHand: { increment: data.acceptedQuantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            transactionType: InventoryTransactionType.RECEIPT,
            quantity: data.acceptedQuantity,
            referenceType: 'ProductionRun',
            referenceId: productionRun.id,
          },
        });
      }

      return { productionRun };
    });
  }

  findByProductionOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<ProductionRun | null> {
    return this.prisma.productionRun.findFirst({ where: { organisationId, productionOrderId } });
  }
}
