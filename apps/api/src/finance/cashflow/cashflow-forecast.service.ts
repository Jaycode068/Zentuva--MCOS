import { Injectable, NotFoundException } from '@nestjs/common';
import { CashAccountStatus, CashflowForecastSourceType, CashflowRecurrence } from '@prisma/client';

import { CashAccountRepository } from '../cash/cash-account.repository';
import { LedgerService } from '../accounting/ledger.service';
import { InvoiceRepository } from '../invoice.repository';
import { SupplierInvoiceRepository } from '../supplier-invoice.repository';
import { CashflowAdjustmentRepository } from './cashflow-adjustment.repository';
import { CashflowItemRepository } from './cashflow-item.repository';
import { CashflowScenarioRepository } from './cashflow-scenario.repository';
import { CashflowSettingsService } from './cashflow-settings.service';

export type CashflowBucketBy = 'weekly' | 'monthly';

export interface ForecastLineItem {
  sourceType: CashflowForecastSourceType;
  sourceId: string;
  description: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amount: number;
  expectedDate: Date;
  confidence: 'CONFIRMED' | 'EXPECTED' | 'ESTIMATED';
  cashAccountId: string | null;
  adjusted: boolean;
}

export interface ForecastBucket {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  belowMinimumReserve: boolean;
  items: ForecastLineItem[];
}

export interface ForecastBreakdownRow {
  sourceType: CashflowForecastSourceType;
  total: number;
}

export interface ForecastResult {
  horizonDays: number;
  bucketBy: CashflowBucketBy;
  scenarioId: string | null;
  cashAccountId: string | null;
  currentCash: number;
  forecastClosingCash: number;
  lowestProjectedCash: number;
  totalExpectedInflows: number;
  totalExpectedOutflows: number;
  minimumCashReserve: number;
  shortfallDetected: boolean;
  buckets: ForecastBucket[];
  inflowBreakdown: ForecastBreakdownRow[];
  outflowBreakdown: ForecastBreakdownRow[];
}

export interface CashAccountForecastRow {
  cashAccountId: string;
  name: string;
  accountCode: string;
  currentBalance: number;
  projectedClosing: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The forecast engine (Sprint 15, docs/domains/cashflow.md) — **never stores
 * anything**; every response is computed live, the same "derive, never store"
 * discipline Sprint 13 (Financial Statements) and Sprint 14 (Book/Reconciled
 * Balance) already established. AR/AP raw material is reused unmodified from
 * `InvoiceRepository`/`SupplierInvoiceRepository.getOutstandingForAging()`
 * (Sprint 13) — zero new AR/AP query code. Never calls `postSystemJournalEntry`
 * and never writes to any table outside its own four models — see
 * `cashflow-independence.spec.ts`.
 */
@Injectable()
export class CashflowForecastService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
    private readonly cashflowItemRepository: CashflowItemRepository,
    private readonly cashflowAdjustmentRepository: CashflowAdjustmentRepository,
    private readonly cashflowScenarioRepository: CashflowScenarioRepository,
    private readonly cashflowSettingsService: CashflowSettingsService,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly ledgerService: LedgerService,
  ) {}

  async getForecast(
    organisationId: string,
    params: {
      horizonDays: number;
      bucketBy: CashflowBucketBy;
      scenarioId?: string;
      cashAccountId?: string;
    },
  ): Promise<ForecastResult> {
    const today = startOfDay(new Date());
    const horizonEnd = addDays(today, params.horizonDays);

    const [settings, scenario, adjustments, rawArLines, rawApLines, forecastItems] =
      await Promise.all([
        this.cashflowSettingsService.getEffective(organisationId),
        params.scenarioId
          ? this.cashflowScenarioRepository.findById(organisationId, params.scenarioId)
          : Promise.resolve(null),
        this.cashflowAdjustmentRepository.findManyByOrganisation(organisationId),
        this.invoiceRepository.getOutstandingForAging(organisationId),
        this.supplierInvoiceRepository.getOutstandingForAging(organisationId),
        this.cashflowItemRepository.findActiveByOrganisation(organisationId),
      ]);

    if (params.scenarioId && !scenario) {
      throw new NotFoundException('Cashflow scenario not found');
    }

    const adjustmentByKey = new Map(
      adjustments.map((adjustment) => [
        `${adjustment.sourceType}:${adjustment.sourceId}`,
        adjustment,
      ]),
    );

    const lines: ForecastLineItem[] = [];

    // --- Accounts Receivable — reused unmodified from Sprint 13's own aging query.
    for (const invoice of rawArLines) {
      if (invoice.amountOutstanding <= 0) continue;
      const adjustment = adjustmentByKey.get(
        `${CashflowForecastSourceType.CUSTOMER_RECEIVABLE}:${invoice.id}`,
      );
      let expectedDate = addDays(
        new Date(Math.max(invoice.dueDate.getTime(), today.getTime())),
        settings.defaultCollectionDelayDays,
      );
      let amount = invoice.amountOutstanding;
      let adjusted = false;
      if (adjustment) {
        if (adjustment.adjustedExpectedDate) expectedDate = adjustment.adjustedExpectedDate;
        if (adjustment.adjustedAmount !== null && adjustment.adjustedAmount !== undefined) {
          amount = adjustment.adjustedAmount;
        }
        adjusted = true;
      }
      lines.push({
        sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
        sourceId: invoice.id,
        description: `Invoice ${invoice.invoiceCode} — ${invoice.customerName}`,
        direction: 'INFLOW',
        amount,
        expectedDate,
        confidence: 'CONFIRMED',
        cashAccountId: null,
        adjusted,
      });
    }

    // --- Accounts Payable — reused unmodified from Sprint 13's own aging query.
    for (const supplierInvoice of rawApLines) {
      if (supplierInvoice.amountOutstanding <= 0) continue;
      const adjustment = adjustmentByKey.get(
        `${CashflowForecastSourceType.SUPPLIER_PAYABLE}:${supplierInvoice.id}`,
      );
      let expectedDate = addDays(
        new Date(Math.max(supplierInvoice.dueDate.getTime(), today.getTime())),
        settings.defaultPaymentDelayDays,
      );
      let amount = supplierInvoice.amountOutstanding;
      let adjusted = false;
      if (adjustment) {
        if (adjustment.adjustedExpectedDate) expectedDate = adjustment.adjustedExpectedDate;
        if (adjustment.adjustedAmount !== null && adjustment.adjustedAmount !== undefined) {
          amount = adjustment.adjustedAmount;
        }
        adjusted = true;
      }
      lines.push({
        sourceType: CashflowForecastSourceType.SUPPLIER_PAYABLE,
        sourceId: supplierInvoice.id,
        description: `Supplier Invoice ${supplierInvoice.invoiceNumber} — ${supplierInvoice.supplierName}`,
        direction: 'OUTFLOW',
        amount,
        expectedDate,
        confidence: 'EXPECTED',
        cashAccountId: null,
        adjusted,
      });
    }

    // --- Management-entered known commitments / recurring items.
    for (const item of forecastItems) {
      const occurrences = expandRecurrence(
        item.expectedDate,
        item.recurrence,
        item.recurrenceEndDate,
        horizonEnd,
      );
      for (const occurrenceDate of occurrences) {
        if (occurrenceDate < today || occurrenceDate > horizonEnd) continue;
        lines.push({
          sourceType: item.sourceType,
          sourceId: item.id,
          description: item.description,
          direction: item.direction,
          amount: item.amount,
          expectedDate: occurrenceDate,
          confidence:
            item.sourceType === CashflowForecastSourceType.RECURRING_ITEM
              ? 'EXPECTED'
              : 'ESTIMATED',
          cashAccountId: item.cashAccountId,
          adjusted: false,
        });
      }
    }

    // --- Scenario adjustment (decision #7) — applied last, on top of any
    // per-item adjustment, and never persisted anywhere.
    if (scenario) {
      for (const line of lines) {
        if (line.direction === 'INFLOW') {
          line.expectedDate = addDays(line.expectedDate, scenario.inflowDelayDays);
          line.amount = roundCurrency(line.amount * scenario.inflowMultiplier);
        } else {
          line.expectedDate = addDays(line.expectedDate, scenario.outflowDelayDays);
          line.amount = roundCurrency(line.amount * scenario.outflowMultiplier);
        }
      }
    }

    // Clamp to the forecast window (a scenario/adjustment could otherwise push a
    // date before today or past the horizon) and, for the per-account view, drop
    // anything not assigned to the requested account (decision #10 — AR/AP is
    // never attributed to a specific account before it's actually collected/paid).
    const windowedLines = lines.filter((line) => {
      if (line.expectedDate < today || line.expectedDate > horizonEnd) return false;
      if (params.cashAccountId) return line.cashAccountId === params.cashAccountId;
      return true;
    });

    const openingBalance = params.cashAccountId
      ? await this.getCashAccountBookBalance(organisationId, params.cashAccountId)
      : await this.getConsolidatedBookBalance(organisationId);

    const buckets = buildBuckets(today, horizonEnd, params.bucketBy);
    let runningOpening = openingBalance;
    for (const bucket of buckets) {
      const bucketLines = windowedLines.filter(
        (line) => line.expectedDate >= bucket.periodStart && line.expectedDate <= bucket.periodEnd,
      );
      const inflows = roundCurrency(
        bucketLines.filter((l) => l.direction === 'INFLOW').reduce((sum, l) => sum + l.amount, 0),
      );
      const outflows = roundCurrency(
        bucketLines.filter((l) => l.direction === 'OUTFLOW').reduce((sum, l) => sum + l.amount, 0),
      );
      bucket.openingBalance = runningOpening;
      bucket.inflows = inflows;
      bucket.outflows = outflows;
      bucket.closingBalance = roundCurrency(runningOpening + inflows - outflows);
      bucket.belowMinimumReserve = bucket.closingBalance < settings.minimumCashReserve;
      bucket.items = bucketLines;
      runningOpening = bucket.closingBalance;
    }

    const totalExpectedInflows = roundCurrency(
      windowedLines.filter((l) => l.direction === 'INFLOW').reduce((sum, l) => sum + l.amount, 0),
    );
    const totalExpectedOutflows = roundCurrency(
      windowedLines.filter((l) => l.direction === 'OUTFLOW').reduce((sum, l) => sum + l.amount, 0),
    );
    const closingBalances = buckets.map((b) => b.closingBalance);
    const lowestProjectedCash = roundCurrency(Math.min(openingBalance, ...closingBalances));

    return {
      horizonDays: params.horizonDays,
      bucketBy: params.bucketBy,
      scenarioId: scenario?.id ?? null,
      cashAccountId: params.cashAccountId ?? null,
      currentCash: openingBalance,
      forecastClosingCash: buckets.length
        ? buckets[buckets.length - 1]!.closingBalance
        : openingBalance,
      lowestProjectedCash,
      totalExpectedInflows,
      totalExpectedOutflows,
      minimumCashReserve: settings.minimumCashReserve,
      shortfallDetected: buckets.some((b) => b.belowMinimumReserve),
      buckets,
      inflowBreakdown: breakdownBySource(windowedLines, 'INFLOW'),
      outflowBreakdown: breakdownBySource(windowedLines, 'OUTFLOW'),
    };
  }

  /** Brief §25 — each active cash account's own current balance and its
   *  projected closing at the horizon end, using only that account's own
   *  assigned `CashflowForecastItem`s (never AR/AP — decision #10). */
  async getCashAccountBreakdown(
    organisationId: string,
    horizonDays: number,
  ): Promise<CashAccountForecastRow[]> {
    const accounts = await this.cashAccountRepository.findManyByOrganisation(organisationId, {
      status: CashAccountStatus.ACTIVE,
    });
    return Promise.all(
      accounts.map(async (account) => {
        const forecast = await this.getForecast(organisationId, {
          horizonDays,
          bucketBy: 'monthly',
          cashAccountId: account.id,
        });
        return {
          cashAccountId: account.id,
          name: account.name,
          accountCode: account.accountCode,
          currentBalance: forecast.currentCash,
          projectedClosing: forecast.forecastClosingCash,
        };
      }),
    );
  }

  private async getCashAccountBookBalance(
    organisationId: string,
    cashAccountId: string,
  ): Promise<number> {
    const account = await this.cashAccountRepository.findById(organisationId, cashAccountId);
    if (!account) {
      throw new NotFoundException('Cash account not found');
    }
    const activity = await this.ledgerService.getAccountActivity(
      organisationId,
      account.linkedChartOfAccountId,
      { to: new Date() },
    );
    return activity.closingBalance;
  }

  private async getConsolidatedBookBalance(organisationId: string): Promise<number> {
    const accounts = await this.cashAccountRepository.findManyByOrganisation(organisationId, {
      status: CashAccountStatus.ACTIVE,
    });
    const balances = await Promise.all(
      accounts.map((account) =>
        this.ledgerService.getAccountActivity(organisationId, account.linkedChartOfAccountId, {
          to: new Date(),
        }),
      ),
    );
    return roundCurrency(balances.reduce((sum, activity) => sum + activity.closingBalance, 0));
  }
}

/** Deterministic occurrence expansion — `ONE_TIME` yields exactly one date;
 *  everything else steps forward by its period from `startDate` until either
 *  `recurrenceEndDate` or `horizonEnd`, whichever is sooner. Exported for direct
 *  unit testing, same convention as this codebase's other small pure helpers
 *  (e.g. `deriveInvoiceStatusAfterApplication`). */
export function expandRecurrence(
  startDate: Date,
  recurrence: CashflowRecurrence,
  recurrenceEndDate: Date | null,
  horizonEnd: Date,
): Date[] {
  if (recurrence === CashflowRecurrence.ONE_TIME) {
    return [startDate];
  }
  const boundary =
    recurrenceEndDate && recurrenceEndDate < horizonEnd ? recurrenceEndDate : horizonEnd;
  const dates: Date[] = [];
  let cursor = new Date(startDate);
  let guard = 0;
  while (cursor <= boundary && guard < 500) {
    dates.push(new Date(cursor));
    cursor = stepRecurrence(cursor, recurrence);
    guard += 1;
  }
  return dates;
}

function stepRecurrence(date: Date, recurrence: CashflowRecurrence): Date {
  const next = new Date(date);
  switch (recurrence) {
    case CashflowRecurrence.WEEKLY:
      next.setDate(next.getDate() + 7);
      return next;
    case CashflowRecurrence.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      return next;
    case CashflowRecurrence.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      return next;
    case CashflowRecurrence.YEARLY:
      next.setFullYear(next.getFullYear() + 1);
      return next;
    default:
      return next;
  }
}

/** Weekly: 7-day buckets from `today`. Monthly: a partial first bucket through
 *  the end of the current month, then one full calendar month per bucket — the
 *  same "This Month" mental model `report-date-range.ts` already uses on the
 *  frontend. Both truncate their final bucket at `horizonEnd`. */
function buildBuckets(today: Date, horizonEnd: Date, bucketBy: CashflowBucketBy): ForecastBucket[] {
  const buckets: ForecastBucket[] = [];
  if (bucketBy === 'weekly') {
    let cursor = today;
    let weekNumber = 1;
    while (cursor <= horizonEnd) {
      const periodEnd = new Date(Math.min(addDays(cursor, 6).getTime(), horizonEnd.getTime()));
      buckets.push(makeBucket(cursor, periodEnd, `Week ${weekNumber}`));
      cursor = addDays(periodEnd, 1);
      weekNumber += 1;
    }
    return buckets;
  }

  let cursor = today;
  while (cursor <= horizonEnd) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const periodEnd = new Date(Math.min(monthEnd.getTime(), horizonEnd.getTime()));
    buckets.push(
      makeBucket(
        cursor,
        periodEnd,
        cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      ),
    );
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return buckets;
}

function makeBucket(periodStart: Date, periodEnd: Date, label: string): ForecastBucket {
  return {
    periodStart,
    periodEnd,
    label,
    openingBalance: 0,
    inflows: 0,
    outflows: 0,
    closingBalance: 0,
    belowMinimumReserve: false,
    items: [],
  };
}

function breakdownBySource(
  lines: ForecastLineItem[],
  direction: 'INFLOW' | 'OUTFLOW',
): ForecastBreakdownRow[] {
  const totals = new Map<CashflowForecastSourceType, number>();
  for (const line of lines) {
    if (line.direction !== direction) continue;
    totals.set(line.sourceType, roundCurrency((totals.get(line.sourceType) ?? 0) + line.amount));
  }
  return [...totals.entries()].map(([sourceType, total]) => ({ sourceType, total }));
}
