import {
  computeFiscalYearRange,
  computeMonthlyPeriods,
  isMonthWithinRange,
  truncateToMonth,
} from './fiscal-year';

describe('computeFiscalYearRange', () => {
  it('a January-start fiscal year spans the calendar year exactly', () => {
    const { startDate, endDate } = computeFiscalYearRange(2026, 1);
    expect(startDate).toEqual(new Date(2026, 0, 1));
    expect(endDate).toEqual(new Date(2026, 11, 31));
  });

  it('an April-start fiscal year spans April through the following March', () => {
    const { startDate, endDate } = computeFiscalYearRange(2026, 4);
    expect(startDate).toEqual(new Date(2026, 3, 1));
    expect(endDate).toEqual(new Date(2027, 2, 31));
  });

  it('a December-start fiscal year still spans exactly 12 months', () => {
    const { startDate, endDate } = computeFiscalYearRange(2026, 12);
    expect(startDate).toEqual(new Date(2026, 11, 1));
    expect(endDate).toEqual(new Date(2027, 10, 30));
  });
});

describe('computeMonthlyPeriods', () => {
  it('returns exactly 12 first-of-month dates for a full fiscal year', () => {
    const { startDate, endDate } = computeFiscalYearRange(2026, 1);
    const periods = computeMonthlyPeriods(startDate, endDate);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual(new Date(2026, 0, 1));
    expect(periods[11]).toEqual(new Date(2026, 11, 1));
  });

  it('handles an offset fiscal year correctly', () => {
    const { startDate, endDate } = computeFiscalYearRange(2026, 4);
    const periods = computeMonthlyPeriods(startDate, endDate);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual(new Date(2026, 3, 1));
    expect(periods[11]).toEqual(new Date(2027, 2, 1));
  });
});

describe('truncateToMonth', () => {
  it("truncates any day within a month to that month's first day", () => {
    expect(truncateToMonth(new Date(2026, 5, 17))).toEqual(new Date(2026, 5, 1));
  });
});

describe('isMonthWithinRange', () => {
  const { startDate, endDate } = computeFiscalYearRange(2026, 1);

  it('accepts a month inside the range', () => {
    expect(isMonthWithinRange(new Date(2026, 5, 1), startDate, endDate)).toBe(true);
  });

  it('accepts the last fiscal month even though endDate is its last calendar day', () => {
    expect(isMonthWithinRange(new Date(2026, 11, 1), startDate, endDate)).toBe(true);
  });

  it('rejects a month before the range', () => {
    expect(isMonthWithinRange(new Date(2025, 11, 1), startDate, endDate)).toBe(false);
  });

  it('rejects a month after the range', () => {
    expect(isMonthWithinRange(new Date(2027, 0, 1), startDate, endDate)).toBe(false);
  });
});
