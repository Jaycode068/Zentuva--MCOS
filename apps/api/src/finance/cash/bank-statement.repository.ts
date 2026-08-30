import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';
import { BankStatementImport, BankStatementTransaction, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ImportBankStatementRowData {
  transactionDate: Date;
  valueDate?: Date;
  description: string;
  reference?: string;
  debit: number;
  credit: number;
  balance?: number;
  externalReference?: string;
}

export interface ImportBankStatementData {
  organisationId: string;
  cashAccountId: string;
  filename: string;
  rows: ImportBankStatementRowData[];
  idempotencyKey?: string;
  importedById: string;
}

export interface ImportBankStatementResult {
  bankStatementImport: BankStatementImport;
  wasCreated: boolean;
}

export interface ListBankStatementTransactionsParams {
  cashAccountId?: string;
  matchStatus?: BankStatementTransaction['matchStatus'];
  from?: Date;
  to?: Date;
}

/** Thrown when `cashAccountId` doesn't resolve to a `CashAccount` belonging to this
 *  organisation. */
export class InvalidCashAccountError extends Error {}

/**
 * `sha256(cashAccountId|date|debit|credit|reference|description)` — deterministic
 * duplicate-detection layer one (docs/domains/cash-management.md "CSV Import").
 * Reference/description are trimmed+lowercased so cosmetic re-formatting between
 * bank exports doesn't defeat detection; date is truncated to the day.
 */
function computeDedupeHash(cashAccountId: string, row: ImportBankStatementRowData): string {
  const dateKey = row.transactionDate.toISOString().slice(0, 10);
  const referenceKey = (row.reference ?? '').trim().toLowerCase();
  const descriptionKey = row.description.trim().toLowerCase();
  const input = [
    cashAccountId,
    dateKey,
    row.debit.toFixed(2),
    row.credit.toFixed(2),
    referenceKey,
    descriptionKey,
  ].join('|');
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Thin Prisma access for `BankStatementImport`/`BankStatementTransaction` (Sprint 14,
 * docs/domains/cash-management.md "Bank Statement Import"). `import()` is the one
 * write: idempotency check-then-return, then two independent duplicate-detection
 * layers (a deterministic content hash, and — where supplied — a stable external
 * reference) applied both against already-imported rows and within the batch itself,
 * skipping (not hard-failing) any row that matches either. All rows never store a
 * balance beyond the statement's own reported `balance` figure (display-only).
 */
@Injectable()
export class BankStatementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findImportById(organisationId: string, id: string): Promise<BankStatementImport | null> {
    return this.prisma.bankStatementImport.findFirst({ where: { id, organisationId } });
  }

  findManyImports(organisationId: string, cashAccountId?: string): Promise<BankStatementImport[]> {
    return this.prisma.bankStatementImport.findMany({
      where: { organisationId, ...(cashAccountId ? { cashAccountId } : {}) },
      orderBy: { importedAt: 'desc' },
    });
  }

  findManyTransactions(
    organisationId: string,
    params: ListBankStatementTransactionsParams = {},
  ): Promise<BankStatementTransaction[]> {
    return this.prisma.bankStatementTransaction.findMany({
      where: {
        organisationId,
        ...(params.cashAccountId ? { cashAccountId: params.cashAccountId } : {}),
        ...(params.matchStatus ? { matchStatus: params.matchStatus } : {}),
        ...(params.from || params.to
          ? {
              transactionDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { transactionDate: 'desc' },
    });
  }

  async import(data: ImportBankStatementData): Promise<ImportBankStatementResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.bankStatementImport.findUnique({
          where: {
            cashAccountId_idempotencyKey: {
              cashAccountId: data.cashAccountId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { bankStatementImport: existing, wasCreated: false };
        }
      }

      const cashAccount = await tx.cashAccount.findFirst({
        where: { id: data.cashAccountId, organisationId: data.organisationId },
      });
      if (!cashAccount) {
        throw new InvalidCashAccountError('Cash account not found for this organisation');
      }

      const seenHashes = new Set<string>();
      const seenExternalRefs = new Set<string>();
      const rowsToCreate: Prisma.BankStatementTransactionCreateManyInput[] = [];
      let duplicateRows = 0;

      for (const row of data.rows) {
        const dedupeHash = computeDedupeHash(data.cashAccountId, row);
        const withinBatchDuplicate =
          seenHashes.has(dedupeHash) ||
          (row.externalReference ? seenExternalRefs.has(row.externalReference) : false);

        const existingRow = withinBatchDuplicate
          ? true
          : await tx.bankStatementTransaction.findFirst({
              where: {
                cashAccountId: data.cashAccountId,
                OR: [
                  { dedupeHash },
                  ...(row.externalReference ? [{ externalReference: row.externalReference }] : []),
                ],
              },
              select: { id: true },
            });

        if (existingRow) {
          duplicateRows += 1;
          continue;
        }

        seenHashes.add(dedupeHash);
        if (row.externalReference) {
          seenExternalRefs.add(row.externalReference);
        }
        rowsToCreate.push({
          organisationId: data.organisationId,
          cashAccountId: data.cashAccountId,
          transactionDate: row.transactionDate,
          valueDate: row.valueDate,
          description: row.description,
          reference: row.reference,
          debit: row.debit,
          credit: row.credit,
          amount: roundCurrency(row.credit - row.debit),
          balance: row.balance,
          externalReference: row.externalReference,
          dedupeHash,
        });
      }

      const bankStatementImport = await tx.bankStatementImport.create({
        data: {
          organisationId: data.organisationId,
          cashAccountId: data.cashAccountId,
          filename: data.filename,
          importedById: data.importedById,
          idempotencyKey: data.idempotencyKey,
          totalRows: data.rows.length,
          importedRows: rowsToCreate.length,
          duplicateRows,
          errorRows: 0,
        },
      });

      if (rowsToCreate.length) {
        await tx.bankStatementTransaction.createMany({
          data: rowsToCreate.map((row) => ({ ...row, importBatchId: bankStatementImport.id })),
        });
      }

      return { bankStatementImport, wasCreated: true };
    });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
