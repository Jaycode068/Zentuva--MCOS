import { ProductionPerformanceReportService } from './production-performance-report.service';

describe('ProductionPerformanceReportService', () => {
  function makeService(orders: unknown[], total = orders.length) {
    const prisma = {
      productionOrder: {
        count: jest.fn().mockResolvedValue(total),
        findMany: jest.fn().mockResolvedValue(orders),
      },
      productionRun: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { acceptedQuantity: 80 } }),
      },
    };
    const materialIssueRepository = { getTotalWipValue: jest.fn().mockResolvedValue(1000) };
    const service = new ProductionPerformanceReportService(
      prisma as never,
      materialIssueRepository as never,
    );
    return { service, prisma, materialIssueRepository };
  }

  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-02-01T00:00:00Z');

  it('computes yieldPercent as acceptedQuantity / plannedQuantity, as a percentage', async () => {
    const { service } = makeService([
      {
        id: 'po-1',
        productionOrderNumber: 'PROD-001',
        productId: 'prod-1',
        plannedQuantity: 200,
        product: { name: 'Widget' },
        productionRun: {
          producedQuantity: 200,
          acceptedQuantity: 190,
          rejectedQuantity: 10,
          completedAt: new Date('2026-01-15T00:00:00Z'),
        },
      },
    ]);
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.table.rows[0]!.yieldPercent).toBe(95);
  });

  it('returns null (never NaN/Infinity) for yieldPercent when plannedQuantity is 0', async () => {
    const { service } = makeService([
      {
        id: 'po-1',
        productionOrderNumber: 'PROD-001',
        productId: 'prod-1',
        plannedQuantity: 0,
        product: { name: 'Widget' },
        productionRun: {
          producedQuantity: 0,
          acceptedQuantity: 0,
          rejectedQuantity: 0,
          completedAt: new Date('2026-01-15T00:00:00Z'),
        },
      },
    ]);
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.table.rows[0]!.yieldPercent).toBeNull();
  });

  it('sums produced/accepted/rejected/materialCost across every row on the current page', async () => {
    const { service } = makeService([
      {
        id: 'po-1',
        productionOrderNumber: 'PROD-001',
        productId: 'prod-1',
        plannedQuantity: 100,
        product: { name: 'A' },
        productionRun: {
          producedQuantity: 100,
          acceptedQuantity: 90,
          rejectedQuantity: 10,
          completedAt: to,
        },
      },
      {
        id: 'po-2',
        productionOrderNumber: 'PROD-002',
        productId: 'prod-2',
        plannedQuantity: 50,
        product: { name: 'B' },
        productionRun: {
          producedQuantity: 50,
          acceptedQuantity: 48,
          rejectedQuantity: 2,
          completedAt: to,
        },
      },
    ]);
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.totalProduced).toBe(150);
    expect(report.totalAccepted).toBe(138);
    expect(report.totalRejected).toBe(12);
    expect(report.totalMaterialCost).toBe(2000); // 1000 (mocked) per order × 2 orders
  });

  it('scopes the query to COMPLETED orders with a productionRun within [from, to)', async () => {
    const { service, prisma } = makeService([]);
    await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: 'org-1',
          status: 'COMPLETED',
          productionRun: { completedAt: { gte: from, lt: to } },
        }),
      }),
    );
  });

  it('comparisonTotalAccepted is null when no comparison period was requested — never queried', async () => {
    const { service, prisma } = makeService([]);
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.comparisonTotalAccepted).toBeNull();
    expect(prisma.productionRun.aggregate).not.toHaveBeenCalled();
  });

  it('comparisonTotalAccepted is populated from a sum aggregate over the comparison window', async () => {
    const { service } = makeService([]);
    const comparisonFrom = new Date('2025-12-01T00:00:00Z');
    const comparisonTo = new Date('2026-01-01T00:00:00Z');
    const report = await service.getReport('org-1', {
      from,
      to,
      comparisonFrom,
      comparisonTo,
      page: 1,
      pageSize: 25,
    });
    expect(report.comparisonTotalAccepted).toBe(80);
  });

  it('comparisonTotalAccepted is null (not 0) when the comparison window had no completed production', async () => {
    const { service, prisma } = makeService([]);
    (prisma.productionRun.aggregate as jest.Mock).mockResolvedValue({
      _sum: { acceptedQuantity: null },
    });
    const report = await service.getReport('org-1', {
      from,
      to,
      comparisonFrom: new Date('2025-12-01T00:00:00Z'),
      comparisonTo: new Date('2026-01-01T00:00:00Z'),
      page: 1,
      pageSize: 25,
    });
    expect(report.comparisonTotalAccepted).toBeNull();
  });
});
