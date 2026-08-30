/**
 * Audit action strings for Sprint 14's Cash & Bank Management / Reconciliation
 * Foundation (docs/domains/cash-management.md) — `CashAccount`, `CashTransaction`,
 * `BankStatementImport`, `BankReconciliation`. Same `<entity>.<event>` naming
 * convention as `accounts-payable-audit-actions.ts`/`finance-audit-actions.ts`.
 *
 * No handler that records any of these events ever places a `CashAccount`'s full
 * `accountNumber` into `metadata` — see docs/domains/cash-management.md "Bank
 * Account Security".
 */
export const CASH_BANK_AUDIT_ACTIONS = {
  CASH_ACCOUNT_CREATED: 'cash-account.created',
  CASH_ACCOUNT_UPDATED: 'cash-account.updated',
  CASH_ACCOUNT_DEACTIVATED: 'cash-account.deactivated',
  CASH_ACCOUNT_ACTIVATED: 'cash-account.activated',
  CASH_ACCOUNT_NUMBER_REVEALED: 'cash-account.number-revealed',
  CASH_OPENING_BALANCE_POSTED: 'cash-opening-balance.posted',
  CASH_TRANSACTION_CREATED: 'cash-transaction.created',
  CASH_TRANSACTION_VOIDED: 'cash-transaction.voided',
  BANK_STATEMENT_IMPORTED: 'bank-statement.imported',
  BANK_RECONCILIATION_CREATED: 'bank-reconciliation.created',
  BANK_RECONCILIATION_MATCHED: 'bank-reconciliation.matched',
  BANK_RECONCILIATION_AUTO_MATCHED: 'bank-reconciliation.auto-matched',
  BANK_RECONCILIATION_UNMATCHED: 'bank-reconciliation.unmatched',
  BANK_RECONCILIATION_COMPLETED: 'bank-reconciliation.completed',
} as const;
