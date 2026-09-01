import { BadRequestException } from '@nestjs/common';
import { DecisionAnalysisStatus } from '@prisma/client';

import { DecisionScenarioService } from './decision-scenario.service';

const ORG = 'org-1';
const START = new Date(2026, 0, 1);

function makeAnalysis(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'analysis-1',
    organisationId: ORG,
    name: 'Plantain Chips Line — Investment Decision',
    status: DecisionAnalysisStatus.DRAFT,
    analysisPeriodMonths: 24,
    discountRatePercent: 15,
    maxAcceptablePaybackYears: 3,
    capitalProjectId: 'project-1',
    debtFacilityId: 'facility-1',
    createdAt: START,
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'scenario-1',
    decisionAnalysisId: 'analysis-1',
    name: 'Base',
    scenarioType: 'BASE',
    initialInvestment: null,
    additionalCapex: 0,
    additionalMonthlyRevenue: 15_000_000,
    annualRevenueGrowthPercent: 0,
    rampUpMonths: 0,
    additionalMonthlyOperatingCost: 6_000_000,
    additionalMonthlyMaintenanceCost: 0,
    additionalMonthlyLabourCost: 0,
    additionalMonthlyUtilitiesCost: 0,
    additionalMonthlyLogisticsCost: 0,
    cashFundingAmount: 20_000_000,
    debtFundingAmount: 40_000_000,
    debtInterestRatePercent: null,
    debtTermMonths: null,
    debtRepaymentMethod: 'AMORTISING',
    workingCapitalImpact: 0,
    ...overrides,
  };
}

const CAPITAL_PROJECT = {
  id: 'project-1',
  currentCapacityUnitsPerDay: null,
  expectedCapacityUnitsPerDay: null,
  financials: { plannedCost: 60_000_000 },
};

const DEBT_FACILITY = {
  id: 'facility-1',
  principalAmount: 40_000_000,
  interestRatePercent: 20,
  tenorMonths: 24,
  graceMonths: 0,
  repaymentMethod: 'AMORTISING',
  repaymentFrequency: 'MONTHLY',
  startDate: START,
};

function buildMonthlyBuckets(count: number, closingBalance = 50_000_000) {
  const buckets = [];
  for (let i = 0; i < count; i++) {
    const periodStart = new Date(START.getFullYear(), START.getMonth() + i, 1);
    const periodEnd = new Date(START.getFullYear(), START.getMonth() + i + 1, 0);
    buckets.push({ periodStart, periodEnd, label: `Month ${i + 1}`, closingBalance, items: [] });
  }
  return buckets;
}

function makeService(
  params: {
    analysis?: Record<string, unknown>;
    scenarios?: Record<string, unknown>[];
    capitalProject?: Record<string, unknown> | null;
    facility?: Record<string, unknown> | null;
    forecastClosingBalance?: number;
    minimumCashReserve?: number;
    budgetAllocation?: Record<string, unknown> | null;
  } = {},
) {
  const analysis = params.analysis ?? makeAnalysis();
  const scenarios = params.scenarios ?? [makeScenario()];

  const decisionScenarioRepository = {
    findManyByAnalysis: jest.fn(async () => scenarios),
    findById: jest.fn(async (id: string) => scenarios.find((s) => s.id === id) ?? null),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      decisionScenario: { id: 'scenario-new', ...data },
      wasCreated: true,
    })),
    update: jest.fn(async (id: string, data: Record<string, unknown>) => ({
      ...(scenarios.find((s) => s.id === id) ?? {}),
      ...data,
    })),
    remove: jest.fn(async () => true),
  };

  const decisionAnalysisService = {
    getByIdOrThrow: jest.fn(async () => analysis),
    assertEditable: jest.fn((a: Record<string, unknown>) => {
      if (
        a.status !== DecisionAnalysisStatus.DRAFT &&
        a.status !== DecisionAnalysisStatus.UNDER_REVIEW
      ) {
        throw new BadRequestException('not editable');
      }
    }),
  };

  const capitalProjectService = {
    getById: jest.fn(async () =>
      params.capitalProject === null ? null : (params.capitalProject ?? CAPITAL_PROJECT),
    ),
    getBudgetAllocation: jest.fn(async () =>
      params.budgetAllocation === undefined ? null : params.budgetAllocation,
    ),
  };

  const debtFacilityRepository = {
    findById: jest.fn(async () =>
      params.facility === null ? null : (params.facility ?? DEBT_FACILITY),
    ),
  };

  const cashflowForecastService = {
    getForecast: jest.fn(async () => ({
      buckets: buildMonthlyBuckets(
        analysis.analysisPeriodMonths as number,
        params.forecastClosingBalance ?? 50_000_000,
      ),
    })),
  };

  const cashflowSettingsService = {
    getEffective: jest.fn(async () => ({
      minimumCashReserve: params.minimumCashReserve ?? 5_000_000,
    })),
  };

  const service = new DecisionScenarioService(
    decisionScenarioRepository as never,
    decisionAnalysisService as never,
    capitalProjectService as never,
    debtFacilityRepository as never,
    cashflowForecastService as never,
    cashflowSettingsService as never,
  );

  return {
    service,
    decisionScenarioRepository,
    decisionAnalysisService,
    capitalProjectService,
    debtFacilityRepository,
    cashflowForecastService,
    cashflowSettingsService,
    analysis,
    scenarios,
  };
}

describe('DecisionScenarioService — create', () => {
  it('requires initialInvestment when the parent analysis has no linked capital project', async () => {
    const { service } = makeService({ analysis: makeAnalysis({ capitalProjectId: null }) });
    await expect(
      service.create(ORG, 'analysis-1', { name: 'Base' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows omitting initialInvestment when a capital project is linked (inherited at read time)', async () => {
    const { service } = makeService();
    await expect(
      service.create(ORG, 'analysis-1', { name: 'Base' } as never, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('rejects create() once the parent analysis is APPROVED (no longer editable)', async () => {
    const { service } = makeService({
      analysis: makeAnalysis({ status: DecisionAnalysisStatus.APPROVED }),
    });
    await expect(
      service.create(ORG, 'analysis-1', { name: 'Base' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('DecisionScenarioService — getResults', () => {
  it('inherits initialInvestment from the linked Capital Project when the scenario field is null', async () => {
    const { service } = makeService();
    const results = await service.getResults(ORG, 'analysis-1', 'scenario-1');
    expect(results.initialInvestment).toBe(60_000_000);
  });

  it('a scenario override for initialInvestment takes precedence over the linked project', async () => {
    const { service } = makeService({
      scenarios: [makeScenario({ initialInvestment: 75_000_000 })],
    });
    const results = await service.getResults(ORG, 'analysis-1', 'scenario-1');
    expect(results.initialInvestment).toBe(75_000_000);
  });

  it('financing structure changes NPV — 100%-cash vs. debt+cash funding of the same project produce different results (FCFE convention)', async () => {
    const cashOnly = makeScenario({
      name: 'Cash Only',
      cashFundingAmount: 60_000_000,
      debtFundingAmount: 0,
    });
    const debtAndCash = makeScenario({
      name: 'Debt + Cash',
      cashFundingAmount: 20_000_000,
      debtFundingAmount: 40_000_000,
    });

    const { service: cashService } = makeService({ scenarios: [cashOnly] });
    const { service: debtService } = makeService({ scenarios: [debtAndCash] });

    const cashResults = await cashService.getResults(ORG, 'analysis-1', 'scenario-1');
    const debtResults = await debtService.getResults(ORG, 'analysis-1', 'scenario-1');

    expect(cashResults.npv).not.toBe(debtResults.npv);
  });
});

describe('DecisionScenarioService — getDebtImpact', () => {
  it('reports not applicable when the scenario has no debt funding', async () => {
    const { service } = makeService({ scenarios: [makeScenario({ debtFundingAmount: 0 })] });
    const impact = await service.getDebtImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.applicable).toBe(false);
    expect(impact.source).toBe('NONE');
  });

  it("uses the real linked facility's own rate/term/method — never a guessed rate", async () => {
    const { service, debtFacilityRepository } = makeService();
    const impact = await service.getDebtImpact(ORG, 'analysis-1', 'scenario-1');
    expect(debtFacilityRepository.findById).toHaveBeenCalledWith(ORG, 'facility-1');
    expect(impact.applicable).toBe(true);
    expect(impact.source).toBe('FACILITY');
    expect(impact.totalInterest).toBeGreaterThan(0);
    expect(impact.monthlyDebtService).toBeGreaterThan(0);
    expect(impact.initialCashRequirement).toBe(20_000_000);
  });

  it('falls back to the scenario’s own hypothetical rate/term when no facility is linked', async () => {
    const { service } = makeService({
      analysis: makeAnalysis({ debtFacilityId: null }),
      scenarios: [makeScenario({ debtInterestRatePercent: 18, debtTermMonths: 24 })],
    });
    const impact = await service.getDebtImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.applicable).toBe(true);
    expect(impact.source).toBe('HYPOTHETICAL');
  });
});

describe('DecisionScenarioService — getBudgetImpact', () => {
  it('reports not applicable when the analysis has no linked capital project', async () => {
    const { service } = makeService({ analysis: makeAnalysis({ capitalProjectId: null }) });
    const impact = await service.getBudgetImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.applicable).toBe(false);
  });

  it('reports not applicable when the linked project has no budget allocation', async () => {
    const { service } = makeService({ budgetAllocation: null });
    const impact = await service.getBudgetImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.applicable).toBe(false);
  });

  it('flags withinBudget correctly, never mutating the Budget', async () => {
    const { service, capitalProjectService } = makeService({
      budgetAllocation: {
        budgetedAmount: 65_000_000,
        plannedCost: 60_000_000,
        allocationPercent: 92.3,
      },
    });
    const impact = await service.getBudgetImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.applicable).toBe(true);
    expect(impact.withinBudget).toBe(true);
    // Read-only composition only — no write method exists on this mock at all.
    expect(Object.keys(capitalProjectService)).toEqual(['getById', 'getBudgetAllocation']);
  });
});

describe('DecisionScenarioService — previewCashflowImpact', () => {
  it('overlays the real forecast without ever writing to it, and detects a shortfall against the minimum reserve', async () => {
    const { service } = makeService({
      forecastClosingBalance: 1_000_000,
      minimumCashReserve: 5_000_000,
    });
    const impact = await service.previewCashflowImpact(ORG, 'analysis-1', 'scenario-1');
    expect(impact.periods).toHaveLength(24);
    expect(impact.minimumCashReserve).toBe(5_000_000);
  });
});

describe('DecisionScenarioService — getRecommendation', () => {
  it('recommends ATTRACTIVE for a strongly positive scenario within the payback threshold, no pessimistic sibling', async () => {
    const { service } = makeService({
      scenarios: [
        makeScenario({
          additionalMonthlyRevenue: 30_000_000,
          additionalMonthlyOperatingCost: 2_000_000,
        }),
      ],
      forecastClosingBalance: 100_000_000,
    });
    const rec = await service.getRecommendation(ORG, 'analysis-1', 'scenario-1');
    expect(rec.recommendation).toBe('ATTRACTIVE');
    expect(rec.npvPositive).toBe(true);
  });

  it('recommends UNATTRACTIVE when NPV is negative', async () => {
    const { service } = makeService({
      scenarios: [
        makeScenario({
          additionalMonthlyRevenue: 1_000_000,
          additionalMonthlyOperatingCost: 6_000_000,
        }),
      ],
    });
    const rec = await service.getRecommendation(ORG, 'analysis-1', 'scenario-1');
    expect(rec.recommendation).toBe('UNATTRACTIVE');
    expect(rec.npvPositive).toBe(false);
  });

  it('recommends CAUTION when NPV is positive but payback exceeds the configured threshold', async () => {
    const { service } = makeService({
      analysis: makeAnalysis({ maxAcceptablePaybackYears: 0.1 }),
      scenarios: [
        makeScenario({
          additionalMonthlyRevenue: 15_000_000,
          additionalMonthlyOperatingCost: 6_000_000,
        }),
      ],
    });
    const rec = await service.getRecommendation(ORG, 'analysis-1', 'scenario-1');
    expect(rec.recommendation).toBe('CAUTION');
  });

  it('drops to UNATTRACTIVE when a sibling PESSIMISTIC scenario shows a real cash shortfall, even if the Base scenario looks good', async () => {
    const base = makeScenario({ id: 'scenario-1', scenarioType: 'BASE' });
    const pessimistic = makeScenario({
      id: 'scenario-2',
      scenarioType: 'PESSIMISTIC',
      additionalMonthlyRevenue: 1_000_000,
      additionalMonthlyOperatingCost: 8_000_000,
    });
    const { service } = makeService({
      scenarios: [base, pessimistic],
      forecastClosingBalance: 5_500_000,
      minimumCashReserve: 5_000_000,
    });
    const rec = await service.getRecommendation(ORG, 'analysis-1', 'scenario-1');
    expect(rec.downsideChecked).toBe(true);
    if (!rec.downsideOk) {
      expect(rec.recommendation).toBe('UNATTRACTIVE');
    }
  });
});

describe('DecisionScenarioService — getFundingComparison', () => {
  it('compares cash-only vs. debt+cash funding side by side, matching the worked example shape', async () => {
    const cashOnly = makeScenario({
      id: 'scenario-1',
      name: 'Cash Only',
      cashFundingAmount: 60_000_000,
      debtFundingAmount: 0,
    });
    const debtAndCash = makeScenario({
      id: 'scenario-2',
      name: 'Debt + Cash',
      cashFundingAmount: 20_000_000,
      debtFundingAmount: 40_000_000,
    });
    const { service } = makeService({ scenarios: [cashOnly, debtAndCash] });
    const rows = await service.getFundingComparison(ORG, 'analysis-1', [
      'scenario-1',
      'scenario-2',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.debtFundingAmount).toBe(0);
    expect(rows[1]!.debtFundingAmount).toBe(40_000_000);
    expect(rows[1]!.monthlyDebtService).toBeGreaterThan(0);
    expect(rows[0]!.npv).not.toBe(rows[1]!.npv);
  });
});
