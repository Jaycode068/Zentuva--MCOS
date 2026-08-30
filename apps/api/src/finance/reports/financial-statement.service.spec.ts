import { AccountType } from '@prisma/client';

import { ChartOfAccountRepository } from '../accounting/chart-of-account.repository';
import { getAccountBalances } from '../accounting/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialStatementService } from './financial-statement.service';

/**
 * `getAccountBalances` (the shared Prisma-touching query, already exercised by
 * `ledger.service.spec.ts`'s own Trial Balance tests) is mocked here so these tests
 * focus on what `FinancialStatementService` actually adds: normal-balance-sign
 * adjustment per `AccountType`, section rollup, gross margin, and the computed
 * Retained Earnings composition — the real, hand-written logic worth verifying in
 * isolation, per this codebase's own "deliberate exception" testing convention.
 */
jest.mock('../accounting/ledger.service', () => {
  const actual = jest.requireActual('../accounting/ledger.service');
  return { ...actual, getAccountBalances: jest.fn() };
});
const mockGetAccountBalances = getAccountBalances as jest.MockedFunction<typeof getAccountBalances>;

type Row = Awaited<ReturnType<typeof getAccountBalances>>[number];

function row(overrides: Partial<Row> & Pick<Row, 'type' | 'netBalance'>): Row {
  return {
    accountId: `account-${Math.random()}`,
    code: '0000',
    name: 'Test Account',
    systemKey: null,
    debit: overrides.netBalance >= 0 ? overrides.netBalance : 0,
    credit: overrides.netBalance < 0 ? -overrides.netBalance : 0,
    ...overrides,
  };
}

function makeFakePrisma(journalEntryCount = 0) {
  return {
    journalEntry: { count: jest.fn(async () => journalEntryCount) },
  } as unknown as PrismaService;
}

function makeService(journalEntryCount = 0) {
  return new FinancialStatementService(
    makeFakePrisma(journalEntryCount),
    {} as ChartOfAccountRepository,
  );
}

describe('FinancialStatementService', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getProfitAndLoss', () => {
    it('nets Sales Revenue against Sales Returns automatically (both type REVENUE) with no contra flag', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -1_000_000, code: '4100', name: 'Sales' }), // credit balance
        row({ type: AccountType.REVENUE, netBalance: 50_000, code: '4200', name: 'Returns' }), // debit balance (contra)
        row({ type: AccountType.COST_OF_SALES, netBalance: 400_000, code: '5100', name: 'COGS' }),
      ]);
      const service = makeService();

      const result = await service.getProfitAndLoss('org-1', { to: new Date('2026-08-31') });

      expect(result.revenue).toBe(950_000); // 1,000,000 - 50,000
      expect(result.costOfSales).toBe(400_000);
      expect(result.grossProfit).toBe(550_000);
    });

    it('computes gross margin correctly', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -1_000_000 }),
        row({ type: AccountType.COST_OF_SALES, netBalance: 600_000 }),
      ]);
      const service = makeService();

      const result = await service.getProfitAndLoss('org-1', { to: new Date() });

      expect(result.grossProfit).toBe(400_000);
      expect(result.grossMarginPercent).toBe(40);
    });

    it('returns null gross margin (never NaN/Infinity) when revenue is zero', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.EXPENSE, netBalance: 50_000 }),
      ]);
      const service = makeService();

      const result = await service.getProfitAndLoss('org-1', { to: new Date() });

      expect(result.revenue).toBe(0);
      expect(result.grossMarginPercent).toBeNull();
      expect(Number.isNaN(result.grossMarginPercent)).toBe(false);
    });

    it('subtracts Operating Expenses (EXPENSE type) to reach Net Profit', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -1_000_000 }),
        row({ type: AccountType.COST_OF_SALES, netBalance: 400_000 }),
        row({ type: AccountType.EXPENSE, netBalance: 100_000, code: '6100', name: 'Salaries' }),
        row({ type: AccountType.EXPENSE, netBalance: 50_000, code: '6200', name: 'Utilities' }),
      ]);
      const service = makeService();

      const result = await service.getProfitAndLoss('org-1', { to: new Date() });

      expect(result.grossProfit).toBe(600_000);
      expect(result.operatingExpenses).toBe(150_000);
      expect(result.netProfit).toBe(450_000);
    });

    it('ignores ASSET/LIABILITY/EQUITY accounts entirely', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -500_000 }),
        row({ type: AccountType.ASSET, netBalance: 1_000_000 }),
        row({ type: AccountType.LIABILITY, netBalance: -300_000 }),
        row({ type: AccountType.EQUITY, netBalance: -200_000 }),
      ]);
      const service = makeService();

      const result = await service.getProfitAndLoss('org-1', { to: new Date() });

      expect(result.revenue).toBe(500_000);
      expect(result.netProfit).toBe(500_000);
    });

    it('passes from/to/accountingPeriodId through to the shared query unmodified', async () => {
      mockGetAccountBalances.mockResolvedValue([]);
      const service = makeService();
      const from = new Date('2026-08-01');
      const to = new Date('2026-08-31');

      await service.getProfitAndLoss('org-1', { from, to, accountingPeriodId: 'period-1' });

      expect(mockGetAccountBalances).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'org-1',
        {
          from,
          to,
          accountingPeriodId: 'period-1',
        },
      );
    });
  });

  describe('getProfitAndLossComparison', () => {
    it('returns previous: null when the prior period has zero posted journal-entry activity', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -100 }),
      ]);
      const service = makeService(0);

      const result = await service.getProfitAndLossComparison('org-1', {
        from: new Date('2026-08-01'),
        to: new Date('2026-08-31'),
      });

      expect(result.previous).toBeNull();
      expect(result.current.revenue).toBe(100);
    });

    it('computes the previous period when activity exists there', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.REVENUE, netBalance: -100 }),
      ]);
      const service = makeService(1);

      const result = await service.getProfitAndLossComparison('org-1', {
        from: new Date('2026-08-01'),
        to: new Date('2026-08-31'),
      });

      expect(result.previous).not.toBeNull();
      expect(result.previous!.revenue).toBe(100);
      expect(mockGetAccountBalances).toHaveBeenCalledTimes(2);
    });
  });

  describe('getBalanceSheet', () => {
    it('holds the accounting equation exactly: Assets = Liabilities + Equity', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.ASSET, netBalance: 2_000_000, code: '1100', name: 'Cash' }),
        row({ type: AccountType.LIABILITY, netBalance: -500_000, code: '2100', name: 'AP' }),
        row({
          type: AccountType.EQUITY,
          netBalance: -300_000,
          code: '3100',
          name: "Owner's Capital",
        }),
        row({ type: AccountType.REVENUE, netBalance: -1_500_000 }),
        row({ type: AccountType.COST_OF_SALES, netBalance: 300_000 }),
      ]);
      const service = makeService();

      const result = await service.getBalanceSheet('org-1', { asOf: new Date() });

      expect(result.assets).toBe(2_000_000);
      expect(result.liabilities).toBe(500_000);
      expect(result.recordedEquity).toBe(300_000);
      // retainedEarnings = all-time net profit = revenue(1,500,000) - COGS(300,000) - expenses(0)
      expect(result.retainedEarnings).toBe(1_200_000);
      expect(result.totalEquity).toBe(1_500_000);
      expect(result.difference).toBe(0);
      expect(result.balanced).toBe(true);
    });

    it('computes retained earnings as all-time net profit with no prior-period data required', async () => {
      mockGetAccountBalances.mockResolvedValue([
        row({ type: AccountType.ASSET, netBalance: 100_000 }),
        row({ type: AccountType.REVENUE, netBalance: -100_000 }),
      ]);
      const service = makeService();

      const result = await service.getBalanceSheet('org-1', { asOf: new Date() });

      expect(result.retainedEarnings).toBe(100_000);
      expect(result.balanced).toBe(true);
    });

    it('queries cumulative balances since inception (no "from" bound) for the Balance Sheet', async () => {
      mockGetAccountBalances.mockResolvedValue([]);
      const service = makeService();
      const asOf = new Date('2026-08-31');

      await service.getBalanceSheet('org-1', { asOf });

      // The Balance Sheet's own direct row fetch (its first call — the retained-
      // earnings delegation to `getProfitAndLoss` below makes a second call with its
      // own, differently-shaped params object).
      const [, , , params] = mockGetAccountBalances.mock.calls[0]!;
      expect(params).toEqual({ to: asOf });
    });
  });
});
