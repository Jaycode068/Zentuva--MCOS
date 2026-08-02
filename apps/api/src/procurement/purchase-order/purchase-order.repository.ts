import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListPurchaseOrdersParams {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  /** Simple case-insensitive substring match against the PO number or the supplier's
   *  name (Sprint 4.3 brief: "Search" — same convention as
   *  `SupplierRepository.findManyByOrganisation`). */
  search?: string;
}

export type PurchaseOrderWithRelations = PurchaseOrder & {
  items: (PurchaseOrderItem & {
    product: { id: string; code: string; name: string; unit: string };
  })[];
  supplier: { id: string; supplierCode: string; supplierName: string };
};

const RELATIONS_INCLUDE = {
  items: {
    include: { product: { select: { id: true, code: true, name: true, unit: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  supplier: { select: { id: true, supplierCode: true, supplierName: true } },
};

/**
 * Thin Prisma access for the PurchaseOrder aggregate (header + items). No business
 * logic — see PurchaseOrderService and docs/domains/procurement.md.
 *
 * Tenant-safety convention (matches `SupplierRepository`/`ProductRepository`,
 * identity.md §7): every method that reads or writes a specific purchase order takes
 * `organisationId` and includes it in the query.
 */
@Injectable()
export class PurchaseOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.PurchaseOrderCreateInput): Promise<PurchaseOrderWithRelations> {
    return this.prisma.purchaseOrder.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<PurchaseOrderWithRelations | null> {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListPurchaseOrdersParams = {},
  ): Promise<PurchaseOrderWithRelations[]> {
    return this.prisma.purchaseOrder.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.search
          ? {
              OR: [
                { purchaseOrderNumber: { contains: params.search, mode: 'insensitive' } },
                { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `PurchaseOrder.purchaseOrderNumber` schema comment) — checked
   *  without an `organisationId` filter, unlike every other lookup on this repository. */
  async existsByNumber(purchaseOrderNumber: string): Promise<boolean> {
    const count = await this.prisma.purchaseOrder.count({ where: { purchaseOrderNumber } });
    return count > 0;
  }

  /**
   * Updates the header fields and, when `items` is provided, replaces the entire item
   * list within the same transaction (delete-then-recreate rather than diffing — the
   * frontend's "Items Grid" always submits the full current row set, so there's no
   * partial/line-level update to reconcile). Returns `null` if no row matched
   * `(id, organisationId)`, same "tenant-scoped updateMany, then re-fetch" convention as
   * `SupplierRepository.update`.
   */
  async update(
    organisationId: string,
    id: string,
    // "Unchecked" variant — exposes the raw `supplierId` scalar directly, since
    // `updateMany` (unlike `update`) has no `supplier: { connect }` relation syntax to
    // change the FK with.
    headerData: Prisma.PurchaseOrderUncheckedUpdateManyInput,
    items?: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[],
  ): Promise<PurchaseOrderWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (items) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({
          data: items.map((item) => ({ ...item, purchaseOrderId: id })),
        });
      }

      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }
}
