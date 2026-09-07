'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/assets' },
  { label: 'Assets', href: '/settings/assets/register' },
  { label: 'Categories', href: '/settings/assets/categories' },
  { label: 'Locations', href: '/settings/assets/locations' },
];

/** Shared sub-navigation for the `/settings/assets/*` pages (Sprint 20,
 *  docs/domains/assets.md) — the exact `FinanceTabs` clone/convention.
 *  Four tabs only, deliberately lean for a brand-new domain — Transfers
 *  and Documents live on the asset detail page instead of their own tabs. */
export function AssetTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-border" aria-label="Assets">
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
