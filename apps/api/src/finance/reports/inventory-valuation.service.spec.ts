import { PrismaService } from '../../prisma/prisma.service';
import { InventoryValuationService } from './inventory-valuation.service';

function makeStock(overrides: {
  productId: string;
  productCode: string;
  productName: string;
  productType: string;
  unit?: string;
  locationId: string;
  locationName: string;
  quantityOnHand: number;
  averageUnitCost: number;
}) {
  return {
    product: {
      id: overrides.productId,
      code: overrides.productCode,
      name: overrides.productName,
      type: overrides.productType,
      unit: overrides.unit ?? 'Kilogram',
    },
    location: { id: overrides.locationId, name: overrides.locationName },
    quantityOnHand: overrides.quantityOnHand,
    averageUnitCost: overrides.averageUnitCost,
  };
}

function makeService(stocks: ReturnType<typeof makeStock>[]) {
  const prisma = {
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue(stocks),
    },
  } as unknown as jest.Mocked<PrismaService>;
  return { service: new InventoryValuationService(prisma), prisma };
}

describe('InventoryValuationService', () => {
  it('computes inventoryValue as quantityOnHand × averageUnitCost per line', async () => {
    const { service } = makeService([
      makeStock({
        productId: 'p1',
        productCode: 'PRD-001',
        productName: 'Printed Nylon',
        productType: 'PACKAGING_MATERIAL',
        locationId: 'loc-1',
        locationName: 'Main Warehouse',
        quantityOnHand: 1000,
        averageUnitCost: 150,
      }),
    ]);

    const result = await service.getValuation('org-1');

    expect(result.lines[0]!.inventoryValue).toBe(150_000);
    expect(result.totals.grandTotal).toBe(150_000);
  });

  it('totals by location across multiple products at the same location', async () => {
    const { service } = makeService([
      makeStock({
        productId: 'p1',
        productCode: 'PRD-001',
        productName: 'Raw Material A',
        productType: 'RAW_MATERIAL',
        locationId: 'loc-1',
        locationName: 'Main Warehouse',
        quantityOnHand: 100,
        averageUnitCost: 500,
      }),
      makeStock({
        productId: 'p2',
        productCode: 'PRD-002',
        productName: 'Finished Good B',
        productType: 'FINISHED_PRODUCT',
        locationId: 'loc-1',
        locationName: 'Main Warehouse',
        quantityOnHand: 50,
        averageUnitCost: 1000,
      }),
    ]);

    const result = await service.getValuation('org-1');

    expect(result.totals.grandTotal).toBe(100_000); // 50,000 + 50,000
    expect(result.totals.byLocation).toEqual([{ label: 'Main Warehouse', value: 100_000 }]);
  });

  it('totals by product type across multiple locations', async () => {
    const { service } = makeService([
      makeStock({
        productId: 'p1',
        productCode: 'PRD-001',
        productName: 'Raw Material A',
        productType: 'RAW_MATERIAL',
        locationId: 'loc-1',
        locationName: 'Main Warehouse',
        quantityOnHand: 100,
        averageUnitCost: 500,
      }),
      makeStock({
        productId: 'p1',
        productCode: 'PRD-001',
        productName: 'Raw Material A',
        productType: 'RAW_MATERIAL',
        locationId: 'loc-2',
        locationName: 'Secondary Store',
        quantityOnHand: 20,
        averageUnitCost: 500,
      }),
    ]);

    const result = await service.getValuation('org-1');

    expect(result.totals.byProductType).toEqual([{ label: 'RAW_MATERIAL', value: 60_000 }]);
    expect(result.totals.byLocation).toHaveLength(2);
  });

  it('handles zero stock/cost without producing NaN', async () => {
    const { service } = makeService([
      makeStock({
        productId: 'p1',
        productCode: 'PRD-001',
        productName: 'New Product',
        productType: 'FINISHED_PRODUCT',
        locationId: 'loc-1',
        locationName: 'Main Warehouse',
        quantityOnHand: 0,
        averageUnitCost: 0,
      }),
    ]);

    const result = await service.getValuation('org-1');

    expect(result.lines[0]!.inventoryValue).toBe(0);
    expect(Number.isNaN(result.totals.grandTotal)).toBe(false);
  });

  it('passes locationId/productType filters through to the query', async () => {
    const { service, prisma } = makeService([]);

    await service.getValuation('org-1', {
      locationId: 'loc-1',
      productType: 'RAW_MATERIAL' as never,
    });

    expect(prisma.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: 'org-1',
          locationId: 'loc-1',
          product: { type: 'RAW_MATERIAL' },
        }),
      }),
    );
  });

  it('returns an empty, zeroed result when there is no stock at all', async () => {
    const { service } = makeService([]);

    const result = await service.getValuation('org-1');

    expect(result.lines).toEqual([]);
    expect(result.totals.grandTotal).toBe(0);
    expect(result.totals.byLocation).toEqual([]);
  });
});
