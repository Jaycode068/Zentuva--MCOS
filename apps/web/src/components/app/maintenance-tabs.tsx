'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/maintenance' },
  { label: 'Work Orders', href: '/settings/maintenance/work-orders' },
  { label: 'Requests', href: '/settings/maintenance/requests' },
  { label: 'Plans', href: '/settings/maintenance/plans' },
  { label: 'Schedules', href: '/settings/maintenance/schedules' },
];

/** Shared sub-navigation for the `/settings/maintenance/*` pages (Sprint
 *  21, docs/domains/maintenance.md) — the exact `AssetTabs` clone/
 *  convention. Five tabs, deliberately lean — Technicians/Downtime/Costs
 *  surface within Work Order detail and the Overview dashboard instead of
 *  their own tabs. */
export function MaintenanceTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex gap-6 overflow-x-auto border-b border-border"
      aria-label="Maintenance"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/settings/maintenance'
            ? pathname === tab.href
            : pathname?.startsWith(tab.href);
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
