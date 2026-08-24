'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/finance' },
  { label: 'Invoices', href: '/settings/finance/invoices' },
  { label: 'Payments', href: '/settings/finance/payments' },
  { label: 'Receivables', href: '/settings/finance/receivables' },
  { label: 'Credit Notes', href: '/settings/finance/credit-notes' },
  { label: 'Chart of Accounts', href: '/settings/finance/accounts' },
  { label: 'Journal Entries', href: '/settings/finance/journal-entries' },
  { label: 'General Ledger', href: '/settings/finance/ledger' },
  { label: 'Trial Balance', href: '/settings/finance/trial-balance' },
  { label: 'Accounting Periods', href: '/settings/finance/accounting-periods' },
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
