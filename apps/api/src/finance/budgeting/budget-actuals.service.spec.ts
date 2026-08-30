import { AccountType, BudgetLineType, JournalEntryStatus } from '@prisma/client';

import { BudgetActualsService } from './budget-actuals.service';

const ORG = 'org-1';
const BUDGET_ID = 'budget-1';

function makeService(params: { lines: any[]; accounts: any[]; journalLines: any[] }) {
  const budgetRepository = {
    findById: jest.fn(async () => ({
      id: BUDGET_ID,
      organisationId: ORG,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 11, 31),
    })),
  };
  const budgetLineRepository = {
    findManyByBudget: jest.fn(async () => params.lines),
  };
  const prisma = {
    chartOfAccount: { findMany: jest.fn(async () => params.accounts) },
    journalEntryLine: { findMany: jest.fn(async () => params.journalLines) },
  };

  return new BudgetActualsService(
    prisma as any,
    budgetRepository as any,
    budgetLineRepository as any,
  );
}

function revenueLine(overrides: Partial<any> = {}) {
  return {
    chartOfAccountId: 'account-revenue',
    lineType: BudgetLineType.REVENUE,
    amount: 30_000_000,
    periodMonth: new Date(2026, 0, 1),
    ...overrides,
  };
}

function expenseLine(overrides: Partial<any> = {}) {
  return {
    chartOfAccountId: 'account-expense',
    lineType: BudgetLineType.OPERATING_EXPENSE,
    amount: 5_000_000,
    periodMonth: new Date(2026, 0, 1),
    ...overrides,
  };
}

describe('BudgetActualsService.getVarianceReport — REVENUE (credit-normal)', () => {
  it('actual revenue is credit − debit, and shortfall vs. budget is unfavourable', async () => {
    const service = makeService({
      lines: [revenueLine()],
      accounts: [
        { id: 'account-revenue', code: '4100', name: 'Product Sales', type: AccountType.REVENUE },
      ],
      journalLines: [
        {
          accountId: 'account-revenue',
          debit: 0,
          credit: 28_000_000,
          journalEntry: { date: new Date(2026, 0, 15) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    const row = report.accountVariance[0]!;
    expect(row.budget).toBe(30_000_000);
    expect(row.actual).toBe(28_000_000);
    expect(row.variance).toBe(-2_000_000);
    expect(row.variancePercent).toBeCloseTo(-6.67, 2);
    expect(row.favourable).toBe(false);
  });

  it('actual revenue exceeding budget is favourable', async () => {
    const service = makeService({
      lines: [revenueLine()],
      accounts: [
        { id: 'account-revenue', code: '4100', name: 'Product Sales', type: AccountType.REVENUE },
      ],
      journalLines: [
        {
          accountId: 'account-revenue',
          debit: 0,
          credit: 33_000_000,
          journalEntry: { date: new Date(2026, 0, 15) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    expect(report.accountVariance[0]!.favourable).toBe(true);
  });
});

describe('BudgetActualsService.getVarianceReport — OPERATING_EXPENSE (debit-normal)', () => {
  it('actual expense is debit − credit, and overspending is unfavourable', async () => {
    const service = makeService({
      lines: [expenseLine()],
      accounts: [
        { id: 'account-expense', code: '6100', name: 'Salaries', type: AccountType.EXPENSE },
      ],
      journalLines: [
        {
          accountId: 'account-expense',
          debit: 6_000_000,
          credit: 0,
          journalEntry: { date: new Date(2026, 0, 20) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    const row = report.accountVariance[0]!;
    expect(row.actual).toBe(6_000_000);
    expect(row.variance).toBe(1_000_000);
    expect(row.favourable).toBe(false);
  });

  it('spending under budget is favourable', async () => {
    const service = makeService({
      lines: [expenseLine()],
      accounts: [
        { id: 'account-expense', code: '6100', name: 'Salaries', type: AccountType.EXPENSE },
      ],
      journalLines: [
        {
          accountId: 'account-expense',
          debit: 4_000_000,
          credit: 0,
          journalEntry: { date: new Date(2026, 0, 20) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    expect(report.accountVariance[0]!.favourable).toBe(true);
  });
});

describe('BudgetActualsService.getVarianceReport — zero budget', () => {
  it('variancePercent is null, never NaN/Infinity, when the budget amount is zero', async () => {
    const service = makeService({
      lines: [expenseLine({ amount: 0 })],
      accounts: [
        { id: 'account-expense', code: '6100', name: 'Salaries', type: AccountType.EXPENSE },
      ],
      journalLines: [
        {
          accountId: 'account-expense',
          debit: 500_000,
          credit: 0,
          journalEntry: { date: new Date(2026, 0, 20) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    expect(report.accountVariance[0]!.variancePercent).toBeNull();
  });
});

describe('BudgetActualsService.getVarianceReport — CAPEX without an account', () => {
  it('is excluded from accountVariance and surfaced separately, budget-only', async () => {
    const service = makeService({
      lines: [
        {
          chartOfAccountId: null,
          lineType: BudgetLineType.CAPEX,
          amount: 8_000_000,
          periodMonth: new Date(2026, 5, 1),
          description: 'Packaging Machine',
        },
      ],
      accounts: [],
      journalLines: [],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    expect(report.accountVariance).toHaveLength(0);
    expect(report.capexWithoutAccount).toHaveLength(1);
    expect(report.capexWithoutAccount[0]!.budget).toBe(8_000_000);
    expect(report.totalCapexBudget).toBe(8_000_000);
  });
});

describe('BudgetActualsService.getVarianceReport — monthly bucketing', () => {
  it("only sums journal lines dated within the account's own budgeted month into that month's cell, but the account-level total still sums across all months", async () => {
    const service = makeService({
      lines: [revenueLine({ amount: 10_000_000, periodMonth: new Date(2026, 0, 1) })],
      accounts: [
        { id: 'account-revenue', code: '4100', name: 'Product Sales', type: AccountType.REVENUE },
      ],
      journalLines: [
        {
          accountId: 'account-revenue',
          debit: 0,
          credit: 4_000_000,
          journalEntry: { date: new Date(2026, 0, 5) },
        },
        {
          accountId: 'account-revenue',
          debit: 0,
          credit: 6_000_000,
          journalEntry: { date: new Date(2026, 0, 25) },
        },
      ],
    });

    const report = await service.getVarianceReport(ORG, BUDGET_ID);
    expect(report.accountVariance[0]!.actual).toBe(10_000_000);
  });
});
