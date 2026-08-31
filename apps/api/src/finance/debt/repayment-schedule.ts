import { RepaymentFrequency, RepaymentMethod } from '@prisma/client';

/**
 * Server-authoritative repayment schedule generation (Sprint 17, docs/
 * domains/debt-management.md "Repayment Schedule"). Pure, dependency-free —
 * the frontend never computes or trusts a schedule figure of its own. Not a
 * full banking-grade interest engine (simple periodic-rate calculation on
 * the opening balance each period), but explicit and documented rather than
 * silently assumed, per the brief's own instruction for the grace period.
 */

export interface ScheduleInstallment {
  installmentNumber: number;
  dueDate: Date;
  openingPrincipal: number;
  principalDue: number;
  interestDue: number;
  totalDue: number;
  closingPrincipal: number;
}

export interface GenerateScheduleParams {
  principalAmount: number;
  /** Annual percentage, e.g. `20` for 20%. */
  interestRatePercent: number;
  tenorMonths: number;
  graceMonths: number;
  repaymentMethod: RepaymentMethod;
  repaymentFrequency: RepaymentFrequency;
  startDate: Date;
}

const MONTHS_PER_PERIOD: Record<RepaymentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

const PERIODS_PER_YEAR: Record<RepaymentFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

/**
 * Generates the full installment table for a facility, from its own
 * `principalAmount` — never recomputed per drawdown (docs/domains/
 * debt-management.md "Repayment Schedule Generation Timing").
 *
 * **Grace period behaviour (explicit, not silently assumed — brief §12):**
 * interest continues to accrue and is due each period during the grace
 * window; no principal is due. After grace ends, the chosen
 * `repaymentMethod` governs the remaining `tenorMonths − graceMonths`.
 */
export function generateSchedule(params: GenerateScheduleParams): ScheduleInstallment[] {
  const monthsPerPeriod = MONTHS_PER_PERIOD[params.repaymentFrequency];
  const periodsPerYear = PERIODS_PER_YEAR[params.repaymentFrequency];
  const periodRate = params.interestRatePercent / 100 / periodsPerYear;

  const totalPeriods = Math.round(params.tenorMonths / monthsPerPeriod);
  const gracePeriods = Math.round(params.graceMonths / monthsPerPeriod);
  const repaymentPeriods = totalPeriods - gracePeriods;

  const installments: ScheduleInstallment[] = [];
  let openingPrincipal = params.principalAmount;

  // --- Grace window: interest-only, no principal due, balance unchanged.
  for (let i = 1; i <= gracePeriods; i++) {
    const interestDue = roundCurrency(openingPrincipal * periodRate);
    installments.push({
      installmentNumber: i,
      dueDate: addMonths(params.startDate, i * monthsPerPeriod),
      openingPrincipal: roundCurrency(openingPrincipal),
      principalDue: 0,
      interestDue,
      totalDue: interestDue,
      closingPrincipal: roundCurrency(openingPrincipal),
    });
  }

  // --- Repayment window, per the chosen method.
  const annuityPayment =
    params.repaymentMethod === 'AMORTISING' && repaymentPeriods > 0
      ? periodRate === 0
        ? openingPrincipal / repaymentPeriods
        : (openingPrincipal * periodRate) / (1 - Math.pow(1 + periodRate, -repaymentPeriods))
      : 0;

  for (let i = 1; i <= repaymentPeriods; i++) {
    const installmentNumber = gracePeriods + i;
    const isLast = i === repaymentPeriods;
    const interestDue = roundCurrency(openingPrincipal * periodRate);

    let principalDue: number;
    if (params.repaymentMethod === 'BULLET') {
      principalDue = isLast ? openingPrincipal : 0;
    } else if (params.repaymentMethod === 'INTEREST_ONLY') {
      principalDue = isLast ? openingPrincipal : 0;
    } else {
      // AMORTISING — the final installment absorbs any rounding residue so
      // closingPrincipal lands on exactly zero, never a stray fraction.
      principalDue = isLast ? openingPrincipal : roundCurrency(annuityPayment - interestDue);
    }
    principalDue = roundCurrency(Math.max(0, Math.min(principalDue, openingPrincipal)));

    const closingPrincipal = roundCurrency(openingPrincipal - principalDue);
    installments.push({
      installmentNumber,
      dueDate: addMonths(params.startDate, installmentNumber * monthsPerPeriod),
      openingPrincipal: roundCurrency(openingPrincipal),
      principalDue,
      interestDue,
      totalDue: roundCurrency(principalDue + interestDue),
      closingPrincipal,
    });
    openingPrincipal = closingPrincipal;
  }

  return installments;
}
