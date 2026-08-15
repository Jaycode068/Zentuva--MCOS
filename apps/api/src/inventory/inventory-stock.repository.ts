import { Injectable } from '@nestjs/common';
import { InventoryStock, ProductType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListInventoryStockParams {
  /** Simple case-insensitive substring match against the product's name or code (same
   *  convention as `ProductRepository.findManyByOrganisation`). */
  search?: string;
  productType?: ProductType;
}

export type InventoryStockWithProduct = InventoryStock & {
  product: { id: string; code: string; name: string; type: ProductType; unit: string };
};

const PRODUCT_SELECT = { id: true, code: true, name: true, type: true, unit: true };

/**
 * Thin Prisma access for the live `InventoryStock` balance (Sprint 4.4,
 * docs/domains/inventory.md). The only write path is
 * `GoodsReceiptRepository.receive`'s own transaction — this file is read-only.
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
        product: {
          ...(params.productType ? { type: params.productType } : {}),
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
      include: { product: { select: PRODUCT_SELECT } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findByProduct(
    organisationId: string,
    productId: string,
  ): Promise<InventoryStockWithProduct | null> {
    return this.prisma.inventoryStock.findUnique({
      where: { organisationId_productId: { organisationId, productId } },
      include: { product: { select: PRODUCT_SELECT } },
    });
  }
}
