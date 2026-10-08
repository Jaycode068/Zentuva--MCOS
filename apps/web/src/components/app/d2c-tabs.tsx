'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Dashboard', href: '/settings/d2c' },
  { label: 'Orders', href: '/settings/d2c/orders' },
  { label: 'Exceptions', href: '/settings/d2c/exceptions' },
  { label: 'Collection Points', href: '/settings/d2c/collection-points' },
  { label: 'Territories', href: '/settings/d2c/territories' },
  { label: 'Consumers', href: '/settings/d2c/consumers' },
  { label: 'Promotions', href: '/settings/d2c/promotions' },
  { label: 'Loyalty', href: '/settings/d2c/loyalty' },
  { label: 'Conversation Tester', href: '/settings/d2c/conversation' },
  { label: 'Conversations', href: '/settings/d2c/conversations' },
  { label: 'Conversation Settings', href: '/settings/d2c/conversation-settings' },
  { label: 'WhatsApp Test', href: '/settings/d2c/whatsapp-test' },
];

/** Shared sub-navigation for the `/settings/d2c/*` pages (Sprint 39,
 *  docs/domains/d2c.md). "Promotions"/"Loyalty" added Sprint 40
 *  (docs/domains/d2c.md "Admin Experience") — the exact `HrTabs`/`MaintenanceTabs`
 *  clone/convention. "WhatsApp Test" added Sprint 40.5
 *  (docs/domains/whatsapp.md) — distinct from "Conversation Tester": that one drives
 *  the simulated internal Conversation Layer endpoint, this one sends a REAL outbound
 *  WhatsApp message through whichever provider is configured. "Exceptions" added
 *  Sprint 43 (docs/domains/d2c.md "Operational Exceptions") — the full,
 *  un-truncated view of the same `GET /d2c/admin/attention` list the dashboard's
 *  "Attention Required" section already shows inline. "Conversations" added Sprint
 *  43.5 (docs/domains/d2c.md "Conversation Traceability") — a read-only transcript +
 *  delivery-log viewer, distinct from "Conversation Tester" (which drives the real
 *  engine interactively); its path ("conversations") is a superstring of the
 *  Tester's ("conversation"), which is exactly why the active-tab match below is
 *  segment-aware rather than a bare `startsWith` — found while adding this tab, not
 *  a pre-existing bug report. */
export function D2cTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-border" aria-label="D2C">
      {TABS.map((tab) => {
        // Segment-aware match — exactly `tab.href`, or `tab.href` followed by `/` — so
        // `/settings/d2c/conversation` (the Tester) never also matches
        // `/settings/d2c/conversations` (the transcript viewer), which a plain
        // `startsWith` would incorrectly do.
        const active =
          tab.href === '/settings/d2c'
            ? pathname === tab.href
            : pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
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
