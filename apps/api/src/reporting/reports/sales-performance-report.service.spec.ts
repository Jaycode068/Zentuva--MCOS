import { SalesPerformanceReportService } from './sales-performance-report.service';

describe('SalesPerformanceReportService', () => {
  function makeService() {
    const prisma = {
      salesOrder: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'CONFIRMED', _count: 2 }]),
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const revenueCogsService = {
      getRevenueReport: jest
        .fn()
        .mockResolvedValue({ totalRevenue: 500, byProduct: [], byCustomer: [] }),
    };
    const service = new SalesPerformanceReportService(prisma as never, revenueCogsService as never);
    return { service, prisma, revenueCogsService };
  }

  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-02-01T00:00:00Z');

  it('filters every SalesOrder query to source: B2B — a D2C order is never counted as a second channel of the same figure', async () => {
    const { service, prisma } = makeService();
    await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });

    expect(prisma.salesOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'B2B' }) }),
    );
    expect(prisma.salesOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'B2B' }) }),
    );
    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: 'B2B' }) }),
    );
  });

  it('the headline revenue figure comes from RevenueCogsService — never recomputed from SalesOrder.total', async () => {
    const { service, revenueCogsService } = makeService();
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.revenue.totalRevenue).toBe(500);
    expect(revenueCogsService.getRevenueReport).toHaveBeenCalledWith('org-1', { from, to });
  });

  it('an optional status filter, when supplied, narrows the order-table query', async () => {
    const { service, prisma } = makeService();
    await service.getReport('org-1', { from, to, status: 'FULFILLED', page: 1, pageSize: 25 });
    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'FULFILLED' }) }),
    );
  });

  it('comparisonRevenue is null when no comparison period was requested — never fetched', async () => {
    const { service, revenueCogsService } = makeService();
    const report = await service.getReport('org-1', { from, to, page: 1, pageSize: 25 });
    expect(report.comparisonRevenue).toBeNull();
    expect(revenueCogsService.getRevenueReport).toHaveBeenCalledTimes(1);
  });

  it('comparisonRevenue is populated from a second getRevenueReport call for the comparison window', async () => {
    const { service, revenueCogsService } = makeService();
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
    expect(report.comparisonRevenue).toBe(500);
    expect(revenueCogsService.getRevenueReport).toHaveBeenCalledWith('org-1', {
      from: comparisonFrom,
      to: comparisonTo,
    });
  });

  it('comparisonRevenue is null (not 0) when the comparison period had zero revenue', async () => {
    const prisma = {
      salesOrder: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const revenueCogsService = {
      getRevenueReport: jest
        .fn()
        .mockResolvedValueOnce({ totalRevenue: 500, byProduct: [], byCustomer: [] })
        .mockResolvedValueOnce({ totalRevenue: 0, byProduct: [], byCustomer: [] }),
    };
    const service = new SalesPerformanceReportService(prisma as never, revenueCogsService as never);
    const report = await service.getReport('org-1', {
      from,
      to,
      comparisonFrom: new Date('2025-12-01T00:00:00Z'),
      comparisonTo: new Date('2026-01-01T00:00:00Z'),
      page: 1,
      pageSize: 25,
    });
    expect(report.comparisonRevenue).toBeNull();
  });
});
