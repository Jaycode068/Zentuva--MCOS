import type { BadgeProps } from '@zentuva/ui';

import type {
  AccountingPeriodStatus,
  AccountType,
  BankReconciliationStatus,
  BankTransactionMatchStatus,
  CashAccountStatus,
  CashAccountType,
  CashTransactionType,
  CreditNoteStatus,
  InvoiceStatus,
  JournalEntryStatus,
  PaymentMethod,
  PaymentTermType,
  SupplierInvoiceMatchStatus,
  SupplierInvoiceStatus,
} from './api';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
};

export const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  ISSUED: 'default',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
  VOID: 'destructive',
};

export const PAYMENT_TERM_LABELS: Record<PaymentTermType, string> = {
  CASH: 'Cash',
  DUE_ON_RECEIPT: 'Due on Receipt',
  NET_7: 'Net 7',
  NET_14: 'Net 14',
  NET_30: 'Net 30',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  POS: 'POS',
  OTHER: 'Other',
};

export const CREDIT_NOTE_STATUS_LABELS: Record<CreditNoteStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  VOID: 'Void',
};

export const CREDIT_NOTE_STATUS_VARIANT: Record<
  CreditNoteStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  ISSUED: 'success',
  VOID: 'destructive',
};

// === Accounting (Sprint 7, docs/domains/accounting.md) ===

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  COST_OF_SALES: 'Cost of Sales',
  EXPENSE: 'Expense',
};

export const ACCOUNTING_PERIOD_STATUS_LABELS: Record<AccountingPeriodStatus, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
};

export const ACCOUNTING_PERIOD_STATUS_VARIANT: Record<
  AccountingPeriodStatus,
  NonNullable<BadgeProps['variant']>
> = {
  OPEN: 'success',
  CLOSED: 'default',
};

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  VOID: 'Void',
};

export const JOURNAL_ENTRY_STATUS_VARIANT: Record<
  JournalEntryStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  POSTED: 'success',
  VOID: 'destructive',
};

export const JOURNAL_SOURCE_TYPE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  CREDIT_NOTE: 'Credit Note',
  // Added Sprint 8 — Procurement/Inventory's Goods Receipt → Accounting integration.
  GOODS_RECEIPT: 'Goods Receipt',
  // Added Sprint 9 — Production's Material Issue/Completion → Accounting integration.
  PRODUCTION_MATERIAL_ISSUE: 'Material Issue',
  PRODUCTION_RUN: 'Production Completion',
  // Added Sprint 10 — Sales Fulfilment → COGS Accounting integration.
  SALES_FULFILMENT: 'Sales Fulfilment',
  // Added Sprint 12 — Accounts Payable & Supplier Invoice Management.
  SUPPLIER_INVOICE: 'Supplier Invoice',
  SUPPLIER_PAYMENT: 'Supplier Payment',
  SUPPLIER_CREDIT_NOTE: 'Supplier Credit Note',
};

// === Accounts Payable (Sprint 12, docs/domains/finance.md "Accounts Payable") ===

export const SUPPLIER_INVOICE_STATUS_LABELS: Record<SupplierInvoiceStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
};

export const SUPPLIER_INVOICE_STATUS_VARIANT: Record<
  SupplierInvoiceStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  POSTED: 'default',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
  VOID: 'destructive',
};

export const SUPPLIER_INVOICE_MATCH_STATUS_LABELS: Record<SupplierInvoiceMatchStatus, string> = {
  UNVERIFIED: 'Unverified',
  MATCHED: 'Matched',
  DISCREPANCY: 'Discrepancy',
};

export const SUPPLIER_INVOICE_MATCH_STATUS_VARIANT: Record<
  SupplierInvoiceMatchStatus,
  NonNullable<BadgeProps['variant']>
> = {
  UNVERIFIED: 'default',
  MATCHED: 'success',
  DISCREPANCY: 'warning',
};

// === Cash & Bank Management (Sprint 14, docs/domains/cash-management.md) ===

export const CASH_ACCOUNT_TYPE_LABELS: Record<CashAccountType, string> = {
  BANK: 'Bank',
  CASH: 'Cash',
  OTHER_CASH_EQUIVALENT: 'Other Cash Equivalent',
};

export const CASH_ACCOUNT_STATUS_LABELS: Record<CashAccountStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const CASH_ACCOUNT_STATUS_VARIANT: Record<
  CashAccountStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const CASH_TRANSACTION_TYPE_LABELS: Record<CashTransactionType, string> = {
  RECEIPT: 'Receipt',
  PAYMENT: 'Payment',
};

export const BANK_TRANSACTION_MATCH_STATUS_LABELS: Record<BankTransactionMatchStatus, string> = {
  UNMATCHED: 'Unmatched',
  MATCHED: 'Matched',
  RECONCILED: 'Reconciled',
};

export const BANK_TRANSACTION_MATCH_STATUS_VARIANT: Record<
  BankTransactionMatchStatus,
  NonNullable<BadgeProps['variant']>
> = {
  UNMATCHED: 'warning',
  MATCHED: 'default',
  RECONCILED: 'success',
};

export const BANK_RECONCILIATION_STATUS_LABELS: Record<BankReconciliationStatus, string> = {
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

export const BANK_RECONCILIATION_STATUS_VARIANT: Record<
  BankReconciliationStatus,
  NonNullable<BadgeProps['variant']>
> = {
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
};
