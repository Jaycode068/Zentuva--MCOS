import { RepaymentFrequency, RepaymentMethod } from '@prisma/client';
import { generateSchedule, ScheduleInstallment } from '../debt/repayment-schedule';

/**
 * Server-authoritative Decision Analysis math (Sprint 19, docs/domains/
 * financial-decision-analysis.md). Pure, dependency-free — every ROI/NPV/
 * IRR/payback/break-even/sensitivity figure is computed here from raw
 * assumptions, never trusted from the client and never persisted.
 *
 * **Cashflow construction convention (FCFE-style, documented explicitly per
 * the brief's own instruction):** financing effects are included directly
 * in the discounted cashflow stream — Year 0 is the net cash the business
 * must actually find (investment minus any debt drawdown), and each
 * subsequent year subtracts that year's own debt service (principal +
 * interest). This is the only convention under which two funding structures
 * for the same project can produce genuinely different NPVs, which is the
 * entire point of a funding comparison.
 */

export interface DecisionScenarioAssumptions {
  initialInvestment: number;
  additionalCapex: number;
  additionalMonthlyRevenue: number;
  annualRevenueGrowthPercent: number;
  rampUpMonths: number;
  additionalMonthlyOperatingCost: number;
  additionalMonthlyMaintenanceCost: number;
  additionalMonthlyLabourCost: number;
  additionalMonthlyUtilitiesCost: number;
  additionalMonthlyLogisticsCost: number;
  cashFundingAmount: number;
  debtFundingAmount: number;
  workingCapitalImpact: number;
}

export interface DebtGenerationInput {
  principalAmount: number;
  interestRatePercent: number;
  tenorMonths: number;
  graceMonths: number;
  repaymentMethod: RepaymentMethod;
  repaymentFrequency: RepaymentFrequency;
  startDate: Date;
}

export interface CashflowSeriesResult {
  /** Index 0 = Year 0 (net investment), index N = Year N. */
  series: number[];
  /** Same indexing; index 0 is always 0 (no scheduled debt service at drawdown time). */
  debtServiceByYear: number[];
}

export type PaybackStatus = 'RECOVERED' | 'NOT_RECOVERED';

export interface PaybackResult {
  years: number | null;
  status: PaybackStatus;
}

export interface RoiResult {
  roi: number | null;
  netBenefit: number;
}

export interface BreakEvenResult {
  requiredAdditionalMonthlyRevenue: number;
  requiredUtilisationPercent: number | null;
  utilisationReason?: string;
}

export type SensitivityVariable =
  'revenueGrowth' | 'interestRate' | 'operatingCost' | 'initialInvestment';

export interface SensitivityRow {
  variable: SensitivityVariable;
  deltaPercent: number;
  npv: number;
  roi: number | null;
  paybackYears: number | null;
}

export const SENSITIVITY_DELTAS = [-20, -10, 0, 10, 20] as const;
const SENSITIVITY_VARIABLES: SensitivityVariable[] = [
  'revenueGrowth',
  'interestRate',
  'operatingCost',
  'initialInvestment',
];

const IRR_SCAN_MIN = -0.99;
const IRR_SCAN_MAX = 5.0;
const IRR_SCAN_STEP = 0.005;
const IRR_BISECTION_TOLERANCE = 0.00001;
const IRR_BISECTION_MAX_ITERATIONS = 100;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function totalMonthlyCost(a: DecisionScenarioAssumptions): number {
  return (
    a.additionalMonthlyOperatingCost +
    a.additionalMonthlyMaintenanceCost +
    a.additionalMonthlyLabourCost +
    a.additionalMonthlyUtilitiesCost +
    a.additionalMonthlyLogisticsCost
  );
}

/** Monthly net operating cashflow (revenue − cost), ramped and grown. Exported for the Cashflow Impact overlay (`decision-scenario.service.ts`), which needs month-level granularity to align with the real forecast's own monthly buckets. */
export function buildMonthlyOperatingCashflow(
  a: DecisionScenarioAssumptions,
  totalMonths: number,
): number[] {
  const cost = totalMonthlyCost(a);
  const monthly: number[] = [];
  for (let m = 1; m <= totalMonths; m++) {
    const rampFactor = a.rampUpMonths > 0 ? Math.min(1, m / a.rampUpMonths) : 1;
    const yearIndex = Math.floor((m - 1) / 12);
    const growthFactor = Math.pow(1 + a.annualRevenueGrowthPercent / 100, yearIndex);
    const revenue = a.additionalMonthlyRevenue * rampFactor * growthFactor;
    monthly.push(revenue - cost);
  }
  return monthly;
}

function aggregateMonthlyToAnnual(monthly: number[]): number[] {
  const years: number[] = [];
  for (let i = 0; i < monthly.length; i += 12) {
    const slice = monthly.slice(i, i + 12);
    years.push(roundCurrency(slice.reduce((sum, v) => sum + v, 0)));
  }
  return years;
}

/**
 * Aggregates a repayment schedule (real or hypothetical — always via the
 * existing, pure `generateSchedule()`, never a second amortisation engine)
 * into one principal+interest total per analysis year, anchored to the
 * schedule's own `startDate` (the facility's real start date, or the
 * scenario's hypothetical drawdown date).
 */
export function aggregateDebtServiceByYear(
  schedule: ScheduleInstallment[],
  startDate: Date,
  totalYears: number,
): number[] {
  const yearly = new Array<number>(totalYears + 1).fill(0);
  for (const row of schedule) {
    const monthsElapsed =
      (row.dueDate.getFullYear() - startDate.getFullYear()) * 12 +
      (row.dueDate.getMonth() - startDate.getMonth());
    const year = Math.floor((monthsElapsed - 1) / 12) + 1;
    if (year >= 1 && year <= totalYears) {
      yearly[year] = (yearly[year] ?? 0) + row.principalDue + row.interestDue;
    }
  }
  return yearly.map(roundCurrency);
}

/** Net cash tied up by this scenario at Year 0 — investment plus CAPEX plus working capital, minus whatever debt funds it. Exported for the Cashflow Impact overlay. */
export function computeYearZeroCashflow(a: DecisionScenarioAssumptions): number {
  const netInvestment =
    a.initialInvestment + a.additionalCapex + a.workingCapitalImpact - a.debtFundingAmount;
  return -roundCurrency(netInvestment);
}

export function buildCashflowSeries(
  assumptions: DecisionScenarioAssumptions,
  analysisPeriodMonths: number,
  debtSchedule: ScheduleInstallment[],
  debtScheduleStartDate: Date,
): CashflowSeriesResult {
  const totalYears = Math.max(1, Math.ceil(analysisPeriodMonths / 12));
  const monthly = buildMonthlyOperatingCashflow(assumptions, analysisPeriodMonths);
  const annualOperating = aggregateMonthlyToAnnual(monthly);
  const debtServiceByYear = aggregateDebtServiceByYear(
    debtSchedule,
    debtScheduleStartDate,
    totalYears,
  );

  const series: number[] = [computeYearZeroCashflow(assumptions)];
  for (let year = 1; year <= totalYears; year++) {
    const operating = annualOperating[year - 1] ?? 0;
    const debtService = debtServiceByYear[year] ?? 0;
    series.push(roundCurrency(operating - debtService));
  }
  return { series, debtServiceByYear };
}

export function computeNPV(cashflows: number[], discountRatePercent: number): number {
  const rate = discountRatePercent / 100;
  const npv = cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
  return roundCurrency(npv);
}

/**
 * Pre-scans `[-99%, +500%]` for sign changes in `NPV(rate)`, then bisects.
 * Returns `null` ("IRR unavailable") when zero brackets are found (the
 * series never crosses zero) or more than one is found (multiple sign
 * changes — a legitimate possibility with financing cashflows) — never
 * guesses which root is "the" IRR.
 */
export function computeIRR(cashflows: number[]): number | null {
  const npvAt = (rate: number): number =>
    cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);

  const brackets: Array<[number, number]> = [];
  let prevRate = IRR_SCAN_MIN;
  let prevNpv = npvAt(prevRate);
  for (let rate = IRR_SCAN_MIN + IRR_SCAN_STEP; rate <= IRR_SCAN_MAX; rate += IRR_SCAN_STEP) {
    const npv = npvAt(rate);
    if ((prevNpv < 0 && npv >= 0) || (prevNpv > 0 && npv <= 0)) {
      brackets.push([prevRate, rate]);
    }
    prevRate = rate;
    prevNpv = npv;
  }

  if (brackets.length !== 1) {
    return null;
  }

  let [lo, hi] = brackets[0]!;
  let npvLo = npvAt(lo);
  for (let i = 0; i < IRR_BISECTION_MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAt(mid);
    if (Math.abs(npvMid) < IRR_BISECTION_TOLERANCE || hi - lo < IRR_BISECTION_TOLERANCE) {
      return roundCurrency(mid * 100);
    }
    if ((npvLo < 0 && npvMid < 0) || (npvLo > 0 && npvMid > 0)) {
      lo = mid;
      npvLo = npvMid;
    } else {
      hi = mid;
    }
  }
  return roundCurrency(((lo + hi) / 2) * 100);
}

/** `roi = (netBenefit / initialInvestment) × 100`; `netBenefit` = sum of the entire cashflow series (Year 0 through end), undiscounted. */
export function computeROI(cashflows: number[], initialInvestment: number): RoiResult {
  const netBenefit = roundCurrency(cashflows.reduce((sum, cf) => sum + cf, 0));
  if (initialInvestment <= 0) {
    return { roi: null, netBenefit };
  }
  return { roi: roundCurrency((netBenefit / initialInvestment) * 100), netBenefit };
}

/** Computed from the actual cumulative cashflow series, linearly interpolated within the crossing year. */
export function computePaybackPeriod(cashflows: number[]): PaybackResult {
  let cumulative = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const previousCumulative = cumulative;
    cumulative += cashflows[t]!;
    if (previousCumulative < 0 && cumulative >= 0) {
      const denominator = cumulative - previousCumulative;
      const fraction = denominator === 0 ? 0 : -previousCumulative / denominator;
      const years = Math.max(0, t - 1 + fraction);
      return { years: roundCurrency(years), status: 'RECOVERED' };
    }
  }
  return { years: null, status: 'NOT_RECOVERED' };
}

/**
 * `requiredAdditionalMonthlyRevenue` = incremental monthly cost + monthly
 * debt service (always computable). `requiredUtilisationPercent` is
 * computed only when the caller confirms the linked Capital Project
 * carries capacity data — assumes the scenario's own
 * `additionalMonthlyRevenue` represents 100% utilisation of the added
 * capacity, a documented simplification, never invented data.
 */
export function computeBreakEven(
  assumptions: DecisionScenarioAssumptions,
  monthlyDebtService: number,
  hasCapacityData: boolean,
): BreakEvenResult {
  const requiredAdditionalMonthlyRevenue = roundCurrency(
    totalMonthlyCost(assumptions) + monthlyDebtService,
  );

  if (!hasCapacityData || assumptions.additionalMonthlyRevenue <= 0) {
    return {
      requiredAdditionalMonthlyRevenue,
      requiredUtilisationPercent: null,
      utilisationReason: !hasCapacityData
        ? 'No capacity data available on the linked Capital Project'
        : 'Scenario has no assumed additional monthly revenue to scale against',
    };
  }

  const requiredUtilisationPercent = roundCurrency(
    (requiredAdditionalMonthlyRevenue / assumptions.additionalMonthlyRevenue) * 100,
  );
  return { requiredAdditionalMonthlyRevenue, requiredUtilisationPercent };
}

/** Average monthly debt service across the years debt service is actually due (0 if unfinanced). */
export function averageMonthlyDebtService(debtServiceByYear: number[]): number {
  const activeYears = debtServiceByYear.slice(1).filter((v) => v > 0);
  if (activeYears.length === 0) {
    return 0;
  }
  const total = activeYears.reduce((sum, v) => sum + v, 0);
  return roundCurrency(total / activeYears.length / 12);
}

export function sumScheduleInterest(schedule: ScheduleInstallment[]): number {
  return roundCurrency(schedule.reduce((sum, row) => sum + row.interestDue, 0));
}

/**
 * One-variable-at-a-time sensitivity over
 * `{revenueGrowth, interestRate, operatingCost, initialInvestment}` ×
 * `{-20%, -10%, Base, +10%, +20%}` — 20 full recomputations, never a
 * multi-variable matrix. `debtInput` is `null` for an unfinanced scenario
 * (the `interestRate` variable then has no effect, correctly).
 */
export function runSensitivity(
  baseAssumptions: DecisionScenarioAssumptions,
  analysisPeriodMonths: number,
  discountRatePercent: number,
  debtInput: DebtGenerationInput | null,
): SensitivityRow[] {
  const rows: SensitivityRow[] = [];

  for (const variable of SENSITIVITY_VARIABLES) {
    for (const deltaPercent of SENSITIVITY_DELTAS) {
      const factor = 1 + deltaPercent / 100;
      const perturbedAssumptions: DecisionScenarioAssumptions = { ...baseAssumptions };
      let perturbedDebtInput = debtInput;

      if (variable === 'revenueGrowth') {
        perturbedAssumptions.annualRevenueGrowthPercent =
          baseAssumptions.annualRevenueGrowthPercent * factor;
      } else if (variable === 'operatingCost') {
        perturbedAssumptions.additionalMonthlyOperatingCost =
          baseAssumptions.additionalMonthlyOperatingCost * factor;
        perturbedAssumptions.additionalMonthlyMaintenanceCost =
          baseAssumptions.additionalMonthlyMaintenanceCost * factor;
        perturbedAssumptions.additionalMonthlyLabourCost =
          baseAssumptions.additionalMonthlyLabourCost * factor;
        perturbedAssumptions.additionalMonthlyUtilitiesCost =
          baseAssumptions.additionalMonthlyUtilitiesCost * factor;
        perturbedAssumptions.additionalMonthlyLogisticsCost =
          baseAssumptions.additionalMonthlyLogisticsCost * factor;
      } else if (variable === 'initialInvestment') {
        perturbedAssumptions.initialInvestment = baseAssumptions.initialInvestment * factor;
      } else if (variable === 'interestRate' && debtInput) {
        perturbedDebtInput = {
          ...debtInput,
          interestRatePercent: debtInput.interestRatePercent * factor,
        };
      }

      const schedule = perturbedDebtInput ? generateSchedule(perturbedDebtInput) : [];
      const startDate = perturbedDebtInput?.startDate ?? new Date();
      const { series } = buildCashflowSeries(
        perturbedAssumptions,
        analysisPeriodMonths,
        schedule,
        startDate,
      );
      const npv = computeNPV(series, discountRatePercent);
      const { roi } = computeROI(series, perturbedAssumptions.initialInvestment);
      const payback = computePaybackPeriod(series);
      rows.push({ variable, deltaPercent, npv, roi, paybackYears: payback.years });
    }
  }

  return rows;
}
