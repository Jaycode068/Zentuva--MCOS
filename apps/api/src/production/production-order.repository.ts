import { Injectable } from '@nestjs/common';
import { Prisma, ProductionOrder, ProductionOrderStatus, ProductionRun } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListProductionOrdersParams {
  status?: ProductionOrderStatus;
  productId?: string;
  /** Simple case-insensitive substring match against the order number or the finished
   *  product's name — same convention as every other domain's `search` filter. */
  search?: string;
}

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type ProductionOrderWithRelations = ProductionOrder & {
  product: { id: string; code: string; name: string; unit: string };
  billOfMaterial: { id: string; bomNumber: string };
  location: { id: string; name: string };
  items: {
    id: string;
    componentProductId: string;
    requiredQuantity: number;
    unitOfMeasure: string;
    componentProduct: { id: string; code: string; name: string; unit: string };
  }[];
  productionRun: ProductionRun | null;
};

const RELATIONS_INCLUDE = {
  product: { select: PRODUCT_SELECT },
  billOfMaterial: { select: { id: true, bomNumber: true } },
  location: { select: { id: true, name: true } },
  items: {
    include: { componentProduct: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  productionRun: true,
};

/**
 * Thin Prisma access for the `ProductionOrder` aggregate (Sprint 4.6,
 * docs/domains/production.md). No business logic — requirement calculation, BOM
 * validation, and status-transition rules live in `ProductionOrderService`; this file
 * only knows how to read/write rows. Material Issue and Production Run each have their
 * own repository (`ProductionMaterialIssueRepository`, `ProductionRunRepository`) since
 * they're separate aggregates the brief explicitly warns against collapsing into this
 * one.
 */
@Injectable()
export class ProductionOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductionOrderCreateInput): Promise<ProductionOrderWithRelations> {
    return this.prisma.productionOrder.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<ProductionOrderWithRelations | null> {
    return this.prisma.productionOrder.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListProductionOrdersParams = {},
  ): Promise<ProductionOrderWithRelations[]> {
    return this.prisma.productionOrder.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.search
          ? {
              OR: [
                { productionOrderNumber: { contains: params.search, mode: 'insensitive' } },
                { product: { name: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `ProductionOrder.productionOrderNumber` schema comment) —
   *  checked without an `organisationId` filter, same convention as every other
   *  auto-numbered code in this codebase. */
  async existsByNumber(productionOrderNumber: string): Promise<boolean> {
    const count = await this.prisma.productionOrder.count({ where: { productionOrderNumber } });
    return count > 0;
  }

  /** Updates header fields and, when `items` is provided, replaces the entire
   *  requirement-snapshot list within the same transaction (only reachable while
   *  `status === DRAFT`, and only when `plannedQuantity` changes — enforced by
   *  `ProductionOrderService`, not here). Delete-then-recreate, same shape as
   *  `PurchaseOrderRepository.update`/`BillOfMaterialRepository.update`. */
  async update(
    organisationId: string,
    id: string,
    headerData: Prisma.ProductionOrderUncheckedUpdateManyInput,
    items?: { componentProductId: string; requiredQuantity: number; unitOfMeasure: string }[],
  ): Promise<ProductionOrderWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.productionOrder.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (items) {
        await tx.productionOrderItem.deleteMany({ where: { productionOrderId: id } });
        await tx.productionOrderItem.createMany({
          data: items.map((item) => ({ ...item, productionOrderId: id })),
        });
      }

      return tx.productionOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /** Tenant-scoped conditional status transition — `updateMany` only matches when the
   *  order's current status is one of `fromStatuses`, closing the race against a
   *  concurrent transition the same way `GoodsReceiptRepository.receive`'s own
   *  conditional `updateMany` does. Returns `null` on no match; the service turns that
   *  into a specific `BadRequestException` per the attempted transition. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: ProductionOrderStatus[],
    toStatus: ProductionOrderStatus,
    actorUserId: string,
  ): Promise<ProductionOrderWithRelations | null> {
    const result = await this.prisma.productionOrder.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: toStatus, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.productionOrder.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }
}
