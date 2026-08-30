import { Injectable } from '@nestjs/common';
import { CashTransaction, CashTransactionType, PaymentStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { postSystemJournalEntry } from '../accounting/journal-posting';

export interface ListCashTransactionsParams {
  cashAccountId?: string;
}

const RELATIONS_INCLUDE = {
  cashAccount: { select: { id: true, accountCode: true, name: true } },
  contraAccount: { select: { id: true, code: true, name: true } },
};

export type CashTransactionWithRelations = CashTransaction & {
  cashAccount: { id: string; accountCode: string; name: string };
  contraAccount: { id: string; code: string; name: string };
};

export interface CreateCashTransactionData {
  organisationId: string;
  cashAccountId: string;
  transactionType: CashTransactionType;
  transactionDate: Date;
  amount: number;
  description: string;
  reference?: string;
  contraAccountId: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCashTransactionResult {
  cashTransaction: CashTransactionWithRelations;
  wasCreated: boolean;
}

/** Thrown when `cashAccountId` doesn't resolve to an `ACTIVE` `CashAccount`
 *  belonging to this organisation. */
export class InvalidCashAccountError extends Error {}

/** Thrown when `contraAccountId` doesn't resolve to a non-system `ChartOfAccount`
 *  belonging to this organisation — the same "Path B" policy `SupplierInvoiceItem.
 *  debitAccountId` already enforces (never a default, never a system account). */
export class InvalidContraAccountError extends Error {}

/** Thrown when attempting to void an already-voided transaction. */
export class CashTransactionAlreadyVoidedError extends Error {}

/**
 * Thin Prisma access for the `CashTransaction` aggregate (Sprint 14,
 * docs/domains/cash-management.md) — cash movements outside the existing `Payment`/
 * `SupplierPayment` flows. `create()`: idempotency check-then-return, tenant-scoped
 * account validation, then an atomic `RECEIPT`/`PAYMENT` posting via
 * `postSystemJournalEntry`.
 */
@Injectable()
export class CashTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CashTransactionWithRelations | null> {
    return this.prisma.cashTransaction.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCashTransactionsParams = {},
  ): Promise<CashTransactionWithRelations[]> {
    return this.prisma.cashTransaction.findMany({
      where: {
        organisationId,
        ...(params.cashAccountId ? { cashAccountId: params.cashAccountId } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { transactionDate: 'desc' },
    });
  }

  async create(data: CreateCashTransactionData): Promise<CreateCashTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.cashTransaction.findUnique({
          where: {
            cashAccountId_idempotencyKey: {
              cashAccountId: data.cashAccountId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { cashTransaction: existing, wasCreated: false };
        }
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: { id: data.cashAccountId, organisationId: data.organisationId },
      });
      if (!cashAccount) {
        throw new InvalidCashAccountError('Cash account not found for this organisation');
      }

      const contraAccount = await tx.chartOfAccount.findFirst({
        where: { id: data.contraAccountId, organisationId: data.organisationId },
      });
      if (!contraAccount) {
        throw new InvalidContraAccountError('The selected contra account was not found');
      }
      if (contraAccount.isSystemAccount) {
        throw new InvalidContraAccountError(
          'Cannot post a cash transaction against a system-reserved account',
        );
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          organisationId: data.organisationId,
          cashAccountId: data.cashAccountId,
          transactionType: data.transactionType,
          transactionDate: data.transactionDate,
          amount: data.amount,
          description: data.description,
          reference: data.reference,
          contraAccountId: data.contraAccountId,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
        include: RELATIONS_INCLUDE,
      });

      // RECEIPT: DR cash account, CR contra account. PAYMENT: the reverse.
      // (docs/domains/cash-management.md "Cash Transactions") — atomic with the
      // CashTransaction write above.
      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.transactionDate,
        description: data.description,
        reference: data.reference,
        sourceType: 'CASH_TRANSACTION',
        sourceId: cashTransaction.id,
        actorUserId: data.createdById,
        lines:
          data.transactionType === CashTransactionType.RECEIPT
            ? [
                { accountId: cashAccount.linkedChartOfAccountId, debit: data.amount },
                { accountId: data.contraAccountId, credit: data.amount },
              ]
            : [
                { accountId: data.contraAccountId, debit: data.amount },
                { accountId: cashAccount.linkedChartOfAccountId, credit: data.amount },
              ],
      });

      return { cashTransaction, wasCreated: true };
    });
  }

  async void(organisationId: string, id: string): Promise<CashTransactionWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.cashTransaction.findFirst({
        where: { id, organisationId },
        include: RELATIONS_INCLUDE,
      });
      if (!existing) {
        return null;
      }
      if (existing.status === PaymentStatus.VOIDED) {
        throw new CashTransactionAlreadyVoidedError(
          'This cash transaction has already been voided',
        );
      }
      return tx.cashTransaction.update({
        where: { id },
        data: { status: PaymentStatus.VOIDED },
        include: RELATIONS_INCLUDE,
      });
    });
  }
}
