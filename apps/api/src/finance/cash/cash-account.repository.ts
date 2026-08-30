import { Injectable } from '@nestjs/common';
import { CashAccount, CashAccountStatus, CashAccountType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from '../accounting/chart-of-account-keys';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  postSystemJournalEntry,
  UnbalancedPostingError,
} from '../accounting/journal-posting';

export interface ListCashAccountsParams {
  status?: CashAccountStatus;
  accountType?: CashAccountType;
}

export interface CreateCashAccountData {
  organisationId: string;
  accountCode: string;
  name: string;
  accountType: CashAccountType;
  currency: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  description?: string;
  openingBalance?: number;
  openingBalanceDate?: Date;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCashAccountResult {
  cashAccount: CashAccount;
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — the whole operation (Chart of
   *  Accounts provisioning + opening-balance posting) is money-affecting and must
   *  be replay-safe, same Sprint 9/10 lesson every other financially-material
   *  create() in this codebase follows. */
  wasCreated: boolean;
}

/** Thrown when `accountCode` is already in use for this organisation. */
export class DuplicateCashAccountCodeError extends Error {}

/**
 * Maps a `CashAccountType` to the `SYSTEM_ACCOUNT_KEYS` entry a new `CashAccount`'s
 * own dedicated Chart of Accounts row is provisioned as a child of
 * (docs/domains/cash-management.md "Opening Balance" — never the generic `CASH`/
 * `BANK` system accounts themselves, only a child of one).
 */
function parentSystemKeyFor(accountType: CashAccountType): string {
  switch (accountType) {
    case CashAccountType.BANK:
      return SYSTEM_ACCOUNT_KEYS.BANK;
    case CashAccountType.CASH:
      return SYSTEM_ACCOUNT_KEYS.CASH;
    case CashAccountType.OTHER_CASH_EQUIVALENT:
      return SYSTEM_ACCOUNT_KEYS.CASH_BANK_PARENT;
  }
}

/**
 * Thin Prisma access for the `CashAccount` aggregate (Sprint 14,
 * docs/domains/cash-management.md). `create()` is the one money-affecting write:
 * idempotency check-then-return, provisioning a dedicated, non-system Chart of
 * Accounts row as a child of the org's `CASH`/`BANK`/`CASH_BANK_PARENT` system
 * account (never the system account itself — each `CashAccount` gets its own book
 * balance), and an optional opening-balance journal posting — all atomic.
 */
@Injectable()
export class CashAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CashAccount | null> {
    return this.prisma.cashAccount.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCashAccountsParams = {},
  ): Promise<CashAccount[]> {
    return this.prisma.cashAccount.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.accountType ? { accountType: params.accountType } : {}),
      },
      orderBy: { accountCode: 'asc' },
    });
  }

  async existsByCode(organisationId: string, accountCode: string): Promise<boolean> {
    const count = await this.prisma.cashAccount.count({ where: { organisationId, accountCode } });
    return count > 0;
  }

  async create(data: CreateCashAccountData): Promise<CreateCashAccountResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.cashAccount.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { cashAccount: existing, wasCreated: false };
        }
      }

      if (
        await tx.cashAccount.count({
          where: { organisationId: data.organisationId, accountCode: data.accountCode },
        })
      ) {
        throw new DuplicateCashAccountCodeError(
          `Account code "${data.accountCode}" is already in use`,
        );
      }

      const parentSystemKey = parentSystemKeyFor(data.accountType);
      const parent = await tx.chartOfAccount.findFirst({
        where: { organisationId: data.organisationId, systemKey: parentSystemKey },
      });
      if (!parent) {
        throw new MissingSystemAccountError(
          `No "${parentSystemKey}" system account is configured for this organisation`,
        );
      }

      const childCode = await generateChildAccountCode(tx, data.organisationId, parent.code);
      const linkedChartOfAccount = await tx.chartOfAccount.create({
        data: {
          organisationId: data.organisationId,
          code: childCode,
          name: data.name,
          type: parent.type,
          parentId: parent.id,
          isSystemAccount: false,
          createdById: data.createdById,
          updatedById: data.createdById,
        },
      });

      const cashAccount = await tx.cashAccount.create({
        data: {
          organisationId: data.organisationId,
          accountCode: data.accountCode,
          name: data.name,
          accountType: data.accountType,
          currency: data.currency,
          bankName: data.bankName,
          accountNumber: data.accountNumber,
          accountName: data.accountName,
          description: data.description,
          linkedChartOfAccountId: linkedChartOfAccount.id,
          openingBalance: data.openingBalance ?? 0,
          openingBalanceDate: data.openingBalanceDate,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          updatedById: data.createdById,
        },
      });

      if (data.openingBalance && data.openingBalance > 0) {
        // DR <cash account's own CoA row>, CR Opening Balance Equity
        // (docs/domains/cash-management.md "Opening Balance") — atomic with the
        // CashAccount/ChartOfAccount writes above; a failed posting (no open
        // period, no configured system account) rolls the whole create back.
        await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: data.openingBalanceDate ?? new Date(),
          description: `Opening balance — ${data.name}`,
          sourceType: 'CASH_ACCOUNT_OPENING_BALANCE',
          sourceId: cashAccount.id,
          actorUserId: data.createdById,
          lines: [
            { accountId: linkedChartOfAccount.id, debit: data.openingBalance },
            { systemKey: SYSTEM_ACCOUNT_KEYS.OPENING_BALANCE_EQUITY, credit: data.openingBalance },
          ],
        });
      }

      return { cashAccount, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CashAccountUpdateInput,
  ): Promise<CashAccount | null> {
    return this.updateMatching(organisationId, id, data);
  }

  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashAccount | null> {
    return this.updateMatching(organisationId, id, {
      status: CashAccountStatus.INACTIVE,
      updatedById: actorUserId,
    });
  }

  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashAccount | null> {
    return this.updateMatching(organisationId, id, {
      status: CashAccountStatus.ACTIVE,
      updatedById: actorUserId,
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CashAccountUpdateInput,
  ): Promise<CashAccount | null> {
    const result = await this.prisma.cashAccount.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.cashAccount.findUniqueOrThrow({ where: { id } });
  }
}

/** `${parentCode}01`, `${parentCode}02`, ... — same increment-until-collision shape
 *  as `journal-posting.ts`'s `generateJournalNumber`, scoped to this organisation's
 *  Chart of Accounts. Runs inside the caller's transaction. */
async function generateChildAccountCode(
  tx: Prisma.TransactionClient,
  organisationId: string,
  parentCode: string,
): Promise<string> {
  let sequence = 1;
  let candidate = `${parentCode}${String(sequence).padStart(2, '0')}`;
  while (
    await tx.chartOfAccount.findFirst({
      where: { organisationId, code: candidate },
      select: { id: true },
    })
  ) {
    sequence += 1;
    candidate = `${parentCode}${String(sequence).padStart(2, '0')}`;
  }
  return candidate;
}

export { MissingSystemAccountError, NoOpenPeriodError, UnbalancedPostingError };
