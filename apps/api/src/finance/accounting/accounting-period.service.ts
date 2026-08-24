import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountingPeriod, AccountingPeriodStatus } from '@prisma/client';
import { CreateAccountingPeriodInput } from '@zentuva/validation';

import { AccountingPeriodRepository } from './accounting-period.repository';

/**
 * Domain service for the `AccountingPeriod` aggregate (Sprint 7,
 * docs/domains/accounting.md). A closed period is a one-way action this sprint — no
 * re-opening, no year-end closing automation, per the brief.
 */
@Injectable()
export class AccountingPeriodService {
  constructor(private readonly accountingPeriodRepository: AccountingPeriodRepository) {}

  getById(organisationId: string, id: string): Promise<AccountingPeriod> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string): Promise<AccountingPeriod[]> {
    return this.accountingPeriodRepository.findManyByOrganisation(organisationId);
  }

  /** Rejects a range that overlaps any existing period for this organisation —
   *  service-level guard (no Postgres range-exclusion constraint precedent in this
   *  schema). Two ranges `[a,b]`/`[c,d]` overlap iff `a <= d && c <= b`. */
  async create(
    organisationId: string,
    input: CreateAccountingPeriodInput,
    actorUserId: string,
  ): Promise<AccountingPeriod> {
    const existingPeriods =
      await this.accountingPeriodRepository.findAllByOrganisation(organisationId);
    const overlapping = existingPeriods.find(
      (period) => input.startDate <= period.endDate && period.startDate <= input.endDate,
    );
    if (overlapping) {
      throw new BadRequestException(
        `This range overlaps the existing period "${overlapping.name}"`,
      );
    }

    return this.accountingPeriodRepository.create({
      organisation: { connect: { id: organisationId } },
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      status: AccountingPeriodStatus.OPEN,
      createdById: actorUserId,
    });
  }

  async close(organisationId: string, id: string, actorUserId: string): Promise<AccountingPeriod> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException('This period is already closed');
    }

    const updated = await this.accountingPeriodRepository.close(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Accounting period not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<AccountingPeriod> {
    const period = await this.accountingPeriodRepository.findById(organisationId, id);
    if (!period) {
      throw new NotFoundException('Accounting period not found');
    }
    return period;
  }
}
