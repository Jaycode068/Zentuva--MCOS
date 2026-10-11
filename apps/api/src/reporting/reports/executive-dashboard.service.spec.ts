import { ExecutiveDashboardService } from './executive-dashboard.service';

function makeDeps(grantedKeys: string[], isOwnerBypass = false) {
  const effectiveAccessResolver = {
    resolve: jest.fn().mockResolvedValue({
      isOwnerBypass,
      grants: new Map(grantedKeys.map((key) => [key, {} as never])),
    }),
  };
  const financialStatementService = {
    getProfitAndLoss: jest.fn().mockResolvedValue({
      revenue: 1000,
      grossProfit: 400,
      grossMarginPercent: 40,
    }),
  };
  const accountsReceivableService = {
    getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 500, totalOverdue: 100 }),
  };
  const accountsPayableService = {
    getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 300, totalOverdue: 50 }),
  };
  const inventoryValuationService = {
    getValuation: jest.fn().mockResolvedValue({ totals: { grandTotal: 2000 } }),
  };
  const salesPerformanceReportService = {
    getDailyTrend: jest.fn().mockResolvedValue([{ date: new Date(), totalRevenue: 1000 }]),
  };
  const productionPerformanceReportService = {
    getDailyTrend: jest.fn().mockResolvedValue([{ date: new Date(), acceptedQuantity: 50 }]),
  };
  const employeeService = {
    getHeadcountByStatus: jest.fn().mockResolvedValue([{ employmentStatus: 'ACTIVE', count: 10 }]),
  };
  const operationalExceptionsReportService = {
    getPendingApprovals: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]),
    getOverdueMaintenanceCount: jest.fn().mockResolvedValue(3),
    getFailedNotificationCounts: jest.fn().mockResolvedValue({ email: 1, whatsapp: 2 }),
  };
  const auditService = {
    listByOrganisation: jest
      .fn()
      .mockResolvedValue([
        {
          id: 'log1',
          action: 'sales.order.created',
          entityType: 'SalesOrder',
          entityId: 'so-1',
          createdAt: new Date(),
        },
      ]),
  };
  const prisma = {
    salesOrder: { count: jest.fn().mockResolvedValue(7) },
    productionRun: { aggregate: jest.fn().mockResolvedValue({ _sum: { acceptedQuantity: 40 } }) },
  };

  const service = new ExecutiveDashboardService(
    prisma as never,
    effectiveAccessResolver as never,
    financialStatementService as never,
    accountsReceivableService as never,
    accountsPayableService as never,
    inventoryValuationService as never,
    salesPerformanceReportService as never,
    productionPerformanceReportService as never,
    employeeService as never,
    operationalExceptionsReportService as never,
    auditService as never,
  );

  return {
    service,
    financialStatementService,
    operationalExceptionsReportService,
    prisma,
  };
}

const PERIOD = { from: new Date('2026-01-01'), to: new Date('2026-02-01'), timeZone: 'UTC' };

describe('ExecutiveDashboardService', () => {
  it('a user with every relevant permission (or Owner bypass) sees every section populated', async () => {
    const { service } = makeDeps([], true);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);

    expect(result.finance).not.toBeNull();
    expect(result.inventory).not.toBeNull();
    expect(result.sales).not.toBeNull();
    expect(result.production).not.toBeNull();
    expect(result.workforce).not.toBeNull();
    expect(result.exceptions.pendingApprovalsCount).toBe(2);
    expect(result.exceptions.overdueMaintenanceCount).toBe(3);
    expect(result.exceptions.failedNotificationsCount).toBe(3);
    expect(result.recentActivity).not.toBeNull();
  });

  it('a user with NO permissions sees every section omitted as null, never a fabricated zero', async () => {
    const { service } = makeDeps([]);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);

    expect(result.finance).toBeNull();
    expect(result.inventory).toBeNull();
    expect(result.sales).toBeNull();
    expect(result.production).toBeNull();
    expect(result.workforce).toBeNull();
    expect(result.exceptions.pendingApprovalsCount).toBeNull();
    expect(result.exceptions.overdueMaintenanceCount).toBeNull();
    expect(result.exceptions.failedNotificationsCount).toBeNull();
    expect(result.recentActivity).toBeNull();
  });

  it('a user with only finance.reports.view sees finance and inventory populated, everything else null', async () => {
    const { service, operationalExceptionsReportService } = makeDeps(['finance.reports.view']);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);

    expect(result.finance).not.toBeNull();
    expect(result.inventory).not.toBeNull();
    expect(result.sales).toBeNull();
    expect(result.production).toBeNull();
    expect(result.workforce).toBeNull();
    // Confirms the sales/production/workforce services were never even called —
    // not just that their result was discarded.
    expect(operationalExceptionsReportService.getPendingApprovals).not.toHaveBeenCalled();
  });

  it('failedNotificationsCount requires BOTH notification.email.view AND notification.whatsapp.view — one alone is not enough', async () => {
    const { service } = makeDeps(['notification.email.view']);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);
    expect(result.exceptions.failedNotificationsCount).toBeNull();
  });

  it('netRevenue percentChange is null when no comparison period was supplied', async () => {
    const { service } = makeDeps([], true);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);
    expect(result.finance!.netRevenue.percentChange).toBeNull();
  });

  it('netRevenue percentChange is computed from two real getProfitAndLoss calls when a comparison period is supplied', async () => {
    const { service, financialStatementService } = makeDeps([], true);
    financialStatementService.getProfitAndLoss
      .mockResolvedValueOnce({ revenue: 1500, grossProfit: 600, grossMarginPercent: 40 })
      .mockResolvedValueOnce({ revenue: 1000, grossProfit: 400, grossMarginPercent: 40 });

    const result = await service.getDashboard('org-1', 'user-1', {
      ...PERIOD,
      comparisonFrom: new Date('2025-12-01'),
      comparisonTo: new Date('2026-01-01'),
    });

    expect(financialStatementService.getProfitAndLoss).toHaveBeenCalledTimes(2);
    expect(result.finance!.netRevenue.value).toBe(1500);
    expect(result.finance!.netRevenue.percentChange).toBe(50);
  });

  it('comparisonFrom/comparisonTo in the result are null when no comparison was requested', async () => {
    const { service } = makeDeps([], true);
    const result = await service.getDashboard('org-1', 'user-1', PERIOD);
    expect(result.comparisonFrom).toBeNull();
    expect(result.comparisonTo).toBeNull();
  });
});
