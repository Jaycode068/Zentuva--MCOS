import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateJournalEntryInput } from '@zentuva/validation';

import { ChartOfAccountRepository } from './chart-of-account.repository';
import {
  ClosedPeriodError,
  CreateJournalEntryLineData,
  JournalEntryRepository,
  JournalEntryStateError,
  JournalEntryWithRelations,
  ListJournalEntriesParams,
} from './journal-entry.repository';

/**
 * Domain service for manually-created `JournalEntry`s (Sprint 7,
 * docs/domains/accounting.md). System-generated postings (invoice issued, payment
 * recorded, credit note issued) never go through this service — they call
 * `journal-posting.ts`'s `postSystemJournalEntry` directly from inside their own
 * atomic transaction.
 */
@Injectable()
export class JournalEntryService {
  constructor(
    private readonly journalEntryRepository: JournalEntryRepository,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<JournalEntryWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListJournalEntriesParams,
  ): Promise<JournalEntryWithRelations[]> {
    return this.journalEntryRepository.findManyByOrganisation(organisationId, params);
  }

  /** UX pre-checks mirroring `createJournalEntrySchema`'s own refines (never trusted
   *  from the client alone — this is the actual source of truth) plus an
   *  account-existence/tenant/active check the schema can't express. */
  async create(
    organisationId: string,
    input: CreateJournalEntryInput,
    actorUserId: string,
  ): Promise<JournalEntryWithRelations> {
    const totalDebit = roundCurrency(input.lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
    const totalCredit = roundCurrency(
      input.lines.reduce((sum, line) => sum + (line.credit ?? 0), 0),
    );
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Total debits (${totalDebit}) must equal total credits (${totalCredit})`,
      );
    }

    const lines: CreateJournalEntryLineData[] = [];
    for (const line of input.lines) {
      const account = await this.chartOfAccountRepository.findById(organisationId, line.accountId);
      if (!account) {
        throw new BadRequestException('One or more accounts do not belong to this organisation');
      }
      if (!account.isActive) {
        throw new BadRequestException(`Account "${account.name}" is inactive`);
      }
      lines.push({
        accountId: line.accountId,
        description: line.description,
        debit: roundCurrency(line.debit ?? 0),
        credit: roundCurrency(line.credit ?? 0),
      });
    }

    try {
      return await this.journalEntryRepository.create({
        organisationId,
        date: input.date,
        description: input.description,
        reference: input.reference,
        lines,
        createdById: actorUserId,
      });
    } catch (error) {
      if (error instanceof JournalEntryStateError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async post(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<JournalEntryWithRelations> {
    try {
      return await this.journalEntryRepository.post(organisationId, id, actorUserId);
    } catch (error) {
      if (error instanceof ClosedPeriodError || error instanceof JournalEntryStateError) {
        if (error.message === 'Journal entry not found') {
          throw new NotFoundException('Journal entry not found');
        }
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<JournalEntryWithRelations> {
    const updated = await this.journalEntryRepository.void(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Journal entry not found');
    }
    return updated;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<JournalEntryWithRelations> {
    const entry = await this.journalEntryRepository.findById(organisationId, id);
    if (!entry) {
      throw new NotFoundException('Journal entry not found');
    }
    return entry;
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
