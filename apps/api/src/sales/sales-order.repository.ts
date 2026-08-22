import { Injectable } from '@nestjs/common';
import { Prisma, SalesOrder, SalesOrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListSalesOrdersParams {
  status?: SalesOrderStatus;
  customerId?: string;
  outletId?: string;
  /** Simple case-insensitive substring match against the order code or the customer's
   *  name — same convention as every other domain's `search` filter. */
  search?: string;
}

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type SalesOrderWithRelations = SalesOrder & {
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  items: {
    id: string;
    productId: string;
    quantity: number;
    /** Cumulative quantity fulfilled so far (Sprint 4.9) — see
     *  `SalesOrderItem.quantityFulfilled`'s schema doc comment. */
    quantityFulfilled: number;
    unitPrice: number;
    lineTotal: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  outlet: { select: { id: true, outletCode: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

/**
 * Thin Prisma access for the `SalesOrder` aggregate (Sprint 4.8, docs/domains/sales.md).
 * No business logic — customer/outlet/product validation, total calculation, and
 * status-transition rules live in `SalesOrderService`; this file only knows how to
 * read/write rows. Flat, single-module shape (no separate `SalesOrderItem` controller) —
 * same as `BillOfMaterial`+`BillOfMaterialItem`.
 */
@Injectable()
export class SalesOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma's nested `items: { create: [...] }` write is already atomic — no explicit
   *  `$transaction` needed for a pure create, same as `ProductionOrderRepository.create`. */
  create(data: Prisma.SalesOrderCreateInput): Promise<SalesOrderWithRelations> {
    return this.prisma.salesOrder.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<SalesOrderWithRelations | null> {
    return this.prisma.salesOrder.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSalesOrdersParams = {},
  ): Promise<SalesOrderWithRelations[]> {
    return this.prisma.salesOrder.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.outletId ? { outletId: params.outletId } : {}),
        ...(params.search
          ? {
              OR: [
                { orderCode: { contains: params.search, mode: 'insensitive' } },
                { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `SalesOrder.orderCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered code in this
   *  codebase. */
  async existsByCode(orderCode: string): Promise<boolean> {
    const count = await this.prisma.salesOrder.count({ where: { orderCode } });
    return count > 0;
  }

  /** Updates header fields and, when `items` is provided, replaces the entire item list
   *  within the same transaction (only reachable while `status === DRAFT`, enforced by
   *  `SalesOrderService`, not here). Delete-then-recreate, same shape as
   *  `ProductionOrderRepository.update`. */
  async update(
    organisationId: string,
    id: string,
    headerData: Prisma.SalesOrderUncheckedUpdateManyInput,
    items?: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[],
  ): Promise<SalesOrderWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.salesOrder.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (items) {
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderItem.createMany({
          data: items.map((item) => ({ ...item, salesOrderId: id })),
        });
      }

      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /** Tenant-scoped conditional status transition — `updateMany` only matches when the
   *  order's current status is one of `fromStatuses`, closing the race against a
   *  concurrent transition, same as `ProductionOrderRepository.updateStatus`. Returns
   *  `null` on no match; the service turns that into a specific `BadRequestException`. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: SalesOrderStatus[],
    toStatus: SalesOrderStatus,
    actorUserId: string,
  ): Promise<SalesOrderWithRelations | null> {
    const result = await this.prisma.salesOrder.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: toStatus, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }
}
