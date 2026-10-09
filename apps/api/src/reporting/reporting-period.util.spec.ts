import {
  calculatePercentChange,
  resolveComparisonPeriod,
  resolveReportingPeriod,
} from './reporting-period.util';

const UTC = 'UTC';
const LAGOS = 'Africa/Lagos'; // UTC+1, no DST — a realistic non-UTC organisation.

describe('resolveReportingPeriod', () => {
  it('today: [local midnight, next local midnight)', () => {
    const now = new Date('2026-03-15T10:30:00.000Z');
    const { from, to } = resolveReportingPeriod('today', UTC, now);
    expect(from.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-16T00:00:00.000Z');
  });

  it('today in a non-UTC timezone shifts the boundary by the offset', () => {
    // 2026-03-15T23:30 Lagos (UTC+1) is 2026-03-15T22:30 UTC — still March 15 locally.
    const now = new Date('2026-03-15T22:30:00.000Z');
    const { from, to } = resolveReportingPeriod('today', LAGOS, now);
    expect(from.toISOString()).toBe('2026-03-14T23:00:00.000Z'); // local midnight Mar 15
    expect(to.toISOString()).toBe('2026-03-15T23:00:00.000Z'); // local midnight Mar 16
  });

  it('yesterday is the day immediately before today, never overlapping it', () => {
    const now = new Date('2026-03-15T10:00:00.000Z');
    const today = resolveReportingPeriod('today', UTC, now);
    const yesterday = resolveReportingPeriod('yesterday', UTC, now);
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
    expect(yesterday.from.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('this_week starts on Monday (ISO week) and covers exactly 7 days', () => {
    const now = new Date('2026-03-18T12:00:00.000Z'); // a Wednesday
    const { from, to } = resolveReportingPeriod('this_week', UTC, now);
    expect(from.toISOString()).toBe('2026-03-16T00:00:00.000Z'); // Monday
    expect(to.toISOString()).toBe('2026-03-23T00:00:00.000Z'); // next Monday
  });

  it('last_week immediately precedes this_week with no gap or overlap', () => {
    const now = new Date('2026-03-18T12:00:00.000Z');
    const thisWeek = resolveReportingPeriod('this_week', UTC, now);
    const lastWeek = resolveReportingPeriod('last_week', UTC, now);
    expect(lastWeek.to.getTime()).toBe(thisWeek.from.getTime());
    expect(lastWeek.from.toISOString()).toBe('2026-03-09T00:00:00.000Z');
  });

  it('this_month covers the full calendar month, to is exclusive (1st of next month)', () => {
    const now = new Date('2026-02-10T12:00:00.000Z');
    const { from, to } = resolveReportingPeriod('this_month', UTC, now);
    expect(from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('last_month handles a January "now" by rolling back to December of the prior year', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const { from, to } = resolveReportingPeriod('last_month', UTC, now);
    expect(from.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('this_quarter resolves the correct 3-month block', () => {
    const now = new Date('2026-08-15T12:00:00.000Z'); // Q3
    const { from, to } = resolveReportingPeriod('this_quarter', UTC, now);
    expect(from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('last_quarter handles a Q1 "now" by rolling back into Q4 of the prior year', () => {
    const now = new Date('2026-02-15T12:00:00.000Z'); // Q1
    const { from, to } = resolveReportingPeriod('last_quarter', UTC, now);
    expect(from.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('this_year / last_year cover full calendar years', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(resolveReportingPeriod('this_year', UTC, now)).toEqual({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(resolveReportingPeriod('last_year', UTC, now)).toEqual({
      from: new Date('2025-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('custom passes the caller-supplied range through unchanged', () => {
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-10T00:00:00.000Z');
    expect(resolveReportingPeriod('custom', UTC, new Date(), { from, to })).toEqual({ from, to });
  });

  it('custom throws without a supplied range rather than silently defaulting', () => {
    expect(() => resolveReportingPeriod('custom', UTC)).toThrow();
  });
});

describe('resolveComparisonPeriod', () => {
  it('"none" returns null — never a fabricated baseline', () => {
    const current = resolveReportingPeriod('this_month', UTC, new Date('2026-03-15T00:00:00Z'));
    expect(resolveComparisonPeriod(current, 'none', UTC)).toBeNull();
  });

  it('previous_period is the immediately preceding period of identical length', () => {
    const current = resolveReportingPeriod('this_month', UTC, new Date('2026-03-15T00:00:00Z'));
    const previous = resolveComparisonPeriod(current, 'previous_period', UTC);
    expect(previous!.to.getTime()).toBe(current.from.getTime());
    expect(previous!.to.getTime() - previous!.from.getTime()).toBe(
      current.to.getTime() - current.from.getTime(),
    );
  });

  it('previous_year is the same calendar window exactly one year earlier', () => {
    const current = resolveReportingPeriod('this_month', UTC, new Date('2026-03-15T00:00:00Z'));
    const previous = resolveComparisonPeriod(current, 'previous_year', UTC);
    expect(previous).toEqual({
      from: new Date('2025-03-01T00:00:00.000Z'),
      to: new Date('2025-04-01T00:00:00.000Z'),
    });
  });
});

describe('calculatePercentChange', () => {
  it('computes a normal positive change', () => {
    expect(calculatePercentChange(150, 100)).toBe(50);
  });

  it('computes a normal negative change', () => {
    expect(calculatePercentChange(50, 100)).toBe(-50);
  });

  it('returns null when the baseline is zero — never Infinity/NaN', () => {
    expect(calculatePercentChange(100, 0)).toBeNull();
  });

  it('returns null when either input is null or undefined', () => {
    expect(calculatePercentChange(null, 100)).toBeNull();
    expect(calculatePercentChange(100, undefined)).toBeNull();
    expect(calculatePercentChange(undefined, undefined)).toBeNull();
  });

  it('handles a negative baseline using its absolute value as the denominator', () => {
    // current=-50, previous=-100: improved by 50% of the |baseline|.
    expect(calculatePercentChange(-50, -100)).toBe(50);
  });

  it('returns 0 (not null) when current equals a non-zero previous', () => {
    expect(calculatePercentChange(100, 100)).toBe(0);
  });
});
