import { BudgetLineType } from '@prisma/client';

import { BudgetForecastService } from './budget-forecast.service';

const ORG = 'org-1';
const BUDGET_ID = 'budget-1';

function makeService(params: {
  endDate: Date;
  cashflowScenarioId?: string | null;
  lines?: any[];
  forecastBuckets?: any[];
}) {
  const budgetRepository = {
    findById: jest.fn(async () => ({
      id: BUDGET_ID,
      organisationId: ORG,
      startDate: new Date(2026, 0, 1),
      endDate: params.endDate,
      cashflowScenarioId: params.cashflowScenarioId ?? null,
    })),
  };
  const budgetLineRepository = {
    findManyByBudget: jest.fn(async () => params.lines ?? []),
  };
  const cashflowForecastService = {
    getForecast: jest.fn(async () => ({ buckets: params.forecastBuckets ?? [] })),
  };

  return {
    service: new BudgetForecastService(
      budgetRepository as any,
      budgetLineRepository as any,
      cashflowForecastService as any,
    ),
    cashflowForecastService,
  };
}

describe('BudgetForecastService.getBudgetVsForecast', () => {
  it("reports not applicable once the budget's own fiscal year has already ended", async () => {
    const { service } = makeService({ endDate: new Date(2020, 0, 1) });
    const result = await service.getBudgetVsForecast(ORG, BUDGET_ID);
    expect(result.applicable).toBe(false);
    expect(result.periods).toHaveLength(0);
  });

  it("passes the budget's own cashflowScenarioId straight through to CashflowForecastService", async () => {
    const { service, cashflowForecastService } = makeService({
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      cashflowScenarioId: 'scenario-growth',
    });
    await service.getBudgetVsForecast(ORG, BUDGET_ID);
    expect(cashflowForecastService.getForecast).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ scenarioId: 'scenario-growth', bucketBy: 'monthly' }),
    );
  });

  it('sums OPERATING_EXPENSE and CAPEX lines within a period into budgetedExpenditure, but never REVENUE', async () => {
    const periodStart = new Date(2026, 5, 1);
    const periodEnd = new Date(2026, 5, 30);
    const { service } = makeService({
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      lines: [
        {
          lineType: BudgetLineType.OPERATING_EXPENSE,
          amount: 4_000_000,
          periodMonth: new Date(2026, 5, 1),
        },
        { lineType: BudgetLineType.CAPEX, amount: 20_000_000, periodMonth: new Date(2026, 5, 1) },
        { lineType: BudgetLineType.REVENUE, amount: 30_000_000, periodMonth: new Date(2026, 5, 1) },
      ],
      forecastBuckets: [
        {
          periodStart,
          periodEnd,
          label: 'June 2026',
          openingBalance: 15_000_000,
          outflows: 29_000_000,
          inflows: 0,
          closingBalance: -14_000_000,
        },
      ],
    });

    const result = await service.getBudgetVsForecast(ORG, BUDGET_ID);
    expect(result.applicable).toBe(true);
    expect(result.periods[0]!.budgetedExpenditure).toBe(24_000_000);
    expect(result.periods[0]!.forecastExpenditure).toBe(29_000_000);
    expect(result.periods[0]!.availableCash).toBe(15_000_000);
  });

  it("flags a potential shortfall when budgeted expenditure exceeds the period's opening cash, and zero otherwise", async () => {
    const period = {
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 30),
      label: 'June 2026',
    };
    const { service } = makeService({
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      lines: [
        {
          lineType: BudgetLineType.OPERATING_EXPENSE,
          amount: 25_000_000,
          periodMonth: new Date(2026, 5, 1),
        },
      ],
      forecastBuckets: [
        {
          ...period,
          openingBalance: 18_000_000,
          outflows: 29_000_000,
          inflows: 0,
          closingBalance: -11_000_000,
        },
      ],
    });

    const result = await service.getBudgetVsForecast(ORG, BUDGET_ID);
    expect(result.periods[0]!.potentialShortfall).toBe(7_000_000);
  });

  it('reports zero shortfall when available cash covers the budgeted expenditure', async () => {
    const period = {
      periodStart: new Date(2026, 5, 1),
      periodEnd: new Date(2026, 5, 30),
      label: 'June 2026',
    };
    const { service } = makeService({
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      lines: [
        {
          lineType: BudgetLineType.OPERATING_EXPENSE,
          amount: 5_000_000,
          periodMonth: new Date(2026, 5, 1),
        },
      ],
      forecastBuckets: [
        {
          ...period,
          openingBalance: 18_000_000,
          outflows: 5_000_000,
          inflows: 0,
          closingBalance: 13_000_000,
        },
      ],
    });

    const result = await service.getBudgetVsForecast(ORG, BUDGET_ID);
    expect(result.periods[0]!.potentialShortfall).toBe(0);
  });
});
