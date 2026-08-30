import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 14's Cash & Bank Management / Reconciliation
 * Foundation (docs/domains/cash-management.md) — `CashAccount`, `CashTransaction`,
 * `BankStatementTransaction` import, `BankReconciliation`. Split into its own file,
 * same "one file per domain" convention as `accounts-payable.ts`/`returns.ts`.
 */

export const cashAccountTypeSchema = z.enum(['BANK', 'CASH', 'OTHER_CASH_EQUIVALENT']);
export type CashAccountTypeInput = z.infer<typeof cashAccountTypeSchema>;

/**
 * `POST /api/finance/cash/accounts` — `linkedChartOfAccountId` is deliberately
 * absent: the dedicated Chart of Accounts row is system-provisioned inside the same
 * transaction, never a client-chosen input (docs/domains/cash-management.md
 * "Opening Balance"). `openingBalance`/`openingBalanceDate` are optional together —
 * a cash account can be created with no opening balance at all.
 */
export const createCashAccountSchema = z
  .object({
    accountCode: z.string().trim().min(1, 'Account code is required').max(50),
    name: z.string().trim().min(1, 'Name is required').max(200),
    accountType: cashAccountTypeSchema,
    currency: z.string().trim().min(1, 'Currency is required').max(10),
    bankName: z.string().trim().max(200).optional(),
    accountNumber: z.string().trim().max(50).optional(),
    accountName: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    openingBalance: z.number().nonnegative('Opening balance cannot be negative').optional(),
    openingBalanceDate: z.coerce.date().optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => !data.openingBalance || data.openingBalanceDate, {
    message: 'An opening balance date is required when an opening balance is supplied',
    path: ['openingBalanceDate'],
  });
export type CreateCashAccountInput = z.infer<typeof createCashAccountSchema>;

/** `PATCH /api/finance/cash/accounts/:id` — `accountCode`/`accountType`/`currency`/
 *  `linkedChartOfAccountId` are immutable after creation, same "identity fields
 *  never change" convention as `ChartOfAccount`'s own update schema. */
export const updateCashAccountSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  bankName: z.string().trim().max(200).optional(),
  accountNumber: z.string().trim().max(50).optional(),
  accountName: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type UpdateCashAccountInput = z.infer<typeof updateCashAccountSchema>;

export const cashTransactionTypeSchema = z.enum(['RECEIPT', 'PAYMENT']);
export type CashTransactionTypeInput = z.infer<typeof cashTransactionTypeSchema>;

/**
 * `POST /api/finance/cash/transactions` — a cash movement outside the existing
 * `Payment`/`SupplierPayment` flows (docs/domains/cash-management.md). `RECEIPT`
 * posts `DR cashAccount / CR contraAccountId`; `PAYMENT` posts the reverse.
 */
export const createCashTransactionSchema = z.object({
  cashAccountId: z.string().trim().min(1, 'Cash account is required'),
  transactionType: cashTransactionTypeSchema,
  transactionDate: z.coerce.date(),
  amount: z.number().positive('Amount must be greater than zero'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  reference: z.string().trim().max(200).optional(),
  contraAccountId: z.string().trim().min(1, 'A contra account is required'),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateCashTransactionInput = z.infer<typeof createCashTransactionSchema>;

/** One already-mapped, already-normalised row the frontend's CSV column-mapping
 *  step produces (docs/domains/cash-management.md "CSV Import") — the backend
 *  re-validates every field independently, never trusting client-side parsing. */
export const bankStatementImportRowSchema = z
  .object({
    transactionDate: z.coerce.date(),
    valueDate: z.coerce.date().optional(),
    description: z.string().trim().min(1, 'Description is required').max(500),
    reference: z.string().trim().max(200).optional(),
    debit: z.number().nonnegative('Debit cannot be negative').optional().default(0),
    credit: z.number().nonnegative('Credit cannot be negative').optional().default(0),
    balance: z.number().optional(),
    externalReference: z.string().trim().max(200).optional(),
  })
  .refine((row) => row.debit > 0 !== row.credit > 0, {
    message: 'Exactly one of debit/credit must be greater than zero',
    path: ['debit'],
  });
export type BankStatementImportRowInput = z.infer<typeof bankStatementImportRowSchema>;

/** `POST /api/finance/cash/bank-statements/:cashAccountId/import`. */
export const importBankStatementSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255),
  rows: z.array(bankStatementImportRowSchema).min(1, 'At least one row is required'),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type ImportBankStatementInput = z.infer<typeof importBankStatementSchema>;

/** `POST /api/finance/cash/reconciliations` — a free bank-statement date range, not
 *  tied to an `AccountingPeriod` (docs/domains/cash-management.md). */
export const createBankReconciliationSchema = z.object({
  cashAccountId: z.string().trim().min(1, 'Cash account is required'),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  openingBankBalance: z.number(),
  closingBankBalance: z.number(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateBankReconciliationInput = z.infer<typeof createBankReconciliationSchema>;

/** `POST /api/finance/cash/reconciliations/:id/match` — explicit manual pairing. */
export const matchReconciliationSchema = z.object({
  bankStatementTransactionId: z.string().trim().min(1, 'A bank transaction is required'),
  journalEntryLineId: z.string().trim().min(1, 'A book transaction is required'),
});
export type MatchReconciliationInput = z.infer<typeof matchReconciliationSchema>;
