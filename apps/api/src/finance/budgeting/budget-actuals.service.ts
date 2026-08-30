import { Injectable } from '@nestjs/common';
import { AccountType, BudgetLineType, JournalEntryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { BudgetLineRepository } from './budget-line.repository';
import { BudgetRepository } from './budget.repository';

export interface AccountVarianceRow {
  chartOfAccountId: string;
  accountCode: string;
  accountName: string;
  lineType: BudgetLineType;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  favourable: boolean | null;
}

export interface CapexWithoutAccountRow {
  description: string | null;
  periodMonth: Date;
  budget: number;
}

export interface BudgetVarianceReport {
  budgetId: string;
  totalRevenueBudget: number;
  totalRevenueActual: number;
  totalExpenseBudget: number;
  totalExpenseActual: number;
  totalCapexBudget: number;
  totalCapexActual: number;
  accountVariance: AccountVarianceRow[];
  capexWithoutAccount: CapexWithoutAccountRow[];
  /** Top rows by `|variancePercent|` — the dashboard's "Budget Pressure"
   *  indicators (docs/domains/budgeting.md §17), no separate endpoint. */
  topVariances: AccountVarianceRow[];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Budget vs Actual (Sprint 16, docs/domains/budgeting.md §7/§8/§13/§14) — the
 * General Ledger is the only source of "actual"; nothing here duplicates or
 * caches a balance anywhere. One `journalEntryLine.findMany`, scoped to this
 * budget's own referenced accounts and fiscal-year date range, computes every
 * account's actual for the whole period — never one query per line, never one
 * query per month.
 */
@Injectable()
export class BudgetActualsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetLineRepository: BudgetLineRepository,
  ) {}

  async getVarianceReport(organisationId: string, budgetId: string): Promise<BudgetVarianceReport> {
    const budget = await this.budgetRepository.findById(organisationId, budgetId);
    if (!budget) {
      throw new Error('Budget not found');
    }

    const lines = await this.budgetLineRepository.findManyByBudget(budgetId);
    const accountLines = lines.filter((line) => line.chartOfAccountId);
    const capexWithoutAccount = lines.filter(
      (line) => line.lineType === BudgetLineType.CAPEX && !line.chartOfAccountId,
    );

    const accountIds = [...new Set(accountLines.map((line) => line.chartOfAccountId as string))];

    const [accounts, actualLines] = await Promise.all([
      accountIds.length > 0
        ? this.prisma.chartOfAccount.findMany({ where: { organisationId, id: { in: accountIds } } })
        : Promise.resolve([]),
      accountIds.length > 0
        ? this.prisma.journalEntryLine.findMany({
            where: {
              accountId: { in: accountIds },
              account: { organisationId },
              journalEntry: {
                organisationId,
                status: JournalEntryStatus.POSTED,
                date: { gte: budget.startDate, lte: budget.endDate },
              },
            },
            select: {
              accountId: true,
              debit: true,
              credit: true,
              journalEntry: { select: { date: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const accountById = new Map(accounts.map((account) => [account.id, account]));

    // Sum every actual line into (accountId, month) net-debit/net-credit buckets — one
    // pass over the fetched rows, no further queries.
    const actualBuckets = new Map<string, { debit: number; credit: number }>();
    for (const line of actualLines) {
      const key = `${line.accountId}|${monthKey(line.journalEntry.date)}`;
      const bucket = actualBuckets.get(key) ?? { debit: 0, credit: 0 };
      bucket.debit += line.debit;
      bucket.credit += line.credit;
      actualBuckets.set(key, bucket);
    }

    // Budget totals aggregated per (accountId, lineType) across the whole period.
    const budgetByAccount = new Map<string, { lineType: BudgetLineType; total: number }>();
    for (const line of accountLines) {
      const accountId = line.chartOfAccountId as string;
      const existing = budgetByAccount.get(accountId);
      budgetByAccount.set(accountId, {
        lineType: line.lineType,
        total: (existing?.total ?? 0) + line.amount,
      });
    }

    const accountVariance: AccountVarianceRow[] = [];
    let totalRevenueBudget = 0;
    let totalRevenueActual = 0;
    let totalExpenseBudget = 0;
    let totalExpenseActual = 0;
    let totalCapexBudget = 0;
    let totalCapexActual = 0;

    for (const [accountId, { lineType, total: budgetTotal }] of budgetByAccount) {
      const account = accountById.get(accountId);
      if (!account) continue;

      let actualTotal = 0;
      for (const [key, bucket] of actualBuckets) {
        if (!key.startsWith(`${accountId}|`)) continue;
        const netBalance = bucket.debit - bucket.credit;
        actualTotal += account.type === AccountType.REVENUE ? -netBalance : netBalance;
      }
      actualTotal = roundCurrency(actualTotal);

      const variance = roundCurrency(actualTotal - budgetTotal);
      const variancePercent =
        budgetTotal === 0 ? null : roundCurrency((variance / budgetTotal) * 100);
      const favourable =
        budgetTotal === 0 && actualTotal === 0
          ? null
          : lineType === BudgetLineType.REVENUE
            ? actualTotal >= budgetTotal
            : actualTotal <= budgetTotal;

      accountVariance.push({
        chartOfAccountId: accountId,
        accountCode: account.code,
        accountName: account.name,
        lineType,
        budget: roundCurrency(budgetTotal),
        actual: actualTotal,
        variance,
        variancePercent,
        favourable,
      });

      if (lineType === BudgetLineType.REVENUE) {
        totalRevenueBudget += budgetTotal;
        totalRevenueActual += actualTotal;
      } else if (lineType === BudgetLineType.OPERATING_EXPENSE) {
        totalExpenseBudget += budgetTotal;
        totalExpenseActual += actualTotal;
      } else {
        totalCapexBudget += budgetTotal;
        totalCapexActual += actualTotal;
      }
    }

    totalCapexBudget += capexWithoutAccount.reduce((sum, line) => sum + line.amount, 0);

    accountVariance.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const topVariances = [...accountVariance]
      .filter((row) => row.variancePercent !== null)
      .sort((a, b) => Math.abs(b.variancePercent as number) - Math.abs(a.variancePercent as number))
      .slice(0, 5);

    return {
      budgetId,
      totalRevenueBudget: roundCurrency(totalRevenueBudget),
      totalRevenueActual: roundCurrency(totalRevenueActual),
      totalExpenseBudget: roundCurrency(totalExpenseBudget),
      totalExpenseActual: roundCurrency(totalExpenseActual),
      totalCapexBudget: roundCurrency(totalCapexBudget),
      totalCapexActual: roundCurrency(totalCapexActual),
      accountVariance,
      capexWithoutAccount: capexWithoutAccount.map((line) => ({
        description: line.description,
        periodMonth: line.periodMonth,
        budget: line.amount,
      })),
      topVariances,
    };
  }
}
