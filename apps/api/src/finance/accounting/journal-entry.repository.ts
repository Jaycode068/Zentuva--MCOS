import { Injectable } from '@nestjs/common';
import { JournalEntry, JournalEntryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListJournalEntriesParams {
  status?: JournalEntryStatus;
  sourceType?: string;
  accountingPeriodId?: string;
}

const RELATIONS_INCLUDE = {
  accountingPeriod: { select: { id: true, name: true, status: true } },
  lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
};

export type JournalEntryWithRelations = JournalEntry & {
  accountingPeriod: { id: string; name: string; status: string };
  lines: {
    id: string;
    accountId: string;
    description: string | null;
    debit: number;
    credit: number;
    account: { id: string; code: string; name: string; type: string };
  }[];
};

export interface CreateJournalEntryLineData {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface CreateJournalEntryData {
  organisationId: string;
  date: Date;
  description: string;
  reference?: string;
  lines: CreateJournalEntryLineData[];
  createdById: string;
}

/** Thrown when attempting to `post()`/`void()` a journal entry that isn't in the
 *  expected status for that transition. */
export class JournalEntryStateError extends Error {}

/** Thrown when `post()`'s re-check finds the entry's accounting period is no longer
 *  `OPEN` (closed between draft creation and posting). */
export class ClosedPeriodError extends Error {}

/**
 * Thin Prisma access for the `JournalEntry`/`JournalEntryLine` aggregate (Sprint 7,
 * docs/domains/accounting.md) — manually-created entries only; system-generated
 * postings go through `journal-posting.ts`'s `postSystemJournalEntry` directly from
 * inside another repository's own transaction.
 *
 * `create()` resolves *any* period (open or closed) covering the date — a draft may
 * exist against a period that isn't open yet, or was later closed; only `post()`
 * requires the period to be genuinely `OPEN` at that moment, re-checked atomically.
 */
@Injectable()
export class JournalEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateJournalEntryData): Promise<JournalEntryWithRelations> {
    const accountingPeriodId = await this.resolvePeriodForDate(data.organisationId, data.date);
    const journalNumber = await this.generateJournalNumber(data.organisationId);

    return this.prisma.journalEntry.create({
      data: {
        organisationId: data.organisationId,
        journalNumber,
        date: data.date,
        accountingPeriodId,
        description: data.description,
        reference: data.reference,
        sourceType: 'MANUAL',
        status: JournalEntryStatus.DRAFT,
        createdById: data.createdById,
        lines: { create: data.lines },
      },
      include: RELATIONS_INCLUDE,
    });
  }

  findById(organisationId: string, id: string): Promise<JournalEntryWithRelations | null> {
    return this.prisma.journalEntry.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListJournalEntriesParams = {},
  ): Promise<JournalEntryWithRelations[]> {
    return this.prisma.journalEntry.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.sourceType ? { sourceType: params.sourceType } : {}),
        ...(params.accountingPeriodId ? { accountingPeriodId: params.accountingPeriodId } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: [{ date: 'desc' }, { journalNumber: 'desc' }],
    });
  }

  /** Atomic: re-validates the persisted lines still balance (defensive — `create()`
   *  already guaranteed this) and that the resolved period is still `OPEN` (it may
   *  have been closed since the draft was created), then flips `DRAFT → POSTED`. */
  async post(
    organisationId: string,
    id: string,
    _actorUserId: string,
  ): Promise<JournalEntryWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.journalEntry.findFirst({
        where: { id, organisationId },
        include: { lines: true },
      });
      if (!existing) {
        throw new JournalEntryStateError('Journal entry not found');
      }
      if (existing.status !== JournalEntryStatus.DRAFT) {
        throw new JournalEntryStateError('Only a draft journal entry can be posted');
      }

      const totalDebit = roundCurrency(existing.lines.reduce((sum, line) => sum + line.debit, 0));
      const totalCredit = roundCurrency(existing.lines.reduce((sum, line) => sum + line.credit, 0));
      if (totalDebit !== totalCredit) {
        throw new JournalEntryStateError(
          'This journal entry does not balance and cannot be posted',
        );
      }

      const period = await tx.accountingPeriod.findUniqueOrThrow({
        where: { id: existing.accountingPeriodId },
      });
      if (period.status !== 'OPEN') {
        throw new ClosedPeriodError(
          `The accounting period "${period.name}" is closed — cannot post into it`,
        );
      }

      return tx.journalEntry.update({
        where: { id },
        data: { status: JournalEntryStatus.POSTED, postedAt: new Date() },
        include: RELATIONS_INCLUDE,
      });
    });
  }

  /** A bare status flip to `VOID` — never touches `lines`, never reverses the
   *  accounting effect (see docs/domains/accounting.md "Immutability & Correction"). */
  async void(
    organisationId: string,
    id: string,
    _actorUserId: string,
  ): Promise<JournalEntryWithRelations | null> {
    const result = await this.prisma.journalEntry.updateMany({
      where: {
        id,
        organisationId,
        status: { in: [JournalEntryStatus.DRAFT, JournalEntryStatus.POSTED] },
      },
      data: { status: JournalEntryStatus.VOID },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }

  private async resolvePeriodForDate(organisationId: string, date: Date): Promise<string> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { organisationId, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true },
    });
    if (!period) {
      throw new JournalEntryStateError(
        `No accounting period covers ${date.toISOString().slice(0, 10)} — create one first`,
      );
    }
    return period.id;
  }

  /** `JE-000001`, ... — unique per organisation. Uses the same collision-avoidance
   *  loop as `journal-posting.ts`'s `generateJournalNumber`, but against the plain
   *  (non-transactional) client since a manual `DRAFT` create has nothing else to be
   *  atomic with. */
  private async generateJournalNumber(organisationId: string): Promise<string> {
    let sequence = 1;
    let candidate = formatJournalNumber(sequence);
    while (
      await this.prisma.journalEntry.findUnique({
        where: { organisationId_journalNumber: { organisationId, journalNumber: candidate } },
        select: { id: true },
      })
    ) {
      sequence += 1;
      candidate = formatJournalNumber(sequence);
    }
    return candidate;
  }
}

function formatJournalNumber(sequence: number): string {
  return `JE-${String(sequence).padStart(6, '0')}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
