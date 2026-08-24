import { Injectable, NotFoundException } from '@nestjs/common';
import { JournalEntryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountRepository } from './chart-of-account.repository';

export interface GetLedgerParams {
  accountId?: string;
  from?: Date;
  to?: Date;
  accountingPeriodId?: string;
  sourceType?: string;
  reference?: string;
  status?: JournalEntryStatus;
}

export interface LedgerLine {
  id: string;
  date: Date;
  journalNumber: string;
  account: { id: string; code: string; name: string };
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: JournalEntryStatus;
  debit: number;
  credit: number;
  /** Cumulative net (`debit − credit`) across the returned, ordered result — most
   *  meaningful when filtered to a single `accountId`; see
   *  docs/domains/accounting.md "General Ledger". Computed here in application code
   *  from the ordered query result, never a SQL window function. */
  runningBalance: number;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

export interface AccountActivityResult {
  account: { id: string; code: string; name: string; type: string };
  openingBalance: number;
  transactions: LedgerLine[];
  closingBalance: number;
}

/**
 * Read-only General Ledger / Trial Balance / Account Activity queries (Sprint 7,
 * docs/domains/accounting.md §15–17). Only `POSTED` entries ever contribute to a
 * balance — `DRAFT`/`VOID` entries are excluded from every balance computation here,
 * regardless of the `status` filter passed to `getLedger` (which exists to let a user
 * *inspect* draft/void entries in the raw ledger listing, not to include them in
 * running totals).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
  ) {}

  async getLedger(organisationId: string, params: GetLedgerParams = {}): Promise<LedgerLine[]> {
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        account: { organisationId },
        ...(params.accountId ? { accountId: params.accountId } : {}),
        journalEntry: {
          organisationId,
          status: params.status ?? JournalEntryStatus.POSTED,
          ...(params.from || params.to
            ? {
                date: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
          ...(params.accountingPeriodId ? { accountingPeriodId: params.accountingPeriodId } : {}),
          ...(params.sourceType ? { sourceType: params.sourceType } : {}),
          ...(params.reference
            ? { reference: { contains: params.reference, mode: 'insensitive' } }
            : {}),
        },
      },
      include: {
        account: { select: { id: true, code: true, name: true } },
        journalEntry: {
          select: {
            id: true,
            journalNumber: true,
            date: true,
            description: true,
            reference: true,
            sourceType: true,
            sourceId: true,
            status: true,
          },
        },
      },
      orderBy: [{ journalEntry: { date: 'asc' } }, { journalEntry: { journalNumber: 'asc' } }],
    });

    let openingBalance = 0;
    if (params.accountId && params.from) {
      openingBalance = await this.sumNetBalance(
        organisationId,
        params.accountId,
        undefined,
        params.from,
      );
    }

    let runningBalance = openingBalance;
    return lines.map((line) => {
      runningBalance = roundCurrency(runningBalance + line.debit - line.credit);
      return {
        id: line.id,
        date: line.journalEntry.date,
        journalNumber: line.journalEntry.journalNumber,
        account: line.account,
        description: line.description,
        reference: line.journalEntry.reference,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        status: line.journalEntry.status,
        debit: line.debit,
        credit: line.credit,
        runningBalance,
      };
    });
  }

  /** Each account's `netBalance = totalDebit − totalCredit`, split by sign into a
   *  classic two-column Trial Balance. Since the whole ledger balances
   *  (`Σ netBalance === 0` across every account, by double-entry construction),
   *  `Σ debit column === Σ credit column` always holds — see plan decision #10. */
  async getTrialBalance(
    organisationId: string,
    params: { from?: Date; to?: Date; accountingPeriodId?: string } = {},
  ): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
    const grouped = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        account: { organisationId },
        journalEntry: {
          organisationId,
          status: JournalEntryStatus.POSTED,
          ...(params.from || params.to
            ? {
                date: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
          ...(params.accountingPeriodId ? { accountingPeriodId: params.accountingPeriodId } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    const rows: TrialBalanceRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    for (const group of grouped) {
      const account = await this.chartOfAccountRepository.findById(organisationId, group.accountId);
      if (!account) continue;
      const netBalance = roundCurrency((group._sum.debit ?? 0) - (group._sum.credit ?? 0));
      const debit = netBalance >= 0 ? netBalance : 0;
      const credit = netBalance < 0 ? -netBalance : 0;
      totalDebit = roundCurrency(totalDebit + debit);
      totalCredit = roundCurrency(totalCredit + credit);
      rows.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit,
        credit,
      });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));

    return { rows, totalDebit, totalCredit };
  }

  async getAccountActivity(
    organisationId: string,
    accountId: string,
    params: { from?: Date; to?: Date } = {},
  ): Promise<AccountActivityResult> {
    const account = await this.chartOfAccountRepository.findById(organisationId, accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const openingBalance = params.from
      ? await this.sumNetBalance(organisationId, accountId, undefined, params.from)
      : 0;

    // `getLedger` computes the same opening balance internally (it re-derives it from
    // `accountId`+`from` using the identical query below) and seeds `runningBalance`
    // from it — so the last line's `runningBalance` already *is* the closing balance.
    const transactions = await this.getLedger(organisationId, {
      accountId,
      from: params.from,
      to: params.to,
    });
    const closingBalance = transactions.length
      ? transactions[transactions.length - 1]!.runningBalance
      : openingBalance;

    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      openingBalance,
      transactions,
      closingBalance,
    };
  }

  /** Sum of `debit − credit` across every `POSTED` line for `accountId`, optionally
   *  bounded to `[from, before)` — used to compute an Opening Balance as of `before`. */
  private async sumNetBalance(
    organisationId: string,
    accountId: string,
    from: Date | undefined,
    before: Date,
  ): Promise<number> {
    const result = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        account: { organisationId },
        journalEntry: {
          organisationId,
          status: JournalEntryStatus.POSTED,
          date: { ...(from ? { gte: from } : {}), lt: before },
        },
      },
      _sum: { debit: true, credit: true },
    });
    return roundCurrency((result._sum.debit ?? 0) - (result._sum.credit ?? 0));
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
