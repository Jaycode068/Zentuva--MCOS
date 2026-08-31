import { PrismaClient } from '@prisma/client';

/**
 * Live debt balance computation (Sprint 17, docs/domains/debt-management.md
 * §14 "Debt Balance — Never Stored"). A plain, DI-free function — like
 * `journal-posting.ts` — so it can run either against a top-level
 * `PrismaService` (a read endpoint) or against an in-flight
 * `Prisma.TransactionClient` (validating a drawdown/repayment against the
 * live balance *before* posting, inside the same transaction that will
 * write it). Every figure is derived from `DebtDrawdown`/`DebtRepayment`/
 * `DebtRepaymentSchedule` rows — nothing here is ever cached or stored on
 * `DebtFacility` itself.
 */

type DebtBalanceClient = Pick<
  PrismaClient,
  'debtDrawdown' | 'debtRepayment' | 'debtRepaymentSchedule'
>;

export interface DebtBalance {
  totalDrawn: number;
  outstandingPrincipal: number;
  /** Sum of every schedule installment's `interestDue` with `dueDate ≤ asOf` —
   *  what is contractually due to date, regardless of what has been paid. */
  interestAccrued: number;
  interestPaid: number;
  outstandingInterest: number;
  totalOutstanding: number;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function computeDebtBalance(
  prisma: DebtBalanceClient,
  debtFacilityId: string,
  asOf: Date = new Date(),
): Promise<DebtBalance> {
  const [drawdownAgg, repaymentAgg, accruedSchedule] = await Promise.all([
    prisma.debtDrawdown.aggregate({ where: { debtFacilityId }, _sum: { amount: true } }),
    prisma.debtRepayment.aggregate({
      where: { debtFacilityId },
      _sum: { principalAmount: true, interestAmount: true },
    }),
    prisma.debtRepaymentSchedule.findMany({
      where: { debtFacilityId, dueDate: { lte: asOf } },
      select: { interestDue: true },
    }),
  ]);

  const totalDrawn = roundCurrency(drawdownAgg._sum.amount ?? 0);
  const principalPaid = roundCurrency(repaymentAgg._sum.principalAmount ?? 0);
  const interestPaid = roundCurrency(repaymentAgg._sum.interestAmount ?? 0);
  const outstandingPrincipal = roundCurrency(Math.max(0, totalDrawn - principalPaid));
  const interestAccrued = roundCurrency(
    accruedSchedule.reduce((sum, row) => sum + row.interestDue, 0),
  );
  const outstandingInterest = roundCurrency(Math.max(0, interestAccrued - interestPaid));

  return {
    totalDrawn,
    outstandingPrincipal,
    interestAccrued,
    interestPaid,
    outstandingInterest,
    totalOutstanding: roundCurrency(outstandingPrincipal + outstandingInterest),
  };
}
