import { generateSchedule } from './repayment-schedule';

const START = new Date(2026, 0, 1);

describe('generateSchedule — AMORTISING', () => {
  it('produces exactly `tenorMonths` installments for MONTHLY, principal sums exactly, and closes at zero', () => {
    const schedule = generateSchedule({
      principalAmount: 100_000_000,
      interestRatePercent: 20,
      tenorMonths: 24,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });

    expect(schedule).toHaveLength(24);
    const totalPrincipal = schedule.reduce((sum, row) => sum + row.principalDue, 0);
    expect(Math.round(totalPrincipal)).toBe(100_000_000);
    expect(schedule[23]!.closingPrincipal).toBe(0);
    expect(schedule[0]!.openingPrincipal).toBe(100_000_000);
  });

  it('the level payment stays constant while interest declines and principal grows as the balance amortises', () => {
    const schedule = generateSchedule({
      principalAmount: 100_000_000,
      interestRatePercent: 20,
      tenorMonths: 24,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });

    // Every installment except possibly the last (rounding residue) pays the
    // same total each month — the classic amortising-schedule property.
    const payments = schedule.slice(0, 23).map((row) => row.totalDue);
    const distinctPayments = new Set(payments.map((p) => Math.round(p)));
    expect(distinctPayments.size).toBe(1);

    expect(schedule[0]!.interestDue).toBeGreaterThan(schedule[23]!.interestDue);
    expect(schedule[0]!.principalDue).toBeLessThan(schedule[23]!.principalDue);
  });

  it('due dates step one month apart, starting one month after the facility start date', () => {
    const schedule = generateSchedule({
      principalAmount: 12_000_000,
      interestRatePercent: 12,
      tenorMonths: 3,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });
    expect(schedule[0]!.dueDate).toEqual(new Date(2026, 1, 1));
    expect(schedule[1]!.dueDate).toEqual(new Date(2026, 2, 1));
    expect(schedule[2]!.dueDate).toEqual(new Date(2026, 3, 1));
  });
});

describe('generateSchedule — INTEREST_ONLY', () => {
  it('every installment but the last carries zero principal; the last repays it all', () => {
    const schedule = generateSchedule({
      principalAmount: 50_000_000,
      interestRatePercent: 15,
      tenorMonths: 12,
      graceMonths: 0,
      repaymentMethod: 'INTEREST_ONLY',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });

    for (const row of schedule.slice(0, 11)) {
      expect(row.principalDue).toBe(0);
      expect(row.closingPrincipal).toBe(50_000_000);
    }
    expect(schedule[11]!.principalDue).toBe(50_000_000);
    expect(schedule[11]!.closingPrincipal).toBe(0);
    // Interest is constant every period since the balance never reduces early.
    expect(schedule[0]!.interestDue).toBe(schedule[10]!.interestDue);
  });
});

describe('generateSchedule — BULLET', () => {
  it("zero principal until maturity, where the full principal plus that period's interest is due", () => {
    const schedule = generateSchedule({
      principalAmount: 20_000_000,
      interestRatePercent: 18,
      tenorMonths: 6,
      graceMonths: 0,
      repaymentMethod: 'BULLET',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });

    for (const row of schedule.slice(0, 5)) {
      expect(row.principalDue).toBe(0);
    }
    expect(schedule[5]!.principalDue).toBe(20_000_000);
    expect(schedule[5]!.totalDue).toBe(schedule[5]!.principalDue + schedule[5]!.interestDue);
    expect(schedule[5]!.closingPrincipal).toBe(0);
  });
});

describe('generateSchedule — grace period', () => {
  it('grace installments are interest-only with an unchanged balance; amortising resumes afterward', () => {
    const schedule = generateSchedule({
      principalAmount: 100_000_000,
      interestRatePercent: 20,
      tenorMonths: 24,
      graceMonths: 3,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate: START,
    });

    expect(schedule).toHaveLength(24);
    for (const row of schedule.slice(0, 3)) {
      expect(row.principalDue).toBe(0);
      expect(row.closingPrincipal).toBe(100_000_000);
      expect(row.totalDue).toBe(row.interestDue);
    }
    // The 21 post-grace installments still fully amortise the untouched
    // principal, and the schedule still closes at exactly zero.
    expect(schedule[3]!.principalDue).toBeGreaterThan(0);
    expect(schedule[23]!.closingPrincipal).toBe(0);
  });
});

describe('generateSchedule — QUARTERLY/YEARLY frequency', () => {
  it('QUARTERLY produces one installment per 3 months and steps due dates accordingly', () => {
    const schedule = generateSchedule({
      principalAmount: 24_000_000,
      interestRatePercent: 12,
      tenorMonths: 12,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'QUARTERLY',
      startDate: START,
    });
    expect(schedule).toHaveLength(4);
    expect(schedule[0]!.dueDate).toEqual(new Date(2026, 3, 1));
    expect(schedule[3]!.closingPrincipal).toBe(0);
  });

  it('YEARLY produces one installment per 12 months', () => {
    const schedule = generateSchedule({
      principalAmount: 10_000_000,
      interestRatePercent: 10,
      tenorMonths: 36,
      graceMonths: 0,
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'YEARLY',
      startDate: START,
    });
    expect(schedule).toHaveLength(3);
    expect(schedule[2]!.closingPrincipal).toBe(0);
  });
});
