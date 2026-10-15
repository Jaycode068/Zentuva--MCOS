import {
  computeCurrentMonthPeriodBounds,
  decideAccountingPeriodAction,
} from './seed-accounting-period';

const july2026 = {
  name: 'July 2026',
  startDate: new Date('2026-07-01'),
  endDate: new Date('2026-07-31'),
  status: 'OPEN' as const,
};
const august2026 = {
  name: 'August 2026',
  startDate: new Date('2026-08-01'),
  endDate: new Date('2026-08-31'),
  status: 'OPEN' as const,
};

describe('seed-accounting-period (pure decision logic — no database connection)', () => {
  describe('computeCurrentMonthPeriodBounds', () => {
    it('computes inclusive first/last day of the given month, anchored to UTC midnight', () => {
      const result = computeCurrentMonthPeriodBounds(new Date('2026-10-14T22:00:00Z'));
      expect(result.name).toBe('October 2026');
      expect(result.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    });

    it('handles a 30-day month correctly', () => {
      const result = computeCurrentMonthPeriodBounds(new Date('2026-09-10T00:00:00Z'));
      expect(result.endDate.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });

    // The host machine's local timezone must not shift the computed UTC boundary — this
    // is exactly the bug the UTC-anchoring fixes (a local-midnight construction would
    // have produced a different instant depending on where this test runs).
    it('produces the same instant regardless of a date passed with a late-day local time', () => {
      const result = computeCurrentMonthPeriodBounds(new Date('2026-10-14T23:59:59.999Z'));
      expect(result.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });

    // Stage 4E.2 regression coverage — reproduces, under a real non-UTC process
    // timezone, the exact one-hour-early shift confirmed in
    // docs/sprint-stage-4e2-payables-reconciliation-and-period-boundary-investigation.md:
    // `new Date(year, month, day)` (the LOCAL multi-argument constructor) on a UTC+1
    // host produces `...T23:00:00.000Z` for a date whose intended boundary is
    // `...T00:00:00.000Z`. `computeCurrentMonthPeriodBounds` itself uses `Date.UTC(...)`
    // exclusively and must remain immune to this regardless of `process.env.TZ` — this
    // test would fail if that ever regressed back to a local-time construction.
    describe('under a non-UTC process timezone (Africa/Lagos, UTC+1)', () => {
      const originalTz = process.env.TZ;

      beforeEach(() => {
        process.env.TZ = 'Africa/Lagos';
      });

      afterEach(() => {
        if (originalTz === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTz;
        }
      });

      it('still anchors to UTC midnight, immune to the host timezone', () => {
        // Sanity-check that the TZ override is actually in effect for this test run —
        // if this assertion ever fails, the test below would be a false negative, not
        // a true confirmation of timezone-independence.
        expect(new Date().getTimezoneOffset()).toBe(-60);

        const result = computeCurrentMonthPeriodBounds(new Date('2026-10-14T12:00:00Z'));
        expect(result.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
        expect(result.endDate.toISOString()).toBe('2026-10-31T00:00:00.000Z');
      });

      it('demonstrates the exact bug this function avoids, for contrast — the LOCAL constructor would have shifted by one hour', () => {
        const unsafeConstruction = new Date(2026, 9, 1); // local multi-arg constructor, NOT used by the real function
        expect(unsafeConstruction.toISOString()).toBe('2026-09-30T23:00:00.000Z');
        expect(unsafeConstruction.toISOString()).not.toBe('2026-10-01T00:00:00.000Z');
      });
    });
  });

  describe('decideAccountingPeriodAction', () => {
    // Scenario 1 — fresh database with only the two historical periods, seeding in a
    // month neither covers.
    it('creates a new period when only the historical July/August periods exist and today is outside both', () => {
      const today = new Date('2026-10-14T12:00:00Z');
      const decision = decideAccountingPeriodAction(today, [july2026, august2026]);
      expect(decision.action).toBe('create');
      if (decision.action === 'create') {
        expect(decision.period.name).toBe('October 2026');
        expect(decision.period.status).toBe('OPEN');
      }
    });

    // Scenario 2 — current month not yet covered (same as above, stated as its own case
    // per the brief's required scenario list).
    it('creates a period for the current month when nothing covers it', () => {
      const today = new Date('2026-11-05T00:00:00Z');
      const decision = decideAccountingPeriodAction(today, [july2026, august2026]);
      expect(decision.action).toBe('create');
    });

    // Scenario 3 — current month already covered by an OPEN period (e.g. seeding
    // genuinely happens in August, or a previous run already created October's period).
    it('does nothing when today is already covered by an OPEN period (August, historical)', () => {
      const today = new Date('2026-08-15T00:00:00Z');
      const decision = decideAccountingPeriodAction(today, [july2026, august2026]);
      expect(decision).toEqual({ action: 'none' });
    });

    it('does nothing when today is covered by a previously-seeded current-month period', () => {
      const october2026 = {
        name: 'October 2026',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-31'),
        status: 'OPEN' as const,
      };
      const today = new Date('2026-10-14T12:00:00Z');
      const decision = decideAccountingPeriodAction(today, [july2026, august2026, october2026]);
      expect(decision).toEqual({ action: 'none' });
    });

    // Scenario 4 — current month covered by a CLOSED period: must fail with a clear
    // explanation, never reopen it automatically.
    it('errors, without reopening, when today is covered by a CLOSED period', () => {
      const closedJuly = { ...july2026, status: 'CLOSED' as const };
      const today = new Date('2026-07-20T00:00:00Z');
      const decision = decideAccountingPeriodAction(today, [closedJuly, august2026]);
      expect(decision.action).toBe('error');
      if (decision.action === 'error') {
        expect(decision.message).toContain('CLOSED');
        expect(decision.message).toContain('Refusing to reopen');
      }
    });

    // Scenario 5 — repeated execution: running the decision twice in the same month,
    // feeding the second call the period the first call would have created, must be a
    // no-op the second time — this IS the idempotency guarantee.
    it('is idempotent across repeated executions within the same month', () => {
      const today = new Date('2026-10-14T12:00:00Z');
      const firstRun = decideAccountingPeriodAction(today, [july2026, august2026]);
      expect(firstRun.action).toBe('create');
      if (firstRun.action !== 'create') {
        throw new Error('expected create');
      }
      const periodsAfterFirstRun = [
        july2026,
        august2026,
        {
          name: firstRun.period.name,
          startDate: firstRun.period.startDate,
          endDate: firstRun.period.endDate,
          status: 'OPEN' as const,
        },
      ];
      const secondRun = decideAccountingPeriodAction(today, periodsAfterFirstRun);
      expect(secondRun).toEqual({ action: 'none' });
    });

    // Scenario 6 — overlap prevention: an existing (non-historical, non-today-covering)
    // period that would overlap the proposed new period must block creation rather than
    // silently creating two overlapping periods.
    it('errors rather than creating an overlapping period', () => {
      // A period for "late October" that does not itself cover `today` but DOES overlap
      // the monthly bounds decideAccountingPeriodAction would otherwise create.
      const lateOctoberOnly = {
        name: 'Late October 2026 (manual)',
        startDate: new Date('2026-10-20'),
        endDate: new Date('2026-11-05'),
        status: 'OPEN' as const,
      };
      const today = new Date('2026-10-14T12:00:00Z'); // not covered by lateOctoberOnly, but the month IS
      const decision = decideAccountingPeriodAction(today, [july2026, august2026, lateOctoberOnly]);
      expect(decision.action).toBe('error');
      if (decision.action === 'error') {
        expect(decision.message).toContain('overlap');
      }
    });

    it('never proposes modifying or removing any existing period — only "none", "create", or "error"', () => {
      const today = new Date('2026-10-14T12:00:00Z');
      const decision = decideAccountingPeriodAction(today, [july2026, august2026]);
      expect(['none', 'create', 'error']).toContain(decision.action);
    });
  });
});
