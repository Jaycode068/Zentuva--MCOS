import { AccountsPayableService } from '../accounts-payable.service';
import { AccountsReceivableService } from '../accounts-receivable.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import { FinancialStatementService } from './financial-statement.service';
import { InventoryValuationService } from './inventory-valuation.service';

function makeService() {
  const prisma = {
    salesOrder: {
      aggregate: jest.fn().mockResolvedValue({ _count: 5, _sum: { total: 1_000_000 } }),
    },
    productionRun: {
      count: jest.fn().mockResolvedValue(3),
    },
  } as unknown as jest.Mocked<PrismaService>;
  const financialStatementService = {
    getProfitAndLoss: jest.fn().mockResolvedValue({ revenue: 0, netProfit: 0 }),
    getProfitAndLossComparison: jest.fn().mockResolvedValue({
      current: { revenue: 0, netProfit: 0 },
      previous: null,
    }),
  } as unknown as jest.Mocked<FinancialStatementService>;
  const accountsReceivableService = {
    getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 500_000 }),
  } as unknown as jest.Mocked<AccountsReceivableService>;
  const accountsPayableService = {
    getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 300_000 }),
  } as unknown as jest.Mocked<AccountsPayableService>;
  const inventoryValuationService = {
    getValuation: jest
      .fn()
      .mockResolvedValue({
        lines: [],
        totals: { grandTotal: 2_000_000, byLocation: [], byProductType: [] },
      }),
  } as unknown as jest.Mocked<InventoryValuationService>;

  const service = new DashboardService(
    prisma,
    financialStatementService,
    accountsReceivableService,
    accountsPayableService,
    inventoryValuationService,
  );
  return {
    service,
    prisma,
    financialStatementService,
    accountsReceivableService,
    accountsPayableService,
    inventoryValuationService,
  };
}

describe('DashboardService', () => {
  it('composes P&L, AR, AP, and Inventory Valuation without recomputing any of them', async () => {
    const {
      service,
      accountsReceivableService,
      accountsPayableService,
      inventoryValuationService,
    } = makeService();

    const result = await service.getDashboard('org-1', { to: new Date('2026-08-31') });

    expect(result.ar.totalOutstanding).toBe(500_000);
    expect(result.ap.totalOutstanding).toBe(300_000);
    expect(result.inventoryValue).toBe(2_000_000);
    expect(accountsReceivableService.getSummary).toHaveBeenCalledWith('org-1');
    expect(accountsPayableService.getSummary).toHaveBeenCalledWith('org-1');
    expect(inventoryValuationService.getValuation).toHaveBeenCalledWith('org-1');
  });

  it('includes a small operational section (sales orders, completed production runs)', async () => {
    const { service } = makeService();

    const result = await service.getDashboard('org-1', { to: new Date('2026-08-31') });

    expect(result.operational).toEqual({
      salesOrderCount: 5,
      salesOrderTotal: 1_000_000,
      productionOrdersCompleted: 3,
    });
  });

  it('requests a comparison only when compare is true and a from date is given', async () => {
    const { service, financialStatementService } = makeService();
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await service.getDashboard('org-1', { from, to, compare: true });

    expect(financialStatementService.getProfitAndLossComparison).toHaveBeenCalledWith('org-1', {
      from,
      to,
    });
    expect(financialStatementService.getProfitAndLoss).not.toHaveBeenCalled();
  });

  it('skips the comparison call when compare is false, even with a from date', async () => {
    const { service, financialStatementService } = makeService();
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    const result = await service.getDashboard('org-1', { from, to, compare: false });

    expect(financialStatementService.getProfitAndLossComparison).not.toHaveBeenCalled();
    expect(financialStatementService.getProfitAndLoss).toHaveBeenCalledWith('org-1', {
      from,
      to,
      compare: false,
    });
    expect(result.pnl.previous).toBeNull();
  });
});
