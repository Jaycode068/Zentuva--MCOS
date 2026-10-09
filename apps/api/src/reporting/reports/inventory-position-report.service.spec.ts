import { InventoryPositionReportService } from './inventory-position-report.service';

describe('InventoryPositionReportService', () => {
  function makeService(lineCount: number) {
    const lines = Array.from({ length: lineCount }, (_, i) => ({
      productId: `p-${i}`,
      productCode: `PRD-${i}`,
      productName: `Product ${i}`,
      productType: 'FINISHED_PRODUCT',
      unit: 'pcs',
      locationId: 'loc-1',
      locationName: 'Main Warehouse',
      quantityOnHand: 10,
      averageUnitCost: 5,
      inventoryValue: 50,
    }));
    const inventoryValuationService = {
      getValuation: jest.fn().mockResolvedValue({
        lines,
        totals: { grandTotal: lineCount * 50, byLocation: [], byProductType: [] },
      }),
    };
    return new InventoryPositionReportService(inventoryValuationService as never);
  }

  it('paginates the underlying (unpaginated) valuation lines', async () => {
    const service = makeService(10);
    const report = await service.getReport('org-1', { page: 1, pageSize: 3 });
    expect(report.table.rows).toHaveLength(3);
    expect(report.table.total).toBe(10);
    expect(report.table.rows[0]!.productId).toBe('p-0');
  });

  it('returns the correct page 2 slice', async () => {
    const service = makeService(10);
    const report = await service.getReport('org-1', { page: 2, pageSize: 3 });
    expect(report.table.rows.map((row) => row.productId)).toEqual(['p-3', 'p-4', 'p-5']);
  });

  it('returns an empty rows array (never an error) for a page past the end', async () => {
    const service = makeService(5);
    const report = await service.getReport('org-1', { page: 10, pageSize: 25 });
    expect(report.table.rows).toEqual([]);
    expect(report.table.total).toBe(5);
  });

  it('passes locationId/productType filters through to the valuation service unchanged', async () => {
    const service = makeService(0);
    const inventoryValuationService = (
      service as unknown as { inventoryValuationService: { getValuation: jest.Mock } }
    ).inventoryValuationService;
    await service.getReport('org-1', { locationId: 'loc-9', page: 1, pageSize: 25 });
    expect(inventoryValuationService.getValuation).toHaveBeenCalledWith('org-1', {
      locationId: 'loc-9',
      productType: undefined,
    });
  });
});
