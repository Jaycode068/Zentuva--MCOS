/**
 * Fiscal-year date math (Sprint 16, docs/domains/budgeting.md §11). Pure,
 * dependency-free functions — `Organisation.fiscalYearStart` (1-12, default 1
 * = January, added Sprint 3.4 but never consumed by any domain before this
 * sprint) is the single source of truth every `Budget` is computed against.
 */

export interface FiscalYearRange {
  startDate: Date;
  endDate: Date;
}

/**
 * `fiscalYear: 2026, fiscalYearStartMonth: 1` → 2026-01-01..2026-12-31.
 * `fiscalYear: 2026, fiscalYearStartMonth: 4` → 2026-04-01..2027-03-31 — a
 * fiscal year is always named for the calendar year it *starts* in, spans
 * exactly 12 months, and `endDate` is computed as "day 0 of the month after
 * the 12th month," i.e. the last calendar day of that 12th month.
 */
export function computeFiscalYearRange(
  fiscalYear: number,
  fiscalYearStartMonth: number,
): FiscalYearRange {
  const startDate = new Date(fiscalYear, fiscalYearStartMonth - 1, 1);
  const endDate = new Date(fiscalYear + 1, fiscalYearStartMonth - 1, 0);
  return { startDate, endDate };
}

/** The 12 first-of-month `Date`s spanning `[startDate, endDate]` — always
 *  exactly 12 for a well-formed fiscal-year range from `computeFiscalYearRange`,
 *  but computed generically (steps until past `endDate`) rather than hardcoded
 *  to a literal loop of 12, so a caller passing any other well-formed range
 *  still gets a correct result. */
export function computeMonthlyPeriods(startDate: Date, endDate: Date): Date[] {
  const periods: Date[] = [];
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cursor <= endDate) {
    periods.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return periods;
}

/** Truncates any date to the first day of its month — the canonical form
 *  every `BudgetLine.periodMonth` is stored/compared as. */
export function truncateToMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** `true` when `month` (any day within it) falls inside `[startDate, endDate]`,
 *  compared at month granularity — a budget line dated anywhere in the last
 *  fiscal month is still valid even though `endDate` itself is that month's
 *  last calendar day, not its first. */
export function isMonthWithinRange(month: Date, startDate: Date, endDate: Date): boolean {
  const truncated = truncateToMonth(month).getTime();
  return (
    truncated >= truncateToMonth(startDate).getTime() &&
    truncated <= truncateToMonth(endDate).getTime()
  );
}
