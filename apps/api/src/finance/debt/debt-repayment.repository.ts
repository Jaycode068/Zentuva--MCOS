import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DebtFacilityStatus, DebtRepayment, DebtScheduleStatus } from '@prisma/client';

import { PostingLineInput, postSystemJournalEntry } from '../accounting/journal-posting';
import { PrismaService } from '../../prisma/prisma.service';
import { computeDebtBalance } from './debt-balance';

export interface CreateDebtRepaymentData {
  organisationId: string;
  debtFacilityId: string;
  cashAccountId: string;
  paymentDate: Date;
  principalAmount: number;
  interestAmount: number;
  feeAmount: number;
  feeExpenseAccountId?: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateDebtRepaymentResult {
  debtRepayment: DebtRepayment;
  wasCreated: boolean;
  facilityStatus: DebtFacilityStatus;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Thin Prisma access + accounting posting for `DebtRepayment` (Sprint 17,
 * docs/domains/debt-management.md §5/§15/§35/§36). Principal, interest, and
 * fees are always posted as separate journal lines — never collapsed into
 * one generic amount. Rejects any repayment exceeding the *live* outstanding
 * principal/interest (computed inside this same transaction, never trusted
 * from the request) — no silent partial acceptance. Applies the combined
 * principal+interest budget to the oldest unpaid `DebtRepaymentSchedule`
 * installment(s) first; auto-transitions the facility to
 * `PARTIALLY_REPAID`/`PAID_OFF` as appropriate — never a manual status flip.
 */
@Injectable()
export class DebtRepaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDebtRepaymentData): Promise<CreateDebtRepaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.debtRepayment.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          const facility = await tx.debtFacility.findUniqueOrThrow({
            where: { id: existing.debtFacilityId },
          });
          return { debtRepayment: existing, wasCreated: false, facilityStatus: facility.status };
        }
      }

      const facility = await tx.debtFacility.findFirst({
        where: { id: data.debtFacilityId, organisationId: data.organisationId },
      });
      if (!facility) {
        throw new NotFoundException('Debt facility not found');
      }
      if (
        facility.status !== DebtFacilityStatus.ACTIVE &&
        facility.status !== DebtFacilityStatus.PARTIALLY_REPAID
      ) {
        throw new BadRequestException(
          'Only an active or partially-repaid facility can receive a repayment',
        );
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: { id: data.cashAccountId, organisationId: data.organisationId },
      });
      if (!cashAccount) {
        throw new NotFoundException('Cash account not found');
      }

      let feeExpenseAccountId: string | undefined;
      if (data.feeAmount > 0) {
        if (!data.feeExpenseAccountId) {
          throw new BadRequestException(
            'feeExpenseAccountId is required when feeAmount is greater than zero',
          );
        }
        const feeAccount = await tx.chartOfAccount.findFirst({
          where: { id: data.feeExpenseAccountId, organisationId: data.organisationId },
        });
        if (!feeAccount) {
          throw new NotFoundException('Fee expense account not found');
        }
        if (feeAccount.type !== 'EXPENSE' || feeAccount.isSystemAccount) {
          throw new BadRequestException('feeExpenseAccountId must be a non-system EXPENSE account');
        }
        feeExpenseAccountId = feeAccount.id;
      }

      // --- §35: never silently allow paying more than what is actually
      // outstanding — computed live, inside this same transaction.
      const balance = await computeDebtBalance(tx, facility.id);
      const TOLERANCE = 0.01;
      if (data.principalAmount > balance.outstandingPrincipal + TOLERANCE) {
        throw new BadRequestException(
          `Principal repayment of ${data.principalAmount} exceeds outstanding principal of ${balance.outstandingPrincipal}`,
        );
      }
      if (data.interestAmount > balance.outstandingInterest + TOLERANCE) {
        throw new BadRequestException(
          `Interest repayment of ${data.interestAmount} exceeds outstanding interest of ${balance.outstandingInterest}`,
        );
      }

      const totalAmount = roundCurrency(
        data.principalAmount + data.interestAmount + data.feeAmount,
      );

      const debtRepayment = await tx.debtRepayment.create({
        data: {
          organisationId: data.organisationId,
          debtFacilityId: data.debtFacilityId,
          cashAccountId: data.cashAccountId,
          paymentDate: data.paymentDate,
          principalAmount: data.principalAmount,
          interestAmount: data.interestAmount,
          feeAmount: data.feeAmount,
          feeExpenseAccountId,
          totalAmount,
          reference: data.reference,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      // --- Apply the combined principal+interest budget to the oldest
      // unpaid schedule installment(s) first.
      let remainingBudget = roundCurrency(data.principalAmount + data.interestAmount);
      if (remainingBudget > 0) {
        const installments = await tx.debtRepaymentSchedule.findMany({
          where: { debtFacilityId: facility.id, status: { not: DebtScheduleStatus.PAID } },
          orderBy: { installmentNumber: 'asc' },
        });
        for (const installment of installments) {
          if (remainingBudget <= 0) break;
          const outstandingOnInstallment = roundCurrency(
            installment.totalDue - installment.amountPaid,
          );
          if (outstandingOnInstallment <= 0) continue;
          const applied = Math.min(remainingBudget, outstandingOnInstallment);
          const newAmountPaid = roundCurrency(installment.amountPaid + applied);
          await tx.debtRepaymentSchedule.update({
            where: { id: installment.id },
            data: {
              amountPaid: newAmountPaid,
              status:
                newAmountPaid >= installment.totalDue - TOLERANCE
                  ? DebtScheduleStatus.PAID
                  : DebtScheduleStatus.PARTIALLY_PAID,
            },
          });
          remainingBudget = roundCurrency(remainingBudget - applied);
        }
      }

      const lines: PostingLineInput[] = [];
      if (data.principalAmount > 0) {
        lines.push({ accountId: facility.liabilityAccountId, debit: data.principalAmount });
      }
      if (data.interestAmount > 0) {
        lines.push({ accountId: facility.interestExpenseAccountId, debit: data.interestAmount });
      }
      if (data.feeAmount > 0 && feeExpenseAccountId) {
        lines.push({ accountId: feeExpenseAccountId, debit: data.feeAmount });
      }
      lines.push({ accountId: cashAccount.linkedChartOfAccountId, credit: totalAmount });

      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.paymentDate,
        description: `Loan repayment — ${facility.name} (${facility.facilityCode})`,
        reference: data.reference,
        sourceType: 'DEBT_REPAYMENT',
        sourceId: debtRepayment.id,
        actorUserId: data.createdById,
        lines,
      });

      // --- §36: early payoff needs no special code path — driving
      // outstanding principal to zero here is what triggers PAID_OFF.
      const balanceAfter = await computeDebtBalance(tx, facility.id);
      let facilityStatus: DebtFacilityStatus = facility.status;
      if (balanceAfter.outstandingPrincipal <= TOLERANCE) {
        facilityStatus = DebtFacilityStatus.PAID_OFF;
        await tx.debtFacility.update({
          where: { id: facility.id },
          data: { status: DebtFacilityStatus.PAID_OFF, closedAt: new Date() },
        });
      } else if (facility.status === DebtFacilityStatus.ACTIVE) {
        facilityStatus = DebtFacilityStatus.PARTIALLY_REPAID;
        await tx.debtFacility.update({
          where: { id: facility.id },
          data: { status: DebtFacilityStatus.PARTIALLY_REPAID },
        });
      }

      return { debtRepayment, wasCreated: true, facilityStatus };
    });
  }
}
