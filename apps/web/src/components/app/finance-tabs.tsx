'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/finance' },
  { label: 'Invoices', href: '/settings/finance/invoices' },
  { label: 'Payments', href: '/settings/finance/payments' },
  { label: 'Receivables', href: '/settings/finance/receivables' },
  { label: 'Credit Notes', href: '/settings/finance/credit-notes' },
  // Added Sprint 12 — Accounts Payable & Supplier Invoice Management.
  { label: 'Payables', href: '/settings/finance/payables' },
  { label: 'Supplier Payments', href: '/settings/finance/supplier-payments' },
  // Added Sprint 13 — Financial Statements & Management Reporting Foundation.
  { label: 'Profit & Loss', href: '/settings/finance/profit-loss' },
  { label: 'Balance Sheet', href: '/settings/finance/balance-sheet' },
  { label: 'Inventory Valuation', href: '/settings/finance/inventory-valuation' },
  { label: 'Chart of Accounts', href: '/settings/finance/accounts' },
  { label: 'Journal Entries', href: '/settings/finance/journal-entries' },
  { label: 'General Ledger', href: '/settings/finance/ledger' },
  { label: 'Trial Balance', href: '/settings/finance/trial-balance' },
  { label: 'Accounting Periods', href: '/settings/finance/accounting-periods' },
  // Added Sprint 14 — Cash & Bank Management / Reconciliation Foundation.
  { label: 'Cash Overview', href: '/settings/finance/cash' },
  { label: 'Cash Accounts', href: '/settings/finance/cash-accounts' },
  { label: 'Cash Transactions', href: '/settings/finance/cash-transactions' },
  { label: 'Bank Statements', href: '/settings/finance/bank-statements' },
  { label: 'Reconciliation', href: '/settings/finance/reconciliation' },
  // Added Sprint 15 — Cashflow Management & Forecasting.
  { label: 'Cashflow', href: '/settings/finance/cashflow' },
  { label: 'Cashflow Items', href: '/settings/finance/cashflow-items' },
  { label: 'Cashflow Scenarios', href: '/settings/finance/cashflow-scenarios' },
  // Added Sprint 16 — Budgeting & Financial Planning Foundation.
  { label: 'Budgets', href: '/settings/finance/budgets' },
  { label: 'Cost Centres', href: '/settings/finance/cost-centres' },
  // Added Sprint 17 — Capital & Debt Management Foundation.
  { label: 'Debt', href: '/settings/finance/debt' },
  { label: 'Capital Requirements', href: '/settings/finance/capital-requirements' },
  { label: 'Debt Facilities', href: '/settings/finance/debt-facilities' },
  // Added Sprint 18 — Investment / Capital Project Management Foundation.
  { label: 'Capital Projects', href: '/settings/finance/capital-projects' },
];

/** Shared sub-navigation for the ten `/settings/finance/*` pages (Sprint 6 Finance +
 *  Sprint 7 Accounting), exact clone of `AccountTabs`'s own shape and convention — this
 *  codebase has no generic `Tabs` primitive, and `AccountTabs` is the only precedent
 *  for a multi-section admin area. Imported and rendered directly by each page (no
 *  shared `layout.tsx`), matching how `account/*` pages each render `<AccountTabs />`
 *  themselves. `overflow-x-auto` keeps all ten tabs usable at narrow widths without
 *  wrapping into a second row. */
export function FinanceTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-border" aria-label="Finance">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <a
            key={tab.href}
            href={tab.href}
            className={cn(
              'shrink-0 whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
