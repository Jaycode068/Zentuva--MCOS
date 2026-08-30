import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, JournalEntryStatus } from '@prisma/client';

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
  /** The `JournalEntryLine`'s own id — distinct from `journalEntryId` below. */
  id: string;
  /** Added Sprint 13 — the parent `JournalEntry`'s id, needed to open its own detail
   *  view from a ledger/account-activity row (`journalNumber` alone is a
   *  human-readable code, not a lookup key). */
  journalEntryId: string;
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

/**
 * One account's net activity over a date range/accounting period — the shared shape
 * both the Trial Balance (below) and `FinancialStatementService` (Sprint 13,
 * docs/domains/accounting.md §16) are built on, via the shared `getAccountBalances`
 * query below, so account balances are never computed two different ways.
 */
export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  /** The classic two-column Trial Balance split of `netBalance` below. */
  debit: number;
  credit: number;
  /** `debit − credit`, the raw signed balance the two-column split is derived from.
   *  Positive means a natural debit balance (typical for Asset/Cost-of-Sales/Expense
   *  accounts), negative a natural credit balance (typical for
   *  Liability/Equity/Revenue) — see `FinancialStatementService`'s own doc comment
   *  for how this sign is turned into a per-`AccountType` statement total. */
  netBalance: number;
}

/** Alias kept for the Trial Balance's own existing naming — identical shape. */
export type TrialBalanceRow = AccountBalanceRow;

/**
 * Every account with at least one `POSTED` `JournalEntryLine` in `[from, to]`/the
 * given accounting period, sorted by `code`. Since the whole ledger balances
 * (`Σ netBalance === 0` across every account, by double-entry construction),
 * `Σ debit column === Σ credit column` always holds for whatever subset of accounts
 * a caller sums — this is what makes the Trial Balance (all accounts) and the
 * Balance Sheet (Asset/Liability/Equity accounts only) both reconcile by
 * construction, never by adjustment.
 */
export async function getAccountBalances(
  prisma: PrismaService,
  chartOfAccountRepository: ChartOfAccountRepository,
  organisationId: string,
  params: { from?: Date; to?: Date; accountingPeriodId?: string } = {},
): Promise<AccountBalanceRow[]> {
  const grouped = await prisma.journalEntryLine.groupBy({
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

  const rows: AccountBalanceRow[] = [];
  for (const group of grouped) {
    const account = await chartOfAccountRepository.findById(organisationId, group.accountId);
    if (!account) continue;
    const netBalance = roundCurrency((group._sum.debit ?? 0) - (group._sum.credit ?? 0));
    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      systemKey: account.systemKey,
      debit: netBalance >= 0 ? netBalance : 0,
      credit: netBalance < 0 ? -netBalance : 0,
      netBalance,
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return rows;
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
        journalEntryId: line.journalEntry.id,
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

  async getTrialBalance(
    organisationId: string,
    params: { from?: Date; to?: Date; accountingPeriodId?: string } = {},
  ): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
    const rows = await getAccountBalances(
      this.prisma,
      this.chartOfAccountRepository,
      organisationId,
      params,
    );
    const totalDebit = roundCurrency(rows.reduce((sum, row) => sum + row.debit, 0));
    const totalCredit = roundCurrency(rows.reduce((sum, row) => sum + row.credit, 0));
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

  /** A single system account's current signed balance, normal-side-adjusted (Sprint
   *  13) — e.g. Accounts Payable surfacing `GRNI_PENDING_APPROVAL`'s balance, or
   *  Inventory Reconciliation summing `INVENTORY`/`FINISHED_GOODS_INVENTORY`. Returns
   *  `0` if the organisation has no such system account configured yet — never
   *  throws, since a missing optional system account (e.g. an org that has never
   *  posted a Goods Receipt) is a normal, valid state for a read-only report. */
  async getSystemAccountBalance(organisationId: string, systemKey: string): Promise<number> {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { organisationId, systemKey },
      select: { id: true, type: true },
    });
    if (!account) {
      return 0;
    }
    const result = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId: account.id,
        journalEntry: { organisationId, status: JournalEntryStatus.POSTED },
      },
      _sum: { debit: true, credit: true },
    });
    const netBalance = roundCurrency((result._sum.debit ?? 0) - (result._sum.credit ?? 0));
    const debitNormal =
      account.type === AccountType.ASSET ||
      account.type === AccountType.COST_OF_SALES ||
      account.type === AccountType.EXPENSE;
    return debitNormal ? netBalance : -netBalance;
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
