/**
 * Audit action strings for `ChartOfAccount`, `AccountingPeriod`, and `JournalEntry`
 * (Sprint 7, docs/domains/accounting.md). Same `<entity>.<event>` naming convention as
 * `FINANCE_AUDIT_ACTIONS` — the exact list the brief specifies verbatim.
 */
export const ACCOUNTING_AUDIT_ACTIONS = {
  ACCOUNT_CREATED: 'account.created',
  ACCOUNT_UPDATED: 'account.updated',
  ACCOUNT_ACTIVATED: 'account.activated',
  ACCOUNT_DEACTIVATED: 'account.deactivated',
  ACCOUNTING_PERIOD_CREATED: 'accounting-period.created',
  ACCOUNTING_PERIOD_CLOSED: 'accounting-period.closed',
  JOURNAL_ENTRY_CREATED: 'journal-entry.created',
  JOURNAL_ENTRY_POSTED: 'journal-entry.posted',
  JOURNAL_ENTRY_VOIDED: 'journal-entry.voided',
} as const;
