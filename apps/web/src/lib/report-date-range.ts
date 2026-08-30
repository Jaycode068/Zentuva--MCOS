/**
 * Period-preset → concrete `{from, to}` date range (Sprint 13, docs/domains/
 * accounting.md §16.5) — a purely client-side computation, reused by every new
 * report page's filter row. Deliberately no backend contract change: every report
 * endpoint keeps accepting plain `from`/`to`/`accountingPeriodId` query params
 * exactly as `getLedger`/`getTrialBalance` already did before this sprint.
 */
export type ReportPeriodPreset =
  'today' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom';

export const REPORT_PERIOD_PRESET_LABELS: Record<ReportPeriodPreset, string> = {
  today: 'Today',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  this_year: 'This Year',
  custom: 'Custom Range',
};

export interface ReportDateRange {
  from: Date;
  to: Date;
}

/** `to` is always the range's *last inclusive day*, end-of-day — matches how every
 *  existing `from`/`to` filter in this codebase (Ledger, Trial Balance) already
 *  treats its own `to` bound (`lte`, not `lt`). */
export function resolveReportDateRange(
  preset: ReportPeriodPreset,
  now: Date = new Date(),
): ReportDateRange {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'this_month':
      return { from: new Date(year, month, 1), to: endOfDay(new Date(year, month + 1, 0)) };
    case 'last_month':
      return { from: new Date(year, month - 1, 1), to: endOfDay(new Date(year, month, 0)) };
    case 'this_quarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        from: new Date(year, quarterStartMonth, 1),
        to: endOfDay(new Date(year, quarterStartMonth + 3, 0)),
      };
    }
    case 'this_year':
      return { from: new Date(year, 0, 1), to: endOfDay(new Date(year, 11, 31)) };
    case 'custom':
      // The caller supplies its own from/to when `custom` is selected — this default
      // (this month) is only ever a starting point before the user picks dates.
      return { from: new Date(year, month, 1), to: endOfDay(new Date(year, month + 1, 0)) };
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}
