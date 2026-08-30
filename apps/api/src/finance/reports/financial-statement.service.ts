import { Injectable } from '@nestjs/common';
import { AccountType, JournalEntryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountRepository } from '../accounting/chart-of-account.repository';
import { getAccountBalances } from '../accounting/ledger.service';

export interface FinancialStatementLine {
  accountId: string;
  code: string;
  name: string;
  /** The statement-positive amount for this account — already sign-adjusted for its
   *  `AccountType`'s normal balance (see this file's own doc comment). Never the raw
   *  `debit − credit` a caller would need to re-sign themselves. */
  amount: number;
}

export interface ProfitAndLossResult {
  from: Date | null;
  to: Date;
  revenue: number;
  revenueLines: FinancialStatementLine[];
  costOfSales: number;
  costOfSalesLines: FinancialStatementLine[];
  grossProfit: number;
  /** `null` when `revenue === 0` — never `NaN`/`Infinity` (brief §19). */
  grossMarginPercent: number | null;
  operatingExpenses: number;
  operatingExpenseLines: FinancialStatementLine[];
  /** `grossProfit - operatingExpenses`. No separate "Other Income/Expense" section —
   *  see this file's own doc comment on why that split isn't reliably derivable from
   *  the existing Chart of Accounts, so Operating Profit and Net Profit are the same
   *  figure this sprint (documented limitation, not an oversight). */
  netProfit: number;
}

export interface ProfitAndLossComparison {
  current: ProfitAndLossResult;
  /** `null` when the equivalent previous period has zero posted journal-entry
   *  activity at all (not just zero net income) — the frontend renders "No
   *  comparison data" rather than a misleading zero (brief §11). */
  previous: ProfitAndLossResult | null;
}

export interface BalanceSheetResult {
  asOf: Date;
  assets: number;
  assetLines: FinancialStatementLine[];
  liabilities: number;
  liabilityLines: FinancialStatementLine[];
  /** Equity actually recorded on `EQUITY`-type accounts (e.g. Owner's Capital) —
   *  excludes `retainedEarnings` below, listed separately since it is computed, not
   *  posted. */
  recordedEquity: number;
  equityLines: FinancialStatementLine[];
  /** All-time net profit (Revenue − Cost of Sales − Expenses) from the ledger's first
   *  posting through `asOf` — see this file's own doc comment on why this stands in
   *  for a formal Retained Earnings account, which this codebase has no year-end
   *  closing mechanism to populate (docs/domains/accounting.md §9.4/§15, unchanged by
   *  this sprint — Sprint 13 is reporting-only, brief §33/§36). */
  retainedEarnings: number;
  totalEquity: number;
  /** `assets - (liabilities + totalEquity)` — always `0` by double-entry
   *  construction (see `getAccountBalances`'s own doc comment); reported explicitly,
   *  never silently assumed, so a genuine data problem would be visible rather than
   *  hidden by a rounding shortcut. */
  difference: number;
  balanced: boolean;
}

/**
 * Derives the Profit & Loss and Balance Sheet directly from posted
 * `JournalEntry`/`JournalEntryLine` rows (Sprint 13, docs/domains/accounting.md §16)
 * — no parallel ledger, no independently-recomputed balance. The one piece of
 * accounting mechanics this makes explicit for the first time in this codebase:
 * **normal-balance-sign summation per `AccountType`**. `Asset`/`Cost-of-Sales`/
 * `Expense` accounts are debit-normal (`amount = debit − credit`, i.e.
 * `AccountBalanceRow.netBalance` as-is); `Liability`/`Equity`/`Revenue` accounts are
 * credit-normal (`amount = credit − debit`, i.e. `-netBalance`). Summing every
 * `POSTED` line grouped by account, then re-signed and rolled up by `type`, is
 * *sufficient* to derive a correct P&L/Balance Sheet with the Chart of Accounts'
 * existing six `AccountType` values — no schema change was needed (research
 * confirmed this before any code was written, see the Sprint 13 plan's own Context).
 * `SALES_RETURNS` (itself `type: REVENUE`, a contra-revenue account) nets against
 * `SALES_REVENUE` automatically, with no "is this a contra account" flag anywhere —
 * summing signed amounts within one `AccountType` group does that for free.
 *
 * **Known limitation, deliberately not solved by a schema change**: there is no way
 * to distinguish "Other Income"/"Other Expense" from Operating Revenue/Expense, or a
 * Current from a Fixed Asset, using only `AccountType` — every `REVENUE` account
 * counts as operating revenue, every `EXPENSE` account as an operating expense. The
 * brief's own instruction was "identify the minimum architectural enhancement
 * required... do not create a large accounting redesign"; the finding here is that
 * the minimum enhancement is none, and this specific classification gap is recorded
 * as a known limitation rather than solved with new Chart of Accounts metadata no
 * organisation's real chart currently needs.
 */
@Injectable()
export class FinancialStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
  ) {}

  async getProfitAndLoss(
    organisationId: string,
    params: { from?: Date; to: Date; accountingPeriodId?: string },
  ): Promise<ProfitAndLossResult> {
    const rows = await getAccountBalances(
      this.prisma,
      this.chartOfAccountRepository,
      organisationId,
      {
        from: params.from,
        to: params.to,
        accountingPeriodId: params.accountingPeriodId,
      },
    );

    const revenueLines = toLines(rows, AccountType.REVENUE, 'credit');
    const costOfSalesLines = toLines(rows, AccountType.COST_OF_SALES, 'debit');
    const operatingExpenseLines = toLines(rows, AccountType.EXPENSE, 'debit');

    const revenue = sumLines(revenueLines);
    const costOfSales = sumLines(costOfSalesLines);
    const operatingExpenses = sumLines(operatingExpenseLines);
    const grossProfit = roundCurrency(revenue - costOfSales);
    const netProfit = roundCurrency(grossProfit - operatingExpenses);

    return {
      from: params.from ?? null,
      to: params.to,
      revenue,
      revenueLines,
      costOfSales,
      costOfSalesLines,
      grossProfit,
      grossMarginPercent: revenue === 0 ? null : roundCurrency((grossProfit / revenue) * 100),
      operatingExpenses,
      operatingExpenseLines,
      netProfit,
    };
  }

  /** Decision #11 — compares `[from, to]` against the immediately-preceding period
   *  of identical length. Only supported when the caller supplies concrete
   *  `from`/`to` dates (the frontend's period-preset utility always does) — an
   *  `accountingPeriodId`-scoped comparison is out of scope this sprint. */
  async getProfitAndLossComparison(
    organisationId: string,
    params: { from: Date; to: Date },
  ): Promise<ProfitAndLossComparison> {
    const current = await this.getProfitAndLoss(organisationId, params);

    const periodLengthMs = params.to.getTime() - params.from.getTime();
    const previousTo = new Date(params.from.getTime() - DAY_MS);
    const previousFrom = new Date(previousTo.getTime() - periodLengthMs);

    const activityCount = await this.prisma.journalEntry.count({
      where: {
        organisationId,
        status: JournalEntryStatus.POSTED,
        date: { gte: previousFrom, lte: previousTo },
      },
    });
    if (activityCount === 0) {
      return { current, previous: null };
    }

    const previous = await this.getProfitAndLoss(organisationId, {
      from: previousFrom,
      to: previousTo,
    });
    return { current, previous };
  }

  async getBalanceSheet(
    organisationId: string,
    params: { asOf: Date },
  ): Promise<BalanceSheetResult> {
    const rows = await getAccountBalances(
      this.prisma,
      this.chartOfAccountRepository,
      organisationId,
      {
        to: params.asOf,
      },
    );

    const assetLines = toLines(rows, AccountType.ASSET, 'debit');
    const liabilityLines = toLines(rows, AccountType.LIABILITY, 'credit');
    const equityLines = toLines(rows, AccountType.EQUITY, 'credit');

    const assets = sumLines(assetLines);
    const liabilities = sumLines(liabilityLines);
    const recordedEquity = sumLines(equityLines);

    // All-time net profit through `asOf` — no `from`, i.e. cumulative since the
    // ledger's first posting — stands in for Retained Earnings (see this class's own
    // doc comment on why no formal closing entry exists to populate one).
    const allTimePnl = await this.getProfitAndLoss(organisationId, { to: params.asOf });
    const retainedEarnings = allTimePnl.netProfit;
    const totalEquity = roundCurrency(recordedEquity + retainedEarnings);

    const difference = roundCurrency(assets - (liabilities + totalEquity));

    return {
      asOf: params.asOf,
      assets,
      assetLines,
      liabilities,
      liabilityLines,
      recordedEquity,
      equityLines,
      retainedEarnings,
      totalEquity,
      difference,
      balanced: Math.abs(difference) < 0.01,
    };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toLines(
  rows: Awaited<ReturnType<typeof getAccountBalances>>,
  type: AccountType,
  normalSide: 'debit' | 'credit',
): FinancialStatementLine[] {
  return rows
    .filter((row) => row.type === type)
    .map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount: roundCurrency(normalSide === 'debit' ? row.netBalance : -row.netBalance),
    }));
}

function sumLines(lines: FinancialStatementLine[]): number {
  return roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
