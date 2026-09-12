'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/hr' },
  { label: 'Employees', href: '/settings/hr/employees' },
  { label: 'Departments', href: '/settings/hr/departments' },
  { label: 'Positions', href: '/settings/hr/positions' },
  { label: 'Organisation Structure', href: '/settings/hr/structure' },
];

/** Shared sub-navigation for the `/settings/hr/*` pages (Sprint 23,
 *  docs/domains/hr.md) — the exact `MaintenanceTabs`/`AssetTabs` clone/
 *  convention. */
export function HrTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-border" aria-label="HR">
      {TABS.map((tab) => {
        const active =
          tab.href === '/settings/hr' ? pathname === tab.href : pathname?.startsWith(tab.href);
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
