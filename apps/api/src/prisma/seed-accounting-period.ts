/**
 * Pure decision logic for `seedAccountingPeriods()` (prisma/seed.ts) — extracted so it's
 * independently unit-testable (no database connection), mirroring the existing
 * `db-identity-guard.ts` pattern. `seed.ts` itself only calls this with real data and
 * applies the resulting decision via Prisma; no accounting-domain rule lives here that
 * isn't already expressed by the `AccountingPeriod` model.
 *
 * Context: `seedAccountingPeriods()` originally created exactly two hardcoded periods
 * (July and August 2026). Any seed step that posts a journal entry dated at the actual
 * seed-execution time (`new Date()` — Sales Fulfilments, Cashflow fixtures) failed with
 * "no open accounting period covers <today>" whenever the system clock fell outside that
 * fixed window — confirmed in the Stage 3A/3B.1 preflight. This module adds exactly one
 * additional period, covering the real seed-run date, computed dynamically rather than
 * hardcoded — nothing else about the two historical periods changes.
 */

export interface AccountingPeriodSnapshot {
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'OPEN' | 'CLOSED';
}

export interface AccountingPeriodToCreate {
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'OPEN';
}

export type AccountingPeriodDecision =
  | { action: 'none' }
  | { action: 'create'; period: AccountingPeriodToCreate }
  | { action: 'error'; message: string };

/**
 * Inclusive first/last-day-of-month bounds for `now`, at day granularity, anchored to
 * UTC midnight — the same convention the existing hardcoded periods already use (e.g.
 * "July 2026": `new Date('2026-07-01')`, which the ISO-date-string form always parses
 * as UTC midnight). Using the local-timezone `Date(year, month, day)` constructor here
 * instead would shift the stored boundary by the host's UTC offset relative to every
 * other period in the table — not a new convention, just matching the existing one
 * precisely.
 */
export function computeCurrentMonthPeriodBounds(now: Date): {
  name: string;
  startDate: Date;
  endDate: Date;
} {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const name = startDate.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { name, startDate, endDate };
}

/**
 * Given the current date and the FULL list of an organisation's existing accounting
 * periods, decides what `seedAccountingPeriods()` should do:
 *  - `'none'` — a period already covers `now` and is OPEN. This is the repeated-execution
 *    idempotency guarantee: a second seed run in the same month does nothing here.
 *  - `'create'` — no period covers `now` and creating one would not overlap any existing
 *    period. The returned period is always OPEN, for the current calendar month only.
 *  - `'error'` — a period covers `now` but is CLOSED (this function never reopens it —
 *    reopening a closed period is a financial-control action, not something a seed
 *    script may do automatically), or creating the new period would overlap an existing
 *    one. Either way, the caller must stop and report rather than proceed.
 *
 * Never modifies, closes, or reopens any existing period — only ever decides whether to
 * create a new, additional one.
 */
export function decideAccountingPeriodAction(
  now: Date,
  existingPeriods: AccountingPeriodSnapshot[],
): AccountingPeriodDecision {
  const covering = existingPeriods.find((p) => p.startDate <= now && p.endDate >= now);
  if (covering) {
    if (covering.status === 'CLOSED') {
      return {
        action: 'error',
        message:
          `seedAccountingPeriods: the period covering today (${now.toISOString().slice(0, 10)}) — "${covering.name}" — is CLOSED. ` +
          'Refusing to reopen it automatically. Resolve this manually before seeding.',
      };
    }
    return { action: 'none' };
  }

  const { name, startDate, endDate } = computeCurrentMonthPeriodBounds(now);
  const overlapping = existingPeriods.find((p) => p.startDate <= endDate && p.endDate >= startDate);
  if (overlapping) {
    return {
      action: 'error',
      message:
        `seedAccountingPeriods: cannot create a period for ${name} — it would overlap existing period "${overlapping.name}" ` +
        `(${overlapping.startDate.toISOString().slice(0, 10)} to ${overlapping.endDate.toISOString().slice(0, 10)}).`,
    };
  }

  return { action: 'create', period: { name, startDate, endDate, status: 'OPEN' } };
}
