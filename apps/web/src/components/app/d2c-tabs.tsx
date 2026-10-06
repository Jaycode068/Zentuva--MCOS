'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Dashboard', href: '/settings/d2c' },
  { label: 'Orders', href: '/settings/d2c/orders' },
  { label: 'Collection Points', href: '/settings/d2c/collection-points' },
  { label: 'Territories', href: '/settings/d2c/territories' },
  { label: 'Consumers', href: '/settings/d2c/consumers' },
  { label: 'Promotions', href: '/settings/d2c/promotions' },
  { label: 'Loyalty', href: '/settings/d2c/loyalty' },
  { label: 'Conversation Tester', href: '/settings/d2c/conversation' },
  { label: 'WhatsApp Test', href: '/settings/d2c/whatsapp-test' },
];

/** Shared sub-navigation for the `/settings/d2c/*` pages (Sprint 39,
 *  docs/domains/d2c.md). "Promotions"/"Loyalty" added Sprint 40
 *  (docs/domains/d2c.md "Admin Experience") — the exact `HrTabs`/`MaintenanceTabs`
 *  clone/convention. "WhatsApp Test" added Sprint 40.5
 *  (docs/domains/whatsapp.md) — distinct from "Conversation Tester": that one drives
 *  the simulated internal Conversation Layer endpoint, this one sends a REAL outbound
 *  WhatsApp message through whichever provider is configured. */
export function D2cTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-border" aria-label="D2C">
      {TABS.map((tab) => {
        const active =
          tab.href === '/settings/d2c' ? pathname === tab.href : pathname?.startsWith(tab.href);
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
