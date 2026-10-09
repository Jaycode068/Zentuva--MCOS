/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Reporting Periods"). Resolves a reporting-period preset into concrete UTC instants
 * bounding the Organisation's own LOCAL calendar period — using the exact same
 * `Intl.DateTimeFormat` day-bucketing technique `hr-attendance-date.util.ts`
 * (`resolveAttendanceDate`) already established for `Organisation.timeZone`, extended
 * here from a single day to an arbitrary calendar period. No new timezone model or
 * library is introduced (brief §9 — reuse the existing `Organisation.timeZone`
 * configuration, never a parallel one).
 *
 * **Boundary semantics, deliberately different from the pre-existing, browser-local
 * `apps/web/src/lib/report-date-range.ts`** (which is client-side-only and used by the
 * Finance report pages that predate this sprint, left unchanged): every period here is
 * `[from, to)` — an inclusive start instant and an EXCLUSIVE end instant — so a caller
 * never needs to reason about "end of day" millisecond rounding, and two adjacent
 * periods (e.g. "this month" and "last month") never overlap or leave a gap at the
 * boundary. Every consumer in this module uses `gte`/`lt`, never `lte`, against `to`.
 */

export type ReportingPeriodPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'custom';

export const REPORTING_PERIOD_PRESETS: ReportingPeriodPreset[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'custom',
];

export type ComparisonMode = 'previous_period' | 'previous_year' | 'none';

export interface ResolvedPeriod {
  /** Inclusive start instant (UTC). */
  from: Date;
  /** Exclusive end instant (UTC) — never included in the period itself. */
  to: Date;
}

/** The organisation-local calendar date parts (year/month 0-indexed/day) for `instant`
 *  — used to build month/quarter/year boundaries without re-parsing a formatted
 *  string for each field. */
function localDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
  };
}

/** Builds the real UTC instant corresponding to LOCAL midnight on the given
 *  organisation-local `(year, month, day)` in `timeZone`. Technique: take a naive UTC
 *  guess for that calendar date, read back what wall-clock date+time `timeZone` itself
 *  shows at that exact instant, and the difference between that reading and the guess
 *  (re-interpreted as a UTC timestamp) IS the timezone's offset at that moment —
 *  subtracting it from the guess yields the true instant. This computes the full
 *  offset directly from wall-clock readback rather than assuming a whole-day shift, so
 *  it is correct for every offset shape (sub-day, e.g. UTC+1, and day-rolling, e.g.
 *  UTC-10) without hardcoding any IANA rule — the one thing `Intl.DateTimeFormat`
 *  already knows and a bespoke date library would otherwise have to duplicate. */
function fromLocalDate(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month, day));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(guess).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const localReadAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = localReadAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/** One calendar day in the organisation's local timezone, expressed as the real UTC
 *  instant of that local day's midnight. */
function localMidnightUtc(instant: Date, timeZone: string): Date {
  const { year, month, day } = localDateParts(instant, timeZone);
  return fromLocalDate(year, month, day, timeZone);
}

function addDaysLocal(date: Date, days: number, timeZone: string): Date {
  const { year, month, day } = localDateParts(date, timeZone);
  // `Date.UTC` normalizes an out-of-range day (e.g. day 32) into the next month —
  // exactly the arithmetic a calendar-day offset needs.
  const shifted = new Date(Date.UTC(year, month, day + days));
  return fromLocalDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    timeZone,
  );
}

/** ISO-8601 week (Monday start) — ergonomically the convention most reporting tools
 *  and this organisation's own HR attendance week-planning already assume. */
function startOfWeekLocal(instant: Date, timeZone: string): Date {
  const dayStart = localMidnightUtc(instant, timeZone);
  // `getUTCDay()` on a UTC-midnight instant reflects the organisation-local weekday
  // correctly, since `dayStart` already IS that local midnight re-expressed in UTC.
  const isoWeekday = ((dayStart.getUTCDay() + 6) % 7) + 1; // Mon=1 .. Sun=7
  return addDaysLocal(dayStart, -(isoWeekday - 1), timeZone);
}

/**
 * Resolves a preset into `[from, to)` UTC instants bounding the organisation-local
 * calendar period. `custom` requires the caller's own `customFrom`/`customTo` — both
 * validated upstream (see `reporting.ts` Zod schema) before reaching here.
 */
export function resolveReportingPeriod(
  preset: ReportingPeriodPreset,
  timeZone: string,
  now: Date = new Date(),
  custom?: { from: Date; to: Date },
): ResolvedPeriod {
  const todayStart = localMidnightUtc(now, timeZone);
  const { year, month } = localDateParts(now, timeZone);

  switch (preset) {
    case 'today':
      return { from: todayStart, to: addDaysLocal(todayStart, 1, timeZone) };
    case 'yesterday': {
      const start = addDaysLocal(todayStart, -1, timeZone);
      return { from: start, to: todayStart };
    }
    case 'this_week': {
      const start = startOfWeekLocal(now, timeZone);
      return { from: start, to: addDaysLocal(start, 7, timeZone) };
    }
    case 'last_week': {
      const thisWeekStart = startOfWeekLocal(now, timeZone);
      const start = addDaysLocal(thisWeekStart, -7, timeZone);
      return { from: start, to: thisWeekStart };
    }
    case 'this_month': {
      const start = fromLocalDate(year, month, 1, timeZone);
      const end = fromLocalDate(year, month + 1, 1, timeZone);
      return { from: start, to: end };
    }
    case 'last_month': {
      const start = fromLocalDate(year, month - 1, 1, timeZone);
      const end = fromLocalDate(year, month, 1, timeZone);
      return { from: start, to: end };
    }
    case 'this_quarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = fromLocalDate(year, quarterStartMonth, 1, timeZone);
      const end = fromLocalDate(year, quarterStartMonth + 3, 1, timeZone);
      return { from: start, to: end };
    }
    case 'last_quarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = fromLocalDate(year, quarterStartMonth - 3, 1, timeZone);
      const end = fromLocalDate(year, quarterStartMonth, 1, timeZone);
      return { from: start, to: end };
    }
    case 'this_year': {
      const start = fromLocalDate(year, 0, 1, timeZone);
      const end = fromLocalDate(year + 1, 0, 1, timeZone);
      return { from: start, to: end };
    }
    case 'last_year': {
      const start = fromLocalDate(year - 1, 0, 1, timeZone);
      const end = fromLocalDate(year, 0, 1, timeZone);
      return { from: start, to: end };
    }
    case 'custom': {
      if (!custom) {
        throw new Error('resolveReportingPeriod("custom") requires a custom {from, to} range.');
      }
      return { from: custom.from, to: custom.to };
    }
  }
}

/**
 * The comparison period for `current` — either the immediately preceding period of
 * identical length (`previous_period`, matching `FinancialStatementService
 * .getProfitAndLossComparison`'s own established semantics) or the same calendar
 * window one year earlier (`previous_year`). Returns `null` for `'none'` — the
 * frontend/caller must render "no comparison" rather than a misleading zero (brief
 * §9/§11); this function never fabricates a baseline.
 */
export function resolveComparisonPeriod(
  current: ResolvedPeriod,
  mode: ComparisonMode,
  timeZone: string,
): ResolvedPeriod | null {
  if (mode === 'none') {
    return null;
  }
  if (mode === 'previous_year') {
    const fromParts = localDateParts(current.from, timeZone);
    const toParts = localDateParts(current.to, timeZone);
    return {
      from: fromLocalDate(fromParts.year - 1, fromParts.month, fromParts.day, timeZone),
      to: fromLocalDate(toParts.year - 1, toParts.month, toParts.day, timeZone),
    };
  }
  // previous_period: the immediately preceding period of the exact same duration.
  const durationMs = current.to.getTime() - current.from.getTime();
  return {
    from: new Date(current.from.getTime() - durationMs),
    to: current.from,
  };
}

/**
 * Safe percentage-change calculation (brief §9 "do not display misleading percentage
 * changes when the baseline is zero or undefined"). Returns `null` — never `NaN`/
 * `Infinity`/a fabricated number — whenever `previous` is `0` or either input is
 * `null`/`undefined`. A `null` result means the frontend must render "No comparison
 * data," never "0%" or "—%" silently implying no change.
 */
export function calculatePercentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current == null || previous == null || previous === 0) {
    return null;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100;
}
