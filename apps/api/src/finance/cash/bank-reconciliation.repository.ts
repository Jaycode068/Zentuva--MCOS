import { Injectable } from '@nestjs/common';
import {
  BankReconciliation,
  BankReconciliationStatus,
  BankStatementTransaction,
  JournalEntryStatus,
  ReconciliationMatch,
  ReconciliationMatchType,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateBankReconciliationData {
  organisationId: string;
  cashAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBankBalance: number;
  closingBankBalance: number;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateBankReconciliationResult {
  bankReconciliation: BankReconciliation;
  wasCreated: boolean;
}

export type ReconciliationMatchWithRelations = ReconciliationMatch & {
  bankStatementTransaction: BankStatementTransaction;
  journalEntryLine: {
    id: string;
    debit: number;
    credit: number;
    description: string | null;
    journalEntry: { id: string; journalNumber: string; date: Date; description: string };
  };
};

/** A `JournalEntryLine` presented as an unmatched "book transaction" candidate. */
export interface UnmatchedBookLine {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  journalEntryId: string;
  journalNumber: string;
  date: Date;
}

export class InvalidCashAccountError extends Error {}
export class ReconciliationAlreadyInProgressError extends Error {}
export class ReconciliationNotFoundError extends Error {}
export class ReconciliationNotInProgressError extends Error {}
export class InvalidMatchTargetError extends Error {}

/** Thrown by `complete()` when unmatched bank/book items remain — carries both
 *  counts so the caller can surface them without a second query. */
export class ReconciliationIncompleteError extends Error {
  constructor(
    public readonly unmatchedBankCount: number,
    public readonly unmatchedBookCount: number,
  ) {
    super(
      `Cannot complete — ${unmatchedBankCount} unmatched bank transaction(s) and ${unmatchedBookCount} unmatched book transaction(s) remain`,
    );
  }
}

const MATCH_RELATIONS_INCLUDE = {
  bankStatementTransaction: true,
  journalEntryLine: {
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      journalEntry: { select: { id: true, journalNumber: true, date: true, description: true } },
    },
  },
};

/**
 * Thin Prisma access for `BankReconciliation`/`ReconciliationMatch` (Sprint 14,
 * docs/domains/cash-management.md "Reconciliation") — the core feature of this
 * sprint. Every "book transaction" is a `JournalEntryLine` against the cash
 * account's own linked `ChartOfAccount` row, never `Payment`/`SupplierPayment`/
 * `CashTransaction` polymorphically — the GL remains the single source of truth for
 * what "matched" means (docs/domains/cash-management.md "Reconciliation Model").
 */
@Injectable()
export class BankReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<BankReconciliation | null> {
    return this.prisma.bankReconciliation.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    cashAccountId?: string,
  ): Promise<BankReconciliation[]> {
    return this.prisma.bankReconciliation.findMany({
      where: { organisationId, ...(cashAccountId ? { cashAccountId } : {}) },
      orderBy: { periodStart: 'desc' },
    });
  }

  /** The most recent `COMPLETED` session for this account — its `closingBankBalance`
   *  is the "Reconciled Balance" (docs/domains/cash-management.md §"Book Balance vs
   *  Reconciled Balance"). `null` if none has ever been completed. */
  findLatestCompleted(
    organisationId: string,
    cashAccountId: string,
  ): Promise<BankReconciliation | null> {
    return this.prisma.bankReconciliation.findFirst({
      where: { organisationId, cashAccountId, status: BankReconciliationStatus.COMPLETED },
      orderBy: { periodEnd: 'desc' },
    });
  }

  async create(data: CreateBankReconciliationData): Promise<CreateBankReconciliationResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.bankReconciliation.findUnique({
          where: {
            cashAccountId_idempotencyKey: {
              cashAccountId: data.cashAccountId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { bankReconciliation: existing, wasCreated: false };
        }
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: { id: data.cashAccountId, organisationId: data.organisationId },
      });
      if (!cashAccount) {
        throw new InvalidCashAccountError('Cash account not found for this organisation');
      }

      const active = await tx.bankReconciliation.findFirst({
        where: { cashAccountId: data.cashAccountId, status: BankReconciliationStatus.IN_PROGRESS },
      });
      if (active) {
        throw new ReconciliationAlreadyInProgressError(
          'An in-progress reconciliation already exists for this cash account — complete or use it before starting another',
        );
      }

      const bankReconciliation = await tx.bankReconciliation.create({
        data: {
          organisationId: data.organisationId,
          cashAccountId: data.cashAccountId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          openingBankBalance: data.openingBankBalance,
          closingBankBalance: data.closingBankBalance,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { bankReconciliation, wasCreated: true };
    });
  }

  findMatches(bankReconciliationId: string): Promise<ReconciliationMatchWithRelations[]> {
    return this.prisma.reconciliationMatch.findMany({
      where: { bankReconciliationId },
      include: MATCH_RELATIONS_INCLUDE,
      orderBy: { matchedAt: 'asc' },
    }) as Promise<ReconciliationMatchWithRelations[]>;
  }

  findUnmatchedBankTransactions(
    organisationId: string,
    cashAccountId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<BankStatementTransaction[]> {
    return this.prisma.bankStatementTransaction.findMany({
      where: {
        organisationId,
        cashAccountId,
        matchStatus: 'UNMATCHED',
        transactionDate: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { transactionDate: 'asc' },
    });
  }

  async findUnmatchedBookLines(
    organisationId: string,
    accountId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UnmatchedBookLine[]> {
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        accountId,
        reconciliationMatch: null,
        journalEntry: {
          organisationId,
          status: JournalEntryStatus.POSTED,
          date: { gte: periodStart, lte: periodEnd },
        },
      },
      include: { journalEntry: { select: { id: true, journalNumber: true, date: true } } },
      orderBy: { journalEntry: { date: 'asc' } },
    });
    return lines.map((line) => ({
      id: line.id,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      journalEntryId: line.journalEntry.id,
      journalNumber: line.journalEntry.journalNumber,
      date: line.journalEntry.date,
    }));
  }

  async match(data: {
    organisationId: string;
    bankReconciliationId: string;
    bankStatementTransactionId: string;
    journalEntryLineId: string;
    matchType: ReconciliationMatchType;
    matchedById: string;
  }): Promise<{ match: ReconciliationMatch; wasCreated: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.bankReconciliation.findFirst({
        where: { id: data.bankReconciliationId, organisationId: data.organisationId },
      });
      if (!session) {
        throw new ReconciliationNotFoundError('Reconciliation not found');
      }

      const existingMatch = await tx.reconciliationMatch.findFirst({
        where: {
          bankStatementTransactionId: data.bankStatementTransactionId,
          journalEntryLineId: data.journalEntryLineId,
        },
      });
      if (existingMatch) {
        return { match: existingMatch, wasCreated: false };
      }

      if (session.status !== BankReconciliationStatus.IN_PROGRESS) {
        throw new ReconciliationNotInProgressError(
          'This reconciliation is already completed and cannot be modified',
        );
      }

      const bankTransaction = await tx.bankStatementTransaction.findFirst({
        where: {
          id: data.bankStatementTransactionId,
          organisationId: data.organisationId,
          cashAccountId: session.cashAccountId,
        },
      });
      if (!bankTransaction) {
        throw new InvalidMatchTargetError('Bank transaction not found for this cash account');
      }
      if (bankTransaction.matchStatus !== 'UNMATCHED') {
        throw new InvalidMatchTargetError('This bank transaction is already matched');
      }

      const cashAccount = await tx.cashAccount.findFirstOrThrow({
        where: { id: session.cashAccountId },
      });
      const bookLine = await tx.journalEntryLine.findFirst({
        where: {
          id: data.journalEntryLineId,
          accountId: cashAccount.linkedChartOfAccountId,
          journalEntry: { organisationId: data.organisationId, status: JournalEntryStatus.POSTED },
        },
        include: { reconciliationMatch: true },
      });
      if (!bookLine) {
        throw new InvalidMatchTargetError('Book transaction not found for this cash account');
      }
      if (bookLine.reconciliationMatch) {
        throw new InvalidMatchTargetError('This book transaction is already matched');
      }

      const match = await tx.reconciliationMatch.create({
        data: {
          bankReconciliationId: data.bankReconciliationId,
          bankStatementTransactionId: data.bankStatementTransactionId,
          journalEntryLineId: data.journalEntryLineId,
          matchType: data.matchType,
          matchedById: data.matchedById,
        },
      });
      await tx.bankStatementTransaction.update({
        where: { id: data.bankStatementTransactionId },
        data: { matchStatus: 'MATCHED' },
      });

      return { match, wasCreated: true };
    });
  }

  async unmatch(
    organisationId: string,
    bankReconciliationId: string,
    matchId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.bankReconciliation.findFirst({
        where: { id: bankReconciliationId, organisationId },
      });
      if (!session) {
        throw new ReconciliationNotFoundError('Reconciliation not found');
      }
      if (session.status !== BankReconciliationStatus.IN_PROGRESS) {
        throw new ReconciliationNotInProgressError(
          'This reconciliation is already completed and cannot be modified',
        );
      }
      const match = await tx.reconciliationMatch.findFirst({
        where: { id: matchId, bankReconciliationId },
      });
      if (!match) {
        throw new InvalidMatchTargetError('Match not found for this reconciliation');
      }
      await tx.reconciliationMatch.delete({ where: { id: matchId } });
      await tx.bankStatementTransaction.update({
        where: { id: match.bankStatementTransactionId },
        data: { matchStatus: 'UNMATCHED' },
      });
    });
  }

  /** Bulk, deterministic, unambiguous-only auto-matching (docs/domains/
   *  cash-management.md "Reconciliation Matching") — for each date+amount key with
   *  exactly one unmatched bank candidate AND exactly one unmatched book candidate,
   *  matches them. Anything ambiguous (0 or 2+ candidates on either side) is left
   *  for manual review. Deliberately not "sophisticated AI reconciliation." */
  async autoMatch(
    organisationId: string,
    bankReconciliationId: string,
    actorUserId: string,
  ): Promise<{ matchedCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.bankReconciliation.findFirst({
        where: { id: bankReconciliationId, organisationId },
      });
      if (!session) {
        throw new ReconciliationNotFoundError('Reconciliation not found');
      }
      if (session.status !== BankReconciliationStatus.IN_PROGRESS) {
        throw new ReconciliationNotInProgressError(
          'This reconciliation is already completed and cannot be modified',
        );
      }
      const cashAccount = await tx.cashAccount.findFirstOrThrow({
        where: { id: session.cashAccountId },
      });

      const unmatchedBank = await tx.bankStatementTransaction.findMany({
        where: {
          organisationId,
          cashAccountId: session.cashAccountId,
          matchStatus: 'UNMATCHED',
          transactionDate: { gte: session.periodStart, lte: session.periodEnd },
        },
      });
      const unmatchedBook = await tx.journalEntryLine.findMany({
        where: {
          accountId: cashAccount.linkedChartOfAccountId,
          reconciliationMatch: null,
          journalEntry: {
            organisationId,
            status: JournalEntryStatus.POSTED,
            date: { gte: session.periodStart, lte: session.periodEnd },
          },
        },
        include: { journalEntry: { select: { date: true } } },
      });

      const key = (dateIso: string, amount: number) => `${dateIso}|${amount.toFixed(2)}`;

      const bankByKey = new Map<string, BankStatementTransaction[]>();
      for (const transaction of unmatchedBank) {
        const k = key(transaction.transactionDate.toISOString().slice(0, 10), transaction.amount);
        bankByKey.set(k, [...(bankByKey.get(k) ?? []), transaction]);
      }

      const bookByKey = new Map<string, (typeof unmatchedBook)[number][]>();
      for (const line of unmatchedBook) {
        const signedAmount = roundCurrency(line.debit - line.credit);
        const k = key(line.journalEntry.date.toISOString().slice(0, 10), signedAmount);
        bookByKey.set(k, [...(bookByKey.get(k) ?? []), line]);
      }

      let matchedCount = 0;
      for (const [k, bankGroup] of bankByKey) {
        const bookGroup = bookByKey.get(k);
        if (bankGroup.length === 1 && bookGroup?.length === 1) {
          const bankTransaction = bankGroup[0]!;
          const bookLine = bookGroup[0]!;
          await tx.reconciliationMatch.create({
            data: {
              bankReconciliationId,
              bankStatementTransactionId: bankTransaction.id,
              journalEntryLineId: bookLine.id,
              matchType: ReconciliationMatchType.EXACT_AUTO,
              matchedById: actorUserId,
            },
          });
          await tx.bankStatementTransaction.update({
            where: { id: bankTransaction.id },
            data: { matchStatus: 'MATCHED' },
          });
          matchedCount += 1;
        }
      }

      return { matchedCount };
    });
  }

  async complete(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<BankReconciliation> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.bankReconciliation.findFirst({ where: { id, organisationId } });
      if (!session) {
        throw new ReconciliationNotFoundError('Reconciliation not found');
      }
      if (session.status === BankReconciliationStatus.COMPLETED) {
        return session;
      }

      const cashAccount = await tx.cashAccount.findFirstOrThrow({
        where: { id: session.cashAccountId },
      });

      const unmatchedBankCount = await tx.bankStatementTransaction.count({
        where: {
          organisationId,
          cashAccountId: session.cashAccountId,
          matchStatus: 'UNMATCHED',
          transactionDate: { gte: session.periodStart, lte: session.periodEnd },
        },
      });
      const unmatchedBookCount = await tx.journalEntryLine.count({
        where: {
          accountId: cashAccount.linkedChartOfAccountId,
          reconciliationMatch: null,
          journalEntry: {
            organisationId,
            status: JournalEntryStatus.POSTED,
            date: { gte: session.periodStart, lte: session.periodEnd },
          },
        },
      });
      if (unmatchedBankCount > 0 || unmatchedBookCount > 0) {
        throw new ReconciliationIncompleteError(unmatchedBankCount, unmatchedBookCount);
      }

      const matches = await tx.reconciliationMatch.findMany({
        where: { bankReconciliationId: id },
        select: { bankStatementTransactionId: true },
      });
      if (matches.length) {
        await tx.bankStatementTransaction.updateMany({
          where: { id: { in: matches.map((m) => m.bankStatementTransactionId) } },
          data: { matchStatus: 'RECONCILED' },
        });
      }

      return tx.bankReconciliation.update({
        where: { id },
        data: {
          status: BankReconciliationStatus.COMPLETED,
          reconciledById: actorUserId,
          reconciledAt: new Date(),
        },
      });
    });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
