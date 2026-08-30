import { Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface InventoryValuationLine {
  productId: string;
  productCode: string;
  productName: string;
  productType: ProductType;
  unit: string;
  locationId: string;
  locationName: string;
  quantityOnHand: number;
  averageUnitCost: number;
  inventoryValue: number;
}

export interface InventoryValuationByCategory {
  label: string;
  value: number;
}

export interface InventoryValuationTotals {
  grandTotal: number;
  byLocation: InventoryValuationByCategory[];
  byProductType: InventoryValuationByCategory[];
}

export interface InventoryValuationResult {
  lines: InventoryValuationLine[];
  totals: InventoryValuationTotals;
}

export interface GetInventoryValuationParams {
  locationId?: string;
  productType?: ProductType;
}

/**
 * Inventory Valuation reporting (Sprint 13, docs/domains/accounting.md §16.3) —
 * `quantityOnHand × averageUnitCost` per `(product, location)`, reusing Inventory's
 * *existing* moving-weighted-average costing figure (Sprint 9) rather than a second
 * costing engine. Reads `InventoryStock` directly — a narrow, documented, read-only
 * exception to Finance's "never imports `InventoryModule`" rule (see this class's
 * own file-level independence note and `reports-independence.spec.ts`), the same
 * shape Sprint 11/12 already established for reaching into another domain's own
 * table from inside a self-owned transaction, applied here to a plain read with no
 * transaction at all. `FinanceModule` still never imports `InventoryModule`.
 */
@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  async getValuation(
    organisationId: string,
    params: GetInventoryValuationParams = {},
  ): Promise<InventoryValuationResult> {
    const stocks = await this.prisma.inventoryStock.findMany({
      where: {
        organisationId,
        ...(params.locationId ? { locationId: params.locationId } : {}),
        ...(params.productType ? { product: { type: params.productType } } : {}),
      },
      include: {
        product: { select: { id: true, code: true, name: true, type: true, unit: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { location: { name: 'asc' } }],
    });

    const lines: InventoryValuationLine[] = stocks.map((stock) => ({
      productId: stock.product.id,
      productCode: stock.product.code,
      productName: stock.product.name,
      productType: stock.product.type,
      unit: stock.product.unit,
      locationId: stock.location.id,
      locationName: stock.location.name,
      quantityOnHand: stock.quantityOnHand,
      averageUnitCost: stock.averageUnitCost,
      inventoryValue: roundCurrency(stock.quantityOnHand * stock.averageUnitCost),
    }));

    const byLocation = new Map<string, number>();
    const byProductType = new Map<string, number>();
    let grandTotal = 0;
    for (const line of lines) {
      grandTotal = roundCurrency(grandTotal + line.inventoryValue);
      byLocation.set(
        line.locationName,
        roundCurrency((byLocation.get(line.locationName) ?? 0) + line.inventoryValue),
      );
      byProductType.set(
        line.productType,
        roundCurrency((byProductType.get(line.productType) ?? 0) + line.inventoryValue),
      );
    }

    return {
      lines,
      totals: {
        grandTotal,
        byLocation: [...byLocation.entries()].map(([label, value]) => ({ label, value })),
        byProductType: [...byProductType.entries()].map(([label, value]) => ({ label, value })),
      },
    };
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
