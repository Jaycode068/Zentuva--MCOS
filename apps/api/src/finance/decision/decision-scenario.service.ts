import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DecisionAnalysis,
  DecisionScenario,
  RepaymentFrequency,
  RepaymentMethod,
} from '@prisma/client';
import { CreateDecisionScenarioInput, UpdateDecisionScenarioInput } from '@zentuva/validation';

import { CashflowForecastService } from '../cashflow/cashflow-forecast.service';
import { CashflowSettingsService } from '../cashflow/cashflow-settings.service';
import { DebtFacilityRepository } from '../debt/debt-facility.repository';
import { generateSchedule, ScheduleInstallment } from '../debt/repayment-schedule';
import { CapitalProjectService } from '../investment/capital-project.service';
import {
  BreakEvenResult,
  DebtGenerationInput,
  DecisionScenarioAssumptions,
  PaybackResult,
  SensitivityRow,
  aggregateDebtServiceByYear,
  averageMonthlyDebtService,
  buildCashflowSeries,
  buildMonthlyOperatingCashflow,
  computeBreakEven,
  computeIRR,
  computeNPV,
  computePaybackPeriod,
  computeROI,
  computeYearZeroCashflow,
  runSensitivity,
  sumScheduleInterest,
} from './decision-calculations';
import { DecisionAnalysisService } from './decision-analysis.service';
import {
  CreateDecisionScenarioResult,
  DecisionScenarioRepository,
} from './decision-scenario.repository';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ScenarioResults {
  scenarioId: string;
  initialInvestment: number;
  discountRatePercent: number;
  npv: number;
  irr: number | null;
  roi: number | null;
  netBenefit: number;
  payback: PaybackResult;
  breakEven: BreakEvenResult;
  series: number[];
}

export interface DebtImpactResult {
  applicable: boolean;
  reason?: string;
  initialCashRequirement: number;
  monthlyDebtService: number;
  totalInterest: number;
  totalDebtService: number;
  source: 'FACILITY' | 'HYPOTHETICAL' | 'NONE';
}

export interface BudgetImpactResult {
  applicable: boolean;
  reason?: string;
  budgetedAmount?: number;
  plannedCost?: number;
  scenarioImpact?: number;
  projectedTotal?: number;
  withinBudget?: boolean;
}

export interface CashflowImpactPeriod {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  baseClosingBalance: number;
  scenarioImpact: number;
  scenarioClosingBalance: number;
  belowMinimumReserve: boolean;
}

export interface CashflowImpactResult {
  minimumCashReserve: number;
  periods: CashflowImpactPeriod[];
  minCashPosition: number;
  shortfallMonths: number;
  recoveryMonth: number | null;
}

export type Recommendation = 'ATTRACTIVE' | 'CAUTION' | 'UNATTRACTIVE';

export interface RecommendationResult {
  recommendation: Recommendation;
  npvPositive: boolean;
  paybackRecovered: boolean;
  paybackYears: number | null;
  paybackWithinThreshold: boolean;
  maxAcceptablePaybackYears: number;
  downsideChecked: boolean;
  downsideOk: boolean;
}

export interface FundingComparisonRow {
  scenarioId: string;
  name: string;
  initialInvestment: number;
  cashFundingAmount: number;
  debtFundingAmount: number;
  monthlyDebtService: number;
  totalInterest: number;
  npv: number;
  irr: number | null;
  paybackYears: number | null;
  paybackStatus: PaybackResult['status'];
  minCashPosition: number;
  recommendation: Recommendation;
}

/**
 * Domain service for `DecisionScenario` (Sprint 19, docs/domains/
 * financial-decision-analysis.md) — every planning assumption and every
 * composition method (results/sensitivity/cashflow-impact/budget-impact/
 * debt-impact/recommendation/funding-comparison). Reads `CapitalProject`/
 * `DebtFacility`/`CashflowForecastService`/`CashflowSettingsService`
 * read-only; never writes to any of them (decision #12/#14 — proven by
 * `decision-independence.spec.ts`).
 */
@Injectable()
export class DecisionScenarioService {
  constructor(
    private readonly decisionScenarioRepository: DecisionScenarioRepository,
    private readonly decisionAnalysisService: DecisionAnalysisService,
    private readonly capitalProjectService: CapitalProjectService,
    private readonly debtFacilityRepository: DebtFacilityRepository,
    private readonly cashflowForecastService: CashflowForecastService,
    private readonly cashflowSettingsService: CashflowSettingsService,
  ) {}

  async list(organisationId: string, analysisId: string): Promise<DecisionScenario[]> {
    await this.decisionAnalysisService.getByIdOrThrow(organisationId, analysisId);
    return this.decisionScenarioRepository.findManyByAnalysis(analysisId);
  }

  async create(
    organisationId: string,
    analysisId: string,
    input: CreateDecisionScenarioInput,
    actorUserId: string,
  ): Promise<CreateDecisionScenarioResult> {
    const analysis = await this.decisionAnalysisService.getByIdOrThrow(organisationId, analysisId);
    this.decisionAnalysisService.assertEditable(analysis);
    if (input.initialInvestment == null && !analysis.capitalProjectId) {
      throw new BadRequestException(
        'initialInvestment is required when this decision analysis has no linked capital project',
      );
    }
    return this.decisionScenarioRepository.create({
      decisionAnalysisId: analysisId,
      name: input.name,
      scenarioType: input.scenarioType,
      initialInvestment: input.initialInvestment,
      additionalCapex: input.additionalCapex,
      additionalMonthlyRevenue: input.additionalMonthlyRevenue,
      annualRevenueGrowthPercent: input.annualRevenueGrowthPercent,
      rampUpMonths: input.rampUpMonths,
      additionalMonthlyOperatingCost: input.additionalMonthlyOperatingCost,
      additionalMonthlyMaintenanceCost: input.additionalMonthlyMaintenanceCost,
      additionalMonthlyLabourCost: input.additionalMonthlyLabourCost,
      additionalMonthlyUtilitiesCost: input.additionalMonthlyUtilitiesCost,
      additionalMonthlyLogisticsCost: input.additionalMonthlyLogisticsCost,
      cashFundingAmount: input.cashFundingAmount,
      debtFundingAmount: input.debtFundingAmount,
      debtInterestRatePercent: input.debtInterestRatePercent,
      debtTermMonths: input.debtTermMonths,
      debtRepaymentMethod: input.debtRepaymentMethod,
      workingCapitalImpact: input.workingCapitalImpact,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
    input: UpdateDecisionScenarioInput,
  ): Promise<DecisionScenario> {
    const analysis = await this.decisionAnalysisService.getByIdOrThrow(organisationId, analysisId);
    this.decisionAnalysisService.assertEditable(analysis);
    await this.getScenarioOrThrow(analysisId, scenarioId);
    const updated = await this.decisionScenarioRepository.update(scenarioId, { ...input });
    if (!updated) {
      throw new NotFoundException('Decision scenario not found');
    }
    return updated;
  }

  async remove(organisationId: string, analysisId: string, scenarioId: string): Promise<void> {
    const analysis = await this.decisionAnalysisService.getByIdOrThrow(organisationId, analysisId);
    this.decisionAnalysisService.assertEditable(analysis);
    await this.getScenarioOrThrow(analysisId, scenarioId);
    await this.decisionScenarioRepository.remove(scenarioId);
  }

  async getResults(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<ScenarioResults> {
    const { analysis, scenario, capitalProject } = await this.loadContext(
      organisationId,
      analysisId,
      scenarioId,
    );
    const initialInvestment = await this.resolveInitialInvestment(scenario, capitalProject);
    const debtInput = await this.resolveDebtGenerationInput(organisationId, analysis, scenario);
    const assumptions = this.toAssumptions(scenario, initialInvestment);

    const { schedule, startDate } = this.generateFromInput(debtInput);
    const { series, debtServiceByYear } = buildCashflowSeries(
      assumptions,
      analysis.analysisPeriodMonths,
      schedule,
      startDate,
    );
    const npv = computeNPV(series, analysis.discountRatePercent);
    const irr = computeIRR(series);
    const { roi, netBenefit } = computeROI(series, initialInvestment);
    const payback = computePaybackPeriod(series);
    const monthlyDebtService = averageMonthlyDebtService(debtServiceByYear);
    const hasCapacityData =
      capitalProject?.currentCapacityUnitsPerDay != null &&
      capitalProject?.expectedCapacityUnitsPerDay != null;
    const breakEven = computeBreakEven(assumptions, monthlyDebtService, !!hasCapacityData);

    return {
      scenarioId,
      initialInvestment,
      discountRatePercent: analysis.discountRatePercent,
      npv,
      irr,
      roi,
      netBenefit,
      payback,
      breakEven,
      series,
    };
  }

  async getSensitivity(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<SensitivityRow[]> {
    const { analysis, scenario, capitalProject } = await this.loadContext(
      organisationId,
      analysisId,
      scenarioId,
    );
    const initialInvestment = await this.resolveInitialInvestment(scenario, capitalProject);
    const debtInput = await this.resolveDebtGenerationInput(organisationId, analysis, scenario);
    const assumptions = this.toAssumptions(scenario, initialInvestment);
    return runSensitivity(
      assumptions,
      analysis.analysisPeriodMonths,
      analysis.discountRatePercent,
      debtInput,
    );
  }

  async getDebtImpact(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<DebtImpactResult> {
    const { analysis, scenario, capitalProject } = await this.loadContext(
      organisationId,
      analysisId,
      scenarioId,
    );
    if (scenario.debtFundingAmount <= 0) {
      return {
        applicable: false,
        reason: 'This scenario has no debt funding',
        initialCashRequirement: await this.resolveInitialInvestment(scenario, capitalProject),
        monthlyDebtService: 0,
        totalInterest: 0,
        totalDebtService: 0,
        source: 'NONE',
      };
    }
    const initialInvestment = await this.resolveInitialInvestment(scenario, capitalProject);
    const debtInput = await this.resolveDebtGenerationInput(organisationId, analysis, scenario);
    const { schedule, startDate } = this.generateFromInput(debtInput);
    const totalYears = Math.max(1, Math.ceil(analysis.analysisPeriodMonths / 12));
    const debtServiceByYear = schedule.length
      ? aggregateDebtServiceByYear(schedule, startDate, totalYears)
      : [];
    const totalDebtService = roundCurrency(schedule.reduce((sum, row) => sum + row.totalDue, 0));

    return {
      applicable: true,
      initialCashRequirement: roundCurrency(initialInvestment - scenario.debtFundingAmount),
      monthlyDebtService: averageMonthlyDebtService(debtServiceByYear),
      totalInterest: sumScheduleInterest(schedule),
      totalDebtService,
      source: analysis.debtFacilityId ? 'FACILITY' : 'HYPOTHETICAL',
    };
  }

  async getBudgetImpact(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<BudgetImpactResult> {
    const { analysis, scenario } = await this.loadContext(organisationId, analysisId, scenarioId);
    if (!analysis.capitalProjectId) {
      return { applicable: false, reason: 'This decision analysis has no linked capital project' };
    }
    const allocation = await this.capitalProjectService.getBudgetAllocation(
      organisationId,
      analysis.capitalProjectId,
    );
    if (!allocation) {
      return { applicable: false, reason: 'The linked capital project has no budget allocation' };
    }
    const projectedTotal = roundCurrency(allocation.plannedCost + scenario.additionalCapex);
    return {
      applicable: true,
      budgetedAmount: allocation.budgetedAmount,
      plannedCost: allocation.plannedCost,
      scenarioImpact: roundCurrency(scenario.additionalCapex),
      projectedTotal,
      withinBudget: projectedTotal <= allocation.budgetedAmount,
    };
  }

  /**
   * Read-only overlay on the real Cashflow Forecast (`DebtAnalysisService.
   * previewFacilityImpact()`'s exact template) — never persists a
   * `CashflowForecastItem`, never touches the real forecast in any way.
   */
  async previewCashflowImpact(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<CashflowImpactResult> {
    const { analysis, scenario, capitalProject } = await this.loadContext(
      organisationId,
      analysisId,
      scenarioId,
    );
    const initialInvestment = await this.resolveInitialInvestment(scenario, capitalProject);
    const debtInput = await this.resolveDebtGenerationInput(organisationId, analysis, scenario);
    const { schedule } = this.generateFromInput(debtInput);
    const assumptions = this.toAssumptions(scenario, initialInvestment);

    const horizonDays = Math.min(1825, Math.max(30, analysis.analysisPeriodMonths * 31));
    const [forecast, settings] = await Promise.all([
      this.cashflowForecastService.getForecast(organisationId, {
        horizonDays,
        bucketBy: 'monthly',
      }),
      this.cashflowSettingsService.getEffective(organisationId),
    ]);

    const monthlyOperating = buildMonthlyOperatingCashflow(
      assumptions,
      analysis.analysisPeriodMonths,
    );
    const yearZero = computeYearZeroCashflow(assumptions);

    let cumulativeDelta = 0;
    let minCashPosition = 0;
    let shortfallMonths = 0;
    let inShortfall = false;
    let recoveryMonth: number | null = null;

    const periods: CashflowImpactPeriod[] = forecast.buckets.map((bucket, index) => {
      const debtDelta = roundCurrency(
        schedule
          .filter((row) => row.dueDate >= bucket.periodStart && row.dueDate <= bucket.periodEnd)
          .reduce((sum, row) => sum + row.totalDue, 0),
      );
      const operatingDelta = monthlyOperating[index] ?? 0;
      const oneOffDelta = index === 0 ? yearZero : 0;
      const scenarioImpact = roundCurrency(operatingDelta - debtDelta + oneOffDelta);
      cumulativeDelta = roundCurrency(cumulativeDelta + scenarioImpact);
      const scenarioClosingBalance = roundCurrency(bucket.closingBalance + cumulativeDelta);
      const belowMinimumReserve = scenarioClosingBalance < settings.minimumCashReserve;

      if (index === 0 || scenarioClosingBalance < minCashPosition) {
        minCashPosition = scenarioClosingBalance;
      }
      if (belowMinimumReserve) {
        shortfallMonths += 1;
        inShortfall = true;
      } else if (inShortfall && recoveryMonth === null) {
        recoveryMonth = index + 1;
        inShortfall = false;
      }

      return {
        periodStart: bucket.periodStart,
        periodEnd: bucket.periodEnd,
        label: bucket.label,
        baseClosingBalance: bucket.closingBalance,
        scenarioImpact,
        scenarioClosingBalance,
        belowMinimumReserve,
      };
    });

    return {
      minimumCashReserve: settings.minimumCashReserve,
      periods,
      minCashPosition,
      shortfallMonths,
      recoveryMonth,
    };
  }

  /**
   * Rule-based, transparent, configurable (docs/domains/financial-decision-
   * analysis.md "Recommendation Rules") — never an AI judgement. The
   * response always carries the specific reasons behind the verdict.
   */
  async getRecommendation(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<RecommendationResult> {
    const { analysis, scenario } = await this.loadContext(organisationId, analysisId, scenarioId);
    const results = await this.getResults(organisationId, analysisId, scenarioId);

    const npvPositive = results.npv > 0;
    const paybackRecovered = results.payback.status === 'RECOVERED';
    const paybackWithinThreshold =
      paybackRecovered &&
      results.payback.years !== null &&
      results.payback.years <= analysis.maxAcceptablePaybackYears;

    const siblings = await this.decisionScenarioRepository.findManyByAnalysis(analysisId);
    const pessimistic = siblings.find(
      (s) => s.scenarioType === 'PESSIMISTIC' && s.id !== scenario.id,
    );
    let downsideChecked = false;
    let downsideOk = true;
    if (pessimistic) {
      downsideChecked = true;
      const impact = await this.previewCashflowImpact(organisationId, analysisId, pessimistic.id);
      downsideOk = impact.shortfallMonths === 0;
    }

    let recommendation: Recommendation;
    if (!npvPositive || !paybackRecovered || (downsideChecked && !downsideOk)) {
      recommendation = 'UNATTRACTIVE';
    } else if (paybackWithinThreshold) {
      recommendation = 'ATTRACTIVE';
    } else {
      recommendation = 'CAUTION';
    }

    return {
      recommendation,
      npvPositive,
      paybackRecovered,
      paybackYears: results.payback.years,
      paybackWithinThreshold,
      maxAcceptablePaybackYears: analysis.maxAcceptablePaybackYears,
      downsideChecked,
      downsideOk,
    };
  }

  async getFundingComparison(
    organisationId: string,
    analysisId: string,
    scenarioIds: string[],
  ): Promise<FundingComparisonRow[]> {
    const rows: FundingComparisonRow[] = [];
    for (const scenarioId of scenarioIds) {
      const [results, debtImpact, recommendationResult, scenario] = await Promise.all([
        this.getResults(organisationId, analysisId, scenarioId),
        this.getDebtImpact(organisationId, analysisId, scenarioId),
        this.getRecommendation(organisationId, analysisId, scenarioId),
        this.getScenarioOrThrow(analysisId, scenarioId),
      ]);
      const cashflowImpact = await this.previewCashflowImpact(
        organisationId,
        analysisId,
        scenarioId,
      );
      rows.push({
        scenarioId,
        name: scenario.name,
        initialInvestment: results.initialInvestment,
        cashFundingAmount: scenario.cashFundingAmount,
        debtFundingAmount: scenario.debtFundingAmount,
        monthlyDebtService: debtImpact.monthlyDebtService,
        totalInterest: debtImpact.totalInterest,
        npv: results.npv,
        irr: results.irr,
        paybackYears: results.payback.years,
        paybackStatus: results.payback.status,
        minCashPosition: cashflowImpact.minCashPosition,
        recommendation: recommendationResult.recommendation,
      });
    }
    return rows;
  }

  // --- Internal composition helpers -----------------------------------

  private async loadContext(
    organisationId: string,
    analysisId: string,
    scenarioId: string,
  ): Promise<{
    analysis: DecisionAnalysis;
    scenario: DecisionScenario;
    capitalProject: Awaited<ReturnType<CapitalProjectService['getById']>> | null;
  }> {
    const analysis = await this.decisionAnalysisService.getByIdOrThrow(organisationId, analysisId);
    const scenario = await this.getScenarioOrThrow(analysisId, scenarioId);
    const capitalProject = analysis.capitalProjectId
      ? await this.capitalProjectService.getById(organisationId, analysis.capitalProjectId)
      : null;
    return { analysis, scenario, capitalProject };
  }

  private async getScenarioOrThrow(
    analysisId: string,
    scenarioId: string,
  ): Promise<DecisionScenario> {
    const scenario = await this.decisionScenarioRepository.findById(scenarioId);
    if (!scenario || scenario.decisionAnalysisId !== analysisId) {
      throw new NotFoundException('Decision scenario not found');
    }
    return scenario;
  }

  private async resolveInitialInvestment(
    scenario: DecisionScenario,
    capitalProject: Awaited<ReturnType<CapitalProjectService['getById']>> | null,
  ): Promise<number> {
    if (scenario.initialInvestment != null) {
      return scenario.initialInvestment;
    }
    return capitalProject?.financials.plannedCost ?? 0;
  }

  private toAssumptions(
    scenario: DecisionScenario,
    initialInvestment: number,
  ): DecisionScenarioAssumptions {
    return {
      initialInvestment,
      additionalCapex: scenario.additionalCapex,
      additionalMonthlyRevenue: scenario.additionalMonthlyRevenue,
      annualRevenueGrowthPercent: scenario.annualRevenueGrowthPercent,
      rampUpMonths: scenario.rampUpMonths,
      additionalMonthlyOperatingCost: scenario.additionalMonthlyOperatingCost,
      additionalMonthlyMaintenanceCost: scenario.additionalMonthlyMaintenanceCost,
      additionalMonthlyLabourCost: scenario.additionalMonthlyLabourCost,
      additionalMonthlyUtilitiesCost: scenario.additionalMonthlyUtilitiesCost,
      additionalMonthlyLogisticsCost: scenario.additionalMonthlyLogisticsCost,
      cashFundingAmount: scenario.cashFundingAmount,
      debtFundingAmount: scenario.debtFundingAmount,
      workingCapitalImpact: scenario.workingCapitalImpact,
    };
  }

  /**
   * Resolves the financing terms a scenario should use — the real linked
   * `DebtFacility`'s own rate/term/method whenever one is linked (never a
   * guessed rate), or the scenario's own hypothetical fields otherwise.
   * Always fed into the existing `generateSchedule()` — never a second
   * amortisation engine (decision #10).
   */
  private async resolveDebtGenerationInput(
    organisationId: string,
    analysis: DecisionAnalysis,
    scenario: DecisionScenario,
  ): Promise<DebtGenerationInput | null> {
    if (scenario.debtFundingAmount <= 0) {
      return null;
    }
    if (analysis.debtFacilityId) {
      const facility = await this.debtFacilityRepository.findById(
        organisationId,
        analysis.debtFacilityId,
      );
      if (!facility) {
        throw new NotFoundException('Linked debt facility not found');
      }
      return {
        principalAmount: scenario.debtFundingAmount,
        interestRatePercent: facility.interestRatePercent,
        tenorMonths: facility.tenorMonths,
        graceMonths: facility.graceMonths,
        repaymentMethod: facility.repaymentMethod,
        repaymentFrequency: facility.repaymentFrequency,
        startDate: facility.startDate,
      };
    }
    if (scenario.debtInterestRatePercent != null && scenario.debtTermMonths != null) {
      return {
        principalAmount: scenario.debtFundingAmount,
        interestRatePercent: scenario.debtInterestRatePercent,
        tenorMonths: scenario.debtTermMonths,
        graceMonths: 0,
        repaymentMethod: scenario.debtRepaymentMethod ?? RepaymentMethod.AMORTISING,
        repaymentFrequency: RepaymentFrequency.MONTHLY,
        startDate: analysis.createdAt,
      };
    }
    return null;
  }

  private generateFromInput(debtInput: DebtGenerationInput | null): {
    schedule: ScheduleInstallment[];
    startDate: Date;
  } {
    if (!debtInput) {
      return { schedule: [], startDate: new Date() };
    }
    return { schedule: generateSchedule(debtInput), startDate: debtInput.startDate };
  }
}
