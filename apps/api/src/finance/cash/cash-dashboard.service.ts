import { Injectable } from '@nestjs/common';
import { CashAccountStatus, CashAccountType, JournalEntryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../accounting/ledger.service';
import { BankReconciliationRepository } from './bank-reconciliation.repository';
import { CashAccountRepository } from './cash-account.repository';

export interface CashAccountPosition {
  id: string;
  accountCode: string;
  name: string;
  accountType: CashAccountType;
  bookBalance: number;
  reconciledBalance: number;
  unreconciledDifference: number;
}

export interface CashOverview {
  totalCash: number;
  bankBalance: number;
  cashOnHand: number;
  totalUnreconciled: number;
  accounts: CashAccountPosition[];
  accountsRequiringReconciliation: CashAccountPosition[];
  recentTransactions: {
    id: string;
    date: Date;
    description: string;
    journalNumber: string;
    debit: number;
    credit: number;
    cashAccountId: string;
    cashAccountName: string;
  }[];
}

/**
 * Composes — never recomputes — the Cash Position Dashboard (Sprint 14,
 * docs/domains/cash-management.md "Cash Position Dashboard"). Every balance figure
 * comes from `LedgerService`/the latest `COMPLETED` `BankReconciliation` for each
 * account, exactly the same primitives every other page in this domain uses —
 * mirrors `reports/dashboard.service.ts`'s own compositional style.
 */
@Injectable()
export class CashDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly bankReconciliationRepository: BankReconciliationRepository,
    private readonly ledgerService: LedgerService,
  ) {}

  async getOverview(organisationId: string): Promise<CashOverview> {
    const cashAccounts = await this.cashAccountRepository.findManyByOrganisation(organisationId, {
      status: CashAccountStatus.ACTIVE,
    });

    const positions: CashAccountPosition[] = await Promise.all(
      cashAccounts.map(async (account) => {
        const [activity, latestCompleted] = await Promise.all([
          this.ledgerService.getAccountActivity(organisationId, account.linkedChartOfAccountId, {
            to: new Date(),
          }),
          this.bankReconciliationRepository.findLatestCompleted(organisationId, account.id),
        ]);
        const bookBalance = activity.closingBalance;
        const reconciledBalance = latestCompleted?.closingBankBalance ?? account.openingBalance;
        return {
          id: account.id,
          accountCode: account.accountCode,
          name: account.name,
          accountType: account.accountType,
          bookBalance,
          reconciledBalance,
          unreconciledDifference: roundCurrency(bookBalance - reconciledBalance),
        };
      }),
    );

    const totalCash = roundCurrency(positions.reduce((sum, p) => sum + p.bookBalance, 0));
    const bankBalance = roundCurrency(
      positions
        .filter((p) => p.accountType === CashAccountType.BANK)
        .reduce((sum, p) => sum + p.bookBalance, 0),
    );
    const cashOnHand = roundCurrency(
      positions
        .filter((p) => p.accountType === CashAccountType.CASH)
        .reduce((sum, p) => sum + p.bookBalance, 0),
    );
    const totalUnreconciled = roundCurrency(
      positions.reduce((sum, p) => sum + Math.abs(p.unreconciledDifference), 0),
    );
    const accountsRequiringReconciliation = positions.filter(
      (p) => Math.abs(p.unreconciledDifference) > 0.01,
    );

    const linkedAccountIds = cashAccounts.map((a) => a.linkedChartOfAccountId);
    const recentLines = linkedAccountIds.length
      ? await this.prisma.journalEntryLine.findMany({
          where: {
            accountId: { in: linkedAccountIds },
            journalEntry: { organisationId, status: JournalEntryStatus.POSTED },
          },
          include: {
            journalEntry: { select: { journalNumber: true, date: true, description: true } },
          },
          orderBy: { journalEntry: { date: 'desc' } },
          take: 10,
        })
      : [];
    const nameByAccountId = new Map(cashAccounts.map((a) => [a.linkedChartOfAccountId, a]));
    const recentTransactions = recentLines.map((line) => {
      const account = nameByAccountId.get(line.accountId);
      return {
        id: line.id,
        date: line.journalEntry.date,
        description: line.journalEntry.description,
        journalNumber: line.journalEntry.journalNumber,
        debit: line.debit,
        credit: line.credit,
        cashAccountId: account?.id ?? '',
        cashAccountName: account?.name ?? '',
      };
    });

    return {
      totalCash,
      bankBalance,
      cashOnHand,
      totalUnreconciled,
      accounts: positions,
      accountsRequiringReconciliation,
      recentTransactions,
    };
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
