import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  ProductionMaterialIssue,
  ProductionOrderStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type ProductionMaterialIssueWithItems = ProductionMaterialIssue & {
  items: {
    id: string;
    componentProductId: string;
    quantityIssued: number;
    componentProduct: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  items: { include: { componentProduct: { select: PRODUCT_SELECT } } },
};

export interface IssueMaterialItemData {
  componentProductId: string;
  quantity: number;
}

export interface IssueMaterialData {
  organisationId: string;
  productionOrderId: string;
  /** The order's own `locationId`, resolved by `ProductionOrderService` — every
   *  component in one issue batch is consumed from the same location as the order
   *  itself. */
  locationId: string;
  issuedDate: Date;
  issuedById: string;
  notes?: string;
  items: IssueMaterialItemData[];
}

export interface IssueMaterialResult {
  materialIssue: ProductionMaterialIssueWithItems;
  /** Whether this call is what moved the order from `PLANNED` to `IN_PROGRESS` — drives
   *  the conditional `production.order.started` audit event. `false` when the order was
   *  already `IN_PROGRESS` (a later, partial issue). */
  transitionedToInProgress: boolean;
}

/** Thrown when a component's current `quantityOnHand` at the issue location can't cover
 *  the requested issue quantity. Its own `Error` subclass (not `BadRequestException`)
 *  because this file has no Nest HTTP context — same "repository stays
 *  framework-agnostic, service throws HTTP exceptions" convention as
 *  `InventoryStockRepository`'s `NegativeStockError`. */
export class InsufficientStockError extends Error {}

/** Thrown when the Production Order isn't in `PLANNED`/`IN_PROGRESS` at the moment the
 *  transaction actually runs — re-checked here to close the race against a concurrent
 *  status change between `ProductionOrderService`'s pre-check and this transaction, same
 *  role as `GoodsReceiptConflictError`. */
export class ProductionMaterialIssueConflictError extends Error {}

/**
 * Thin Prisma access for the `ProductionMaterialIssue` aggregate (Sprint 4.6,
 * docs/domains/production.md).
 *
 * `issue()` runs the entire "consume raw materials against a Production Order" operation
 * inside a single `$transaction`, mirroring `GoodsReceiptRepository.receive`'s shape
 * exactly: a conditional `updateMany` both re-validates the order is still eligible and
 * performs the `PLANNED -> IN_PROGRESS` transition (idempotently, if already
 * `IN_PROGRESS`) in one call, then for each component reads the current `InventoryStock`
 * balance *inside* the transaction (not from a pre-check the caller already did — closing
 * the race between two concurrent issues a stale pre-check couldn't), decrements it, and
 * appends a paired `InventoryTransaction` `ISSUE` row. If any one component is short, the
 * whole transaction throws and every prior write in it rolls back — brief §13's "never
 * partially issue materials."
 *
 * Writing directly to `inventory_stock`/`inventory_transactions` here is a deliberate,
 * narrow exception to ADR-002's domain-ownership convention, made for atomicity — the
 * exact same rationale and shape as `GoodsReceiptRepository.receive`'s own
 * `purchaseOrder.updateMany` call into Procurement's table. See
 * docs/domains/production.md "Integration Points".
 */
@Injectable()
export class ProductionMaterialIssueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async issue(data: IssueMaterialData): Promise<IssueMaterialResult> {
    return this.prisma.$transaction(async (tx) => {
      const priorOrder = await tx.productionOrder.findUniqueOrThrow({
        where: { id: data.productionOrderId },
        select: { status: true },
      });

      const transition = await tx.productionOrder.updateMany({
        where: {
          id: data.productionOrderId,
          organisationId: data.organisationId,
          status: { in: [ProductionOrderStatus.PLANNED, ProductionOrderStatus.IN_PROGRESS] },
        },
        data: { status: ProductionOrderStatus.IN_PROGRESS, updatedById: data.issuedById },
      });
      if (transition.count === 0) {
        throw new ProductionMaterialIssueConflictError(
          'Production order is not eligible for material issue',
        );
      }

      for (const item of data.items) {
        const existing = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.componentProductId,
              locationId: data.locationId,
            },
          },
        });
        const currentQuantity = existing?.quantityOnHand ?? 0;
        const newQuantity = roundQuantity(currentQuantity - item.quantity);
        if (newQuantity < 0) {
          throw new InsufficientStockError(
            `Insufficient stock for component ${item.componentProductId} (available: ${currentQuantity}, requested: ${item.quantity})`,
          );
        }
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.componentProductId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: item.componentProductId,
            locationId: data.locationId,
            quantityOnHand: newQuantity,
          },
          update: { quantityOnHand: newQuantity },
        });
      }

      const materialIssue = await tx.productionMaterialIssue.create({
        data: {
          organisationId: data.organisationId,
          productionOrderId: data.productionOrderId,
          issuedDate: data.issuedDate,
          issuedById: data.issuedById,
          notes: data.notes,
          items: {
            create: data.items.map((item) => ({
              componentProductId: item.componentProductId,
              quantityIssued: item.quantity,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: data.items.map((item) => ({
          organisationId: data.organisationId,
          productId: item.componentProductId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ISSUE,
          quantity: item.quantity,
          referenceType: 'ProductionMaterialIssue',
          referenceId: materialIssue.id,
        })),
      });

      return {
        materialIssue,
        transitionedToInProgress: priorOrder.status !== ProductionOrderStatus.IN_PROGRESS,
      };
    });
  }

  /** Cumulative issued quantity per component, across every `ProductionMaterialIssue`
   *  ever recorded against this order — mirrors
   *  `GoodsReceiptRepository.getReceivingTotals`'s `groupBy` shape. */
  async getIssuedTotals(
    organisationId: string,
    productionOrderId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.productionMaterialIssueItem.groupBy({
      by: ['componentProductId'],
      where: { productionMaterialIssue: { organisationId, productionOrderId } },
      _sum: { quantityIssued: true },
    });
    return new Map(rows.map((row) => [row.componentProductId, row._sum.quantityIssued ?? 0]));
  }

  findManyByProductionOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<ProductionMaterialIssueWithItems[]> {
    return this.prisma.productionMaterialIssue.findMany({
      where: { organisationId, productionOrderId },
      include: RELATIONS_INCLUDE,
      orderBy: { issuedDate: 'desc' },
    });
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
