import {
  DecisionScenarioAssumptions,
  aggregateDebtServiceByYear,
  averageMonthlyDebtService,
  buildCashflowSeries,
  computeBreakEven,
  computeIRR,
  computeNPV,
  computePaybackPeriod,
  computeROI,
  runSensitivity,
} from './decision-calculations';
import { generateSchedule } from '../debt/repayment-schedule';

const BASE_ASSUMPTIONS: DecisionScenarioAssumptions = {
  initialInvestment: 60_000_000,
  additionalCapex: 0,
  additionalMonthlyRevenue: 15_000_000,
  annualRevenueGrowthPercent: 0,
  rampUpMonths: 0,
  additionalMonthlyOperatingCost: 6_000_000,
  additionalMonthlyMaintenanceCost: 0,
  additionalMonthlyLabourCost: 0,
  additionalMonthlyUtilitiesCost: 0,
  additionalMonthlyLogisticsCost: 0,
  cashFundingAmount: 60_000_000,
  debtFundingAmount: 0,
  workingCapitalImpact: 0,
};

describe('buildCashflowSeries', () => {
  it('Year 0 is the full investment when 100% cash-funded, subsequent years are net monthly cashflow × 12', () => {
    const { series } = buildCashflowSeries(BASE_ASSUMPTIONS, 24, [], new Date(2026, 0, 1));
    expect(series[0]).toBe(-60_000_000);
    // (15,000,000 - 6,000,000) * 12 = 108,000,000 per year
    expect(series[1]).toBe(108_000_000);
    expect(series[2]).toBe(108_000_000);
    expect(series).toHaveLength(3);
  });

  it('Year 0 nets off debtFundingAmount — the cash the business must actually find', () => {
    const assumptions = {
      ...BASE_ASSUMPTIONS,
      debtFundingAmount: 40_000_000,
      cashFundingAmount: 20_000_000,
    };
    const { series } = buildCashflowSeries(assumptions, 12, [], new Date(2026, 0, 1));
    expect(series[0]).toBe(-20_000_000);
  });

  it('debt service is subtracted from the years it falls due, via the existing generateSchedule()', () => {
    const schedule = generateSchedule({
      principalAmount: 40_000_000,
      interestRatePercent: 20,
      tenorMonths: 24,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: new Date(2026, 0, 1),
    });
    const assumptions = {
      ...BASE_ASSUMPTIONS,
      debtFundingAmount: 40_000_000,
      cashFundingAmount: 20_000_000,
    };
    const { series, debtServiceByYear } = buildCashflowSeries(
      assumptions,
      24,
      schedule,
      new Date(2026, 0, 1),
    );
    const totalScheduleDue = schedule.reduce((sum, row) => sum + row.totalDue, 0);
    expect(Math.round(debtServiceByYear[1]! + debtServiceByYear[2]!)).toBe(
      Math.round(totalScheduleDue),
    );
    // Year 1 net cashflow = operating (108,000,000) - Year 1 debt service
    expect(Math.round(series[1]!)).toBe(Math.round(108_000_000 - debtServiceByYear[1]!));
  });

  it('ramp-up phases revenue in linearly over rampUpMonths, growth compounds annually', () => {
    const assumptions = { ...BASE_ASSUMPTIONS, rampUpMonths: 6, annualRevenueGrowthPercent: 10 };
    const { series } = buildCashflowSeries(assumptions, 24, [], new Date(2026, 0, 1));
    // Year 1 revenue is less than full run-rate because of the 6-month ramp.
    const fullYearNoRamp = (15_000_000 - 6_000_000) * 12;
    expect(series[1]!).toBeLessThan(fullYearNoRamp);
    // Year 2 (fully ramped, +10% growth applied) exceeds Year 1.
    expect(series[2]!).toBeGreaterThan(series[1]!);
  });
});

describe('computeNPV', () => {
  it('matches a hand-computed two-year discounted series', () => {
    const npv = computeNPV([-100, 60, 60], 10);
    // -100 + 60/1.1 + 60/1.21 = -100 + 54.545 + 49.587 = 4.132
    expect(npv).toBeCloseTo(4.13, 1);
  });

  it('a zero discount rate reduces to the plain undiscounted sum', () => {
    const npv = computeNPV([-100, 40, 40, 40], 0);
    expect(npv).toBe(20);
  });
});

describe('computeIRR', () => {
  it('finds the single root of a normal investment cashflow', () => {
    // -100, 60, 60 has IRR ~13.07%
    const irr = computeIRR([-100, 60, 60]);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(13.07, 0);
  });

  it('returns null when the series never crosses zero (all-negative)', () => {
    expect(computeIRR([-100, -50, -20])).toBeNull();
  });

  it('returns null when the series never crosses zero (all-positive, no investment)', () => {
    expect(computeIRR([10, 20, 30])).toBeNull();
  });

  it('returns null on a multiple-sign-change series rather than guessing a root', () => {
    // The classic textbook double-IRR example (roots at 25% and 400%).
    const irr = computeIRR([-4000, 25000, -25000]);
    expect(irr).toBeNull();
  });
});

describe('computeROI', () => {
  it('(netBenefit / initialInvestment) × 100, netBenefit = sum of the whole series', () => {
    const { roi, netBenefit } = computeROI([-100, 60, 60], 100);
    expect(netBenefit).toBe(20);
    expect(roi).toBe(20);
  });

  it('returns null (not a divide-by-zero) when initialInvestment is zero', () => {
    const { roi } = computeROI([0, 10], 0);
    expect(roi).toBeNull();
  });
});

describe('computePaybackPeriod', () => {
  it('recovers exactly at a year boundary', () => {
    const result = computePaybackPeriod([-100, 50, 50, 50]);
    expect(result.status).toBe('RECOVERED');
    expect(result.years).toBe(2);
  });

  it('interpolates a fractional payback year', () => {
    // -100, +40 (cum -60), +80 (cum +20) — crosses between year 1 and 2.
    const result = computePaybackPeriod([-100, 40, 80]);
    expect(result.status).toBe('RECOVERED');
    // fraction = 60/80 = 0.75 -> payback = 1.75
    expect(result.years).toBeCloseTo(1.75, 2);
  });

  it('reports NOT_RECOVERED, never a hardcoded approximation, when cashflow never turns positive', () => {
    const result = computePaybackPeriod([-100, 10, 10, 10]);
    expect(result.status).toBe('NOT_RECOVERED');
    expect(result.years).toBeNull();
  });
});

describe('computeBreakEven', () => {
  it('requiredAdditionalMonthlyRevenue covers cost plus monthly debt service, always computable', () => {
    const result = computeBreakEven(BASE_ASSUMPTIONS, 1_000_000, false);
    expect(result.requiredAdditionalMonthlyRevenue).toBe(7_000_000);
    expect(result.requiredUtilisationPercent).toBeNull();
    expect(result.utilisationReason).toBeDefined();
  });

  it('computes requiredUtilisationPercent only when capacity data is confirmed present', () => {
    const result = computeBreakEven(BASE_ASSUMPTIONS, 1_000_000, true);
    // required 7,000,000 / assumed-full-ramp 15,000,000 * 100
    expect(result.requiredUtilisationPercent).toBeCloseTo(46.67, 1);
  });
});

describe('aggregateDebtServiceByYear / averageMonthlyDebtService', () => {
  it('sums to the same total as the schedule itself, and averages to a sane monthly figure', () => {
    const schedule = generateSchedule({
      principalAmount: 40_000_000,
      interestRatePercent: 20,
      tenorMonths: 24,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: new Date(2026, 0, 1),
    });
    const byYear = aggregateDebtServiceByYear(schedule, new Date(2026, 0, 1), 2);
    const totalDue = schedule.reduce((sum, row) => sum + row.totalDue, 0);
    expect(Math.round(byYear[1]! + byYear[2]!)).toBe(Math.round(totalDue));

    const avgMonthly = averageMonthlyDebtService(byYear);
    expect(avgMonthly).toBeGreaterThan(0);
    expect(avgMonthly * 24).toBeCloseTo(totalDue, -3);
  });
});

describe('runSensitivity', () => {
  it('the Base (0% delta) row for every variable reproduces the unperturbed NPV/ROI/payback exactly', () => {
    const rows = runSensitivity(BASE_ASSUMPTIONS, 24, 15, null);
    const { series } = buildCashflowSeries(BASE_ASSUMPTIONS, 24, [], new Date(2026, 0, 1));
    const baseNpv = computeNPV(series, 15);
    const baseZeroRows = rows.filter((r) => r.deltaPercent === 0);
    expect(baseZeroRows).toHaveLength(4);
    for (const row of baseZeroRows) {
      expect(row.npv).toBe(baseNpv);
    }
  });

  it('produces exactly 20 rows (4 variables × 5 deltas), never a matrix', () => {
    const rows = runSensitivity(BASE_ASSUMPTIONS, 24, 15, null);
    expect(rows).toHaveLength(20);
  });

  it('the interestRate variable has no effect on an unfinanced scenario (debtInput null)', () => {
    const rows = runSensitivity(BASE_ASSUMPTIONS, 24, 15, null);
    const interestRows = rows.filter((r) => r.variable === 'interestRate');
    const npvs = new Set(interestRows.map((r) => r.npv));
    expect(npvs.size).toBe(1);
  });

  it('a higher initialInvestment delta strictly lowers NPV, all else equal', () => {
    const rows = runSensitivity(BASE_ASSUMPTIONS, 24, 15, null);
    const investmentRows = rows
      .filter((r) => r.variable === 'initialInvestment')
      .sort((a, b) => a.deltaPercent - b.deltaPercent);
    for (let i = 1; i < investmentRows.length; i++) {
      expect(investmentRows[i]!.npv).toBeLessThan(investmentRows[i - 1]!.npv);
    }
  });
});
