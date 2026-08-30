import { Injectable, NotFoundException } from '@nestjs/common';
import { BudgetLineType } from '@prisma/client';

import { CashflowForecastService } from '../cashflow/cashflow-forecast.service';
import { BudgetLineRepository } from './budget-line.repository';
import { BudgetRepository } from './budget.repository';

export interface BudgetForecastPeriod {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  budgetedExpenditure: number;
  forecastExpenditure: number;
  /** The forecast's own opening cash balance for this period — how much cash
   *  is on hand *before* this period's own inflows/outflows, the figure a
   *  planned spend is actually measured against. */
  availableCash: number;
  potentialShortfall: number;
}

export interface BudgetVsForecastResult {
  applicable: boolean;
  reason?: string;
  periods: BudgetForecastPeriod[];
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Budget vs Cashflow Forecast (Sprint 16, docs/domains/budgeting.md §9) —
 * genuinely reuses Sprint 15's `CashflowForecastService.getForecast()`
 * (already DI-available inside `FinanceModule`) rather than rebuilding any
 * forecast logic. A budget's own optional `cashflowScenarioId` is passed
 * straight through, so this composition can be scenario-aware without a
 * second scenario engine.
 */
@Injectable()
export class BudgetForecastService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetLineRepository: BudgetLineRepository,
    private readonly cashflowForecastService: CashflowForecastService,
  ) {}

  async getBudgetVsForecast(
    organisationId: string,
    budgetId: string,
  ): Promise<BudgetVsForecastResult> {
    const budget = await this.budgetRepository.findById(organisationId, budgetId);
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (budget.endDate < today) {
      return {
        applicable: false,
        reason:
          "This budget's fiscal year has already ended — no future cashflow to forecast against.",
        periods: [],
      };
    }

    const horizonDays = Math.max(
      1,
      Math.ceil((budget.endDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const forecast = await this.cashflowForecastService.getForecast(organisationId, {
      horizonDays,
      bucketBy: 'monthly',
      scenarioId: budget.cashflowScenarioId ?? undefined,
    });

    const lines = await this.budgetLineRepository.findManyByBudget(budgetId);
    const expenditureLines = lines.filter(
      (line) =>
        line.lineType === BudgetLineType.OPERATING_EXPENSE ||
        line.lineType === BudgetLineType.CAPEX,
    );

    const periods: BudgetForecastPeriod[] = forecast.buckets.map((bucket) => {
      const budgetedExpenditure = roundCurrency(
        expenditureLines
          .filter(
            (line) =>
              line.periodMonth >= bucket.periodStart && line.periodMonth <= bucket.periodEnd,
          )
          .reduce((sum, line) => sum + line.amount, 0),
      );

      return {
        periodStart: bucket.periodStart,
        periodEnd: bucket.periodEnd,
        label: bucket.label,
        budgetedExpenditure,
        forecastExpenditure: roundCurrency(bucket.outflows),
        availableCash: roundCurrency(bucket.openingBalance),
        potentialShortfall: roundCurrency(Math.max(0, budgetedExpenditure - bucket.openingBalance)),
      };
    });

    return { applicable: true, periods };
  }
}
