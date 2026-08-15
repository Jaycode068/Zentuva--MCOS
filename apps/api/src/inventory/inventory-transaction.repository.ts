import { Injectable } from '@nestjs/common';
import { InventoryTransaction, InventoryTransactionType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListInventoryTransactionsParams {
  productId?: string;
  transactionType?: InventoryTransactionType;
}

export type InventoryTransactionWithProduct = InventoryTransaction & {
  product: { id: string; code: string; name: string; unit: string };
};

/**
 * Thin, read-only Prisma access for the immutable `InventoryTransaction` ledger (Sprint
 * 4.4, docs/domains/inventory.md "Stock Ledger"). Every row is inserted transactionally
 * by whichever operation moved stock — `GoodsReceiptRepository.receive` this sprint,
 * `RECEIPT` only — never here.
 */
@Injectable()
export class InventoryTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOrganisation(
    organisationId: string,
    params: ListInventoryTransactionsParams = {},
  ): Promise<InventoryTransactionWithProduct[]> {
    return this.prisma.inventoryTransaction.findMany({
      where: {
        organisationId,
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.transactionType ? { transactionType: params.transactionType } : {}),
      },
      include: { product: { select: { id: true, code: true, name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Single-product counterpart of `getLastMovementByProduct` — used where only one
   *  product's history is already being read (`InventoryService.getStockByProduct`),
   *  so a full organisation-wide `groupBy` would be wasted work. */
  async getLastMovementForProduct(organisationId: string, productId: string): Promise<Date | null> {
    const row = await this.prisma.inventoryTransaction.findFirst({
      where: { organisationId, productId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /** Most recent transaction timestamp per product (Sprint 4.5 brief §11 "Last
   *  Movement" column) — one `groupBy` for the whole Inventory Summary table rather
   *  than an N+1 query per row. */
  async getLastMovementByProduct(organisationId: string): Promise<Map<string, Date>> {
    const rows = await this.prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: { organisationId },
      _max: { createdAt: true },
    });
    const result = new Map<string, Date>();
    for (const row of rows) {
      if (row._max.createdAt) {
        result.set(row.productId, row._max.createdAt);
      }
    }
    return result;
  }
}
