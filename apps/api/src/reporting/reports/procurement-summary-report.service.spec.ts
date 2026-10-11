import { ProcurementSummaryReportService } from './procurement-summary-report.service';

describe('ProcurementSummaryReportService', () => {
  function makeService() {
    const prisma = {
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(12),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 500000 } }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'po-1',
            purchaseOrderNumber: 'PO-000001',
            supplierId: 'sup-1',
            status: 'PENDING',
            total: 100000,
            orderDate: new Date('2026-01-05'),
            supplier: { supplierName: 'Fresh Farms Ltd' },
          },
        ]),
      },
      supplierInvoice: { count: jest.fn().mockResolvedValue(2) },
    };
    const accountsPayableService = {
      getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 300000, totalOverdue: 50000 }),
    };
    const service = new ProcurementSummaryReportService(
      prisma as never,
      accountsPayableService as never,
    );
    return { service, prisma, accountsPayableService };
  }

  it('openPurchaseOrderValue comes from a real aggregate SUM, not just the (capped) list of returned rows', async () => {
    const { service, prisma } = makeService();
    const report = await service.getReport('org-1');
    expect(report.openPurchaseOrderValue).toBe(500000);
    expect(prisma.purchaseOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ _sum: { total: true } }),
    );
  });

  it('scopes the open-PO query to PENDING/PARTIALLY_RECEIVED only', async () => {
    const { service, prisma } = makeService();
    await service.getReport('org-1');
    expect(prisma.purchaseOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organisationId: 'org-1',
          status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
        }),
      }),
    );
  });

  it('reuses AccountsPayableService.getSummary verbatim — never a second payables calculation', async () => {
    const { service, accountsPayableService } = makeService();
    const report = await service.getReport('org-1');
    expect(accountsPayableService.getSummary).toHaveBeenCalledWith('org-1');
    expect(report.payables).toEqual({ totalOutstanding: 300000, totalOverdue: 50000 });
  });

  it('maps the open-PO row list including the supplier name', async () => {
    const { service } = makeService();
    const report = await service.getReport('org-1');
    expect(report.openPurchaseOrders).toEqual([
      expect.objectContaining({
        purchaseOrderNumber: 'PO-000001',
        supplierName: 'Fresh Farms Ltd',
        total: 100000,
      }),
    ]);
  });

  it('counts supplier invoices with an unresolved DISCREPANCY match status', async () => {
    const { service, prisma } = makeService();
    const report = await service.getReport('org-1');
    expect(report.discrepancyCount).toBe(2);
    expect(prisma.supplierInvoice.count).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', matchStatus: 'DISCREPANCY' },
    });
  });
});
