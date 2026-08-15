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
}
