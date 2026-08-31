import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DebtDrawdown, DebtFacilityStatus } from '@prisma/client';

import { postSystemJournalEntry } from '../accounting/journal-posting';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateDebtDrawdownData {
  organisationId: string;
  debtFacilityId: string;
  cashAccountId: string;
  amount: number;
  drawdownDate: Date;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateDebtDrawdownResult {
  debtDrawdown: DebtDrawdown;
  wasCreated: boolean;
  facilityActivated: boolean;
}

/**
 * Thin Prisma access + accounting posting for `DebtDrawdown` (Sprint 17,
 * docs/domains/debt-management.md §4/§13). Posts `DR <cash account's own
 * CoA> / CR <facility's liability account>` — the exact
 * `CashAccountRepository`'s own opening-balance posting shape. Idempotency
 * is checked *before* any business-rule pre-check (the Sprint 9/10 lesson),
 * and `postSystemJournalEntry`'s own `(sourceType, sourceId)` uniqueness is a
 * second, independent layer under that.
 */
@Injectable()
export class DebtDrawdownRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDebtDrawdownData): Promise<CreateDebtDrawdownResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.debtDrawdown.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { debtDrawdown: existing, wasCreated: false, facilityActivated: false };
        }
      }

      const facility = await tx.debtFacility.findFirst({
        where: { id: data.debtFacilityId, organisationId: data.organisationId },
      });
      if (!facility) {
        throw new NotFoundException('Debt facility not found');
      }
      if (
        facility.status !== DebtFacilityStatus.APPROVED &&
        facility.status !== DebtFacilityStatus.ACTIVE
      ) {
        throw new BadRequestException('Only an approved or active facility can be drawn against');
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: { id: data.cashAccountId, organisationId: data.organisationId },
      });
      if (!cashAccount) {
        throw new NotFoundException('Cash account not found');
      }

      const drawnAgg = await tx.debtDrawdown.aggregate({
        where: { debtFacilityId: data.debtFacilityId },
        _sum: { amount: true },
      });
      const totalDrawn = drawnAgg._sum.amount ?? 0;
      if (totalDrawn + data.amount > facility.principalAmount + 0.01) {
        throw new BadRequestException(
          `Drawdown of ${data.amount} would exceed the facility's own principal amount (already drawn: ${totalDrawn}, principal: ${facility.principalAmount})`,
        );
      }

      const debtDrawdown = await tx.debtDrawdown.create({
        data: {
          organisationId: data.organisationId,
          debtFacilityId: data.debtFacilityId,
          cashAccountId: data.cashAccountId,
          amount: data.amount,
          drawdownDate: data.drawdownDate,
          reference: data.reference,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.drawdownDate,
        description: `Loan drawdown — ${facility.name} (${facility.facilityCode})`,
        reference: data.reference,
        sourceType: 'DEBT_DRAWDOWN',
        sourceId: debtDrawdown.id,
        actorUserId: data.createdById,
        lines: [
          { accountId: cashAccount.linkedChartOfAccountId, debit: data.amount },
          { accountId: facility.liabilityAccountId, credit: data.amount },
        ],
      });

      const facilityActivated = facility.status !== DebtFacilityStatus.ACTIVE;
      if (facilityActivated) {
        await tx.debtFacility.update({
          where: { id: facility.id },
          data: { status: DebtFacilityStatus.ACTIVE, activatedAt: new Date() },
        });
      }

      return { debtDrawdown, wasCreated: true, facilityActivated };
    });
  }
}
