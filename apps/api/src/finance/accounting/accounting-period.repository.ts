import { Injectable } from '@nestjs/common';
import { AccountingPeriod, AccountingPeriodStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the `AccountingPeriod` aggregate (Sprint 7,
 * docs/domains/accounting.md). Overlap prevention and the close-only-from-`OPEN` rule
 * live in `AccountingPeriodService`; this file only knows how to read/write rows.
 */
@Injectable()
export class AccountingPeriodRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AccountingPeriodCreateInput): Promise<AccountingPeriod> {
    return this.prisma.accountingPeriod.create({ data });
  }

  findById(organisationId: string, id: string): Promise<AccountingPeriod | null> {
    return this.prisma.accountingPeriod.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(organisationId: string): Promise<AccountingPeriod[]> {
    return this.prisma.accountingPeriod.findMany({
      where: { organisationId },
      orderBy: { startDate: 'desc' },
    });
  }

  /** Every period for this organisation, used by `AccountingPeriodService`'s overlap
   *  guard — a full table scan is fine at this scale (an organisation has, at most, a
   *  handful of periods per year). */
  findAllByOrganisation(organisationId: string): Promise<AccountingPeriod[]> {
    return this.prisma.accountingPeriod.findMany({ where: { organisationId } });
  }

  /** The single `OPEN` period whose `[startDate, endDate]` (both inclusive) contains
   *  `date` — used by `journal-posting.ts` to resolve where a journal entry belongs.
   *  Returns `null` if no period covers the date, or the covering period is `CLOSED`. */
  findOpenPeriodForDate(organisationId: string, date: Date): Promise<AccountingPeriod | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: {
        organisationId,
        status: AccountingPeriodStatus.OPEN,
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }

  /** Tenant-scoped conditional close — `updateMany` only matches when the period is
   *  currently `OPEN`, closing the race against a concurrent close, same convention as
   *  `InvoiceRepository.updateStatus`. */
  async close(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<AccountingPeriod | null> {
    const result = await this.prisma.accountingPeriod.updateMany({
      where: { id, organisationId, status: AccountingPeriodStatus.OPEN },
      data: {
        status: AccountingPeriodStatus.CLOSED,
        closedAt: new Date(),
        closedById: actorUserId,
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.accountingPeriod.findUniqueOrThrow({ where: { id } });
  }
}
