import { z } from 'zod';

/**
 * Shared validation schemas for the Accounting domain (Sprint 7,
 * docs/domains/accounting.md) — Chart of Accounts, Accounting Periods, Journal
 * Entries. Split into its own file, same "one file per domain" convention as
 * `finance.ts`/`distribution.ts`.
 *
 * `isSystemAccount`/`systemKey` are deliberately absent from every account schema —
 * server-only, never client-settable. Every journal total (`debit`/`credit` sums) is
 * re-validated server-side regardless of what these schemas already checked — never
 * trusted from the client alone.
 */

export const accountTypeSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COST_OF_SALES',
  'EXPENSE',
]);
export type AccountTypeInput = z.infer<typeof accountTypeSchema>;

export const accountingPeriodStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type AccountingPeriodStatusInput = z.infer<typeof accountingPeriodStatusSchema>;

export const journalEntryStatusSchema = z.enum(['DRAFT', 'POSTED', 'VOID']);
export type JournalEntryStatusInput = z.infer<typeof journalEntryStatusSchema>;

/** `POST /api/finance/accounts` — `parentId` must reference an existing account in
 *  the same organisation (service-level check, not expressible in Zod alone). */
export const createChartOfAccountSchema = z.object({
  code: z.string().trim().min(1, 'Account code is required').max(20),
  name: z.string().trim().min(1, 'Account name is required').max(200),
  type: accountTypeSchema,
  parentId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateChartOfAccountInput = z.infer<typeof createChartOfAccountSchema>;

/** `PATCH /api/finance/accounts/:id` — `code`/`type`/`systemKey` are immutable after
 *  creation, deliberately absent here. */
export const updateChartOfAccountSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateChartOfAccountInput = z.infer<typeof updateChartOfAccountSchema>;

/** `POST /api/finance/accounting-periods` — overlap against existing periods for the
 *  same organisation is a service-level guard, not expressible here. */
export const createAccountingPeriodSchema = z
  .object({
    name: z.string().trim().min(1, 'Period name is required').max(100),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type CreateAccountingPeriodInput = z.infer<typeof createAccountingPeriodSchema>;

/** One line of a `POST /api/finance/journal-entries` request. Exactly one of
 *  `debit`/`credit` must be a positive number — a line can never carry both, and
 *  never neither. */
export const journalEntryLineInputSchema = z
  .object({
    accountId: z.string().trim().min(1, 'Account is required'),
    description: z.string().trim().max(500).optional(),
    debit: z.number().nonnegative().optional(),
    credit: z.number().nonnegative().optional(),
  })
  .refine(
    (line) => {
      const hasDebit = (line.debit ?? 0) > 0;
      const hasCredit = (line.credit ?? 0) > 0;
      return hasDebit !== hasCredit;
    },
    {
      message: 'Each line must have either a debit or a credit amount, not both or neither',
      path: ['debit'],
    },
  );
export type JournalEntryLineInput = z.infer<typeof journalEntryLineInputSchema>;

function isBalanced(lines: JournalEntryLineInput[]): boolean {
  const totalDebit = roundCurrency(lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
  const totalCredit = roundCurrency(lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
  return totalDebit === totalCredit;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `POST /api/finance/journal-entries` (Sprint 7) — creates a `DRAFT` manual journal
 * entry. `accountingPeriodId`/`journalNumber`/`status` are absent — the server
 * resolves the period from `date` and generates the number; never client-supplied.
 * Rejects an unbalanced entry even at `DRAFT` creation — this codebase has no
 * "edit a draft later" workflow, so there's no reason to ever persist one that could
 * never legally be posted.
 */
export const createJournalEntrySchema = z
  .object({
    date: z.coerce.date(),
    description: z.string().trim().min(1, 'Description is required').max(500),
    reference: z.string().trim().max(200).optional(),
    lines: z.array(journalEntryLineInputSchema).min(2, 'A journal entry needs at least two lines'),
  })
  .refine((data) => isBalanced(data.lines), {
    message: 'Total debits must equal total credits',
    path: ['lines'],
  });
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;
