import type { BadgeProps } from '@zentuva/ui';

import type {
  AccountingPeriodStatus,
  AccountType,
  BankReconciliationStatus,
  BankTransactionMatchStatus,
  BudgetLineType,
  BudgetStatus,
  CapitalProjectCategory,
  CapitalProjectFundingStatus,
  CapitalProjectFundingType,
  CapitalProjectStatus,
  CapitalRequirementPriority,
  CapitalRequirementStatus,
  CashAccountStatus,
  CashAccountType,
  CashTransactionType,
  CashflowConfidence,
  CashflowDirection,
  CashflowForecastSourceType,
  CashflowItemStatus,
  CashflowRecurrence,
  CostCentreStatus,
  CreditNoteStatus,
  DebtFacilityStatus,
  DebtScheduleStatus,
  DebtType,
  InvoiceStatus,
  JournalEntryStatus,
  LenderType,
  PaymentMethod,
  PaymentTermType,
  RepaymentFrequency,
  RepaymentMethod,
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

// === Cashflow Management (Sprint 15, docs/domains/cashflow.md) ===

export const CASHFLOW_DIRECTION_LABELS: Record<CashflowDirection, string> = {
  INFLOW: 'Inflow',
  OUTFLOW: 'Outflow',
};

export const CASHFLOW_RECURRENCE_LABELS: Record<CashflowRecurrence, string> = {
  ONE_TIME: 'One-Time',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export const CASHFLOW_ITEM_STATUS_LABELS: Record<CashflowItemStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const CASHFLOW_ITEM_STATUS_VARIANT: Record<
  CashflowItemStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const CASHFLOW_SOURCE_TYPE_LABELS: Record<CashflowForecastSourceType, string> = {
  CUSTOMER_RECEIVABLE: 'Customer Receivable',
  SUPPLIER_PAYABLE: 'Supplier Payable',
  RECURRING_ITEM: 'Recurring Item',
  MANUAL_FORECAST: 'Manual Forecast',
  // Added Sprint 17 — was missing from this map (a pre-existing gap fixed
  // during Sprint 18 live verification, see docs/sprint-18-completion-report.md).
  LOAN_REPAYMENT: 'Loan Repayment',
  // Added Sprint 18.
  CAPITAL_PROJECT: 'Capital Project',
  OTHER: 'Other',
};

export const CASHFLOW_CONFIDENCE_LABELS: Record<CashflowConfidence, string> = {
  CONFIRMED: 'Confirmed',
  EXPECTED: 'Expected',
  ESTIMATED: 'Estimated',
};

export const CASHFLOW_CONFIDENCE_VARIANT: Record<
  CashflowConfidence,
  NonNullable<BadgeProps['variant']>
> = {
  CONFIRMED: 'success',
  EXPECTED: 'default',
  ESTIMATED: 'warning',
};

// === Budgeting & Financial Planning (Sprint 16, docs/domains/budgeting.md) ===

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  SUPERSEDED: 'Superseded',
  CLOSED: 'Closed',
};

export const BUDGET_STATUS_VARIANT: Record<BudgetStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  APPROVED: 'warning',
  ACTIVE: 'success',
  SUPERSEDED: 'default',
  CLOSED: 'destructive',
};

export const BUDGET_LINE_TYPE_LABELS: Record<BudgetLineType, string> = {
  REVENUE: 'Revenue',
  OPERATING_EXPENSE: 'Operating Expense',
  CAPEX: 'CAPEX',
};

export const COST_CENTRE_STATUS_LABELS: Record<CostCentreStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const COST_CENTRE_STATUS_VARIANT: Record<
  CostCentreStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

// === Capital & Debt Management (Sprint 17, docs/domains/debt-management.md) ===

export const LENDER_TYPE_LABELS: Record<LenderType, string> = {
  BANK: 'Bank',
  FINANCIAL_INSTITUTION: 'Financial Institution',
  INVESTOR: 'Investor',
  DIRECTOR: 'Director',
  SHAREHOLDER: 'Shareholder',
  OTHER: 'Other',
};

export const CAPITAL_REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  CAPEX: 'CAPEX',
  WORKING_CAPITAL: 'Working Capital',
  EXPANSION: 'Expansion',
  EQUIPMENT: 'Equipment',
  OTHER: 'Other',
};

export const CAPITAL_REQUIREMENT_PRIORITY_LABELS: Record<CapitalRequirementPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const CAPITAL_REQUIREMENT_PRIORITY_VARIANT: Record<
  CapitalRequirementPriority,
  NonNullable<BadgeProps['variant']>
> = {
  LOW: 'default',
  MEDIUM: 'default',
  HIGH: 'warning',
  CRITICAL: 'destructive',
};

export const CAPITAL_REQUIREMENT_STATUS_LABELS: Record<CapitalRequirementStatus, string> = {
  DRAFT: 'Draft',
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  FUNDED: 'Funded',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const CAPITAL_REQUIREMENT_STATUS_VARIANT: Record<
  CapitalRequirementStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  PROPOSED: 'default',
  APPROVED: 'warning',
  FUNDED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  TERM_LOAN: 'Term Loan',
  WORKING_CAPITAL: 'Working Capital',
  ASSET_FINANCE: 'Asset Finance',
  OVERDRAFT: 'Overdraft',
  OTHER: 'Other',
};

export const REPAYMENT_METHOD_LABELS: Record<RepaymentMethod, string> = {
  AMORTISING: 'Amortising',
  INTEREST_ONLY: 'Interest-Only',
  BULLET: 'Bullet',
};

export const REPAYMENT_FREQUENCY_LABELS: Record<RepaymentFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export const DEBT_FACILITY_STATUS_LABELS: Record<DebtFacilityStatus, string> = {
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  PARTIALLY_REPAID: 'Partially Repaid',
  PAID_OFF: 'Paid Off',
  CANCELLED: 'Cancelled',
  DEFAULTED: 'Defaulted',
};

export const DEBT_FACILITY_STATUS_VARIANT: Record<
  DebtFacilityStatus,
  NonNullable<BadgeProps['variant']>
> = {
  PROPOSED: 'default',
  APPROVED: 'warning',
  ACTIVE: 'success',
  PARTIALLY_REPAID: 'warning',
  PAID_OFF: 'success',
  CANCELLED: 'destructive',
  DEFAULTED: 'destructive',
};

export const DEBT_SCHEDULE_STATUS_LABELS: Record<DebtScheduleStatus, string> = {
  SCHEDULED: 'Scheduled',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

export const DEBT_SCHEDULE_STATUS_VARIANT: Record<
  DebtScheduleStatus,
  NonNullable<BadgeProps['variant']>
> = {
  SCHEDULED: 'default',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
};

// === Investment / Capital Project Management (Sprint 18, docs/domains/investment-projects.md) ===

export const CAPITAL_PROJECT_CATEGORY_LABELS: Record<CapitalProjectCategory, string> = {
  PRODUCTION_EQUIPMENT: 'Production Equipment',
  FACTORY_EXPANSION: 'Factory Expansion',
  WAREHOUSE: 'Warehouse',
  VEHICLE: 'Vehicle',
  POWER_ENERGY: 'Power / Energy',
  TECHNOLOGY: 'Technology',
  INFRASTRUCTURE: 'Infrastructure',
  OTHER: 'Other',
};

export const CAPITAL_PROJECT_STATUS_LABELS: Record<CapitalProjectStatus, string> = {
  DRAFT: 'Draft',
  PROPOSED: 'Proposed',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const CAPITAL_PROJECT_STATUS_VARIANT: Record<
  CapitalProjectStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  PROPOSED: 'default',
  UNDER_REVIEW: 'warning',
  APPROVED: 'warning',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

export const CAPITAL_PROJECT_FUNDING_TYPE_LABELS: Record<CapitalProjectFundingType, string> = {
  CASH: 'Cash',
  DEBT: 'Debt',
  OTHER: 'Other',
};

export const CAPITAL_PROJECT_FUNDING_STATUS_LABELS: Record<CapitalProjectFundingStatus, string> = {
  FULLY_FUNDED: 'Fully Funded',
  UNDERFUNDED: 'Underfunded',
  OVERFUNDED: 'Overfunded',
};

export const CAPITAL_PROJECT_FUNDING_STATUS_VARIANT: Record<
  CapitalProjectFundingStatus,
  NonNullable<BadgeProps['variant']>
> = {
  FULLY_FUNDED: 'success',
  UNDERFUNDED: 'warning',
  OVERFUNDED: 'default',
};
