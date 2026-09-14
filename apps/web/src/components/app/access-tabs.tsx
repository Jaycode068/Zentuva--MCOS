'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/access' },
  { label: 'Roles', href: '/settings/access/roles' },
  { label: 'User Access', href: '/settings/access/users' },
  { label: 'Common Employee Access', href: '/settings/access/common-policy' },
  { label: 'Access Review', href: '/settings/access/audit-log' },
];

/** Shared sub-navigation for the `/settings/access/*` pages (Sprint 25,
 *  docs/domains/access-control.md) — the exact `HrTabs`/`MaintenanceTabs` clone/
 *  convention. */
export function AccessTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex gap-6 overflow-x-auto border-b border-border"
      aria-label="Access Control"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/settings/access' ? pathname === tab.href : pathname?.startsWith(tab.href);
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
