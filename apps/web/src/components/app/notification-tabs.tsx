'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

/** `exactOnly: true` means this tab is never treated as an ancestor of another
 *  route — required for `/notifications/admin`, since `/notifications/admin/email`
 *  (Sprint 28) is a SIBLING tab, not a sub-page of "Admin: Processing"; a plain
 *  `startsWith` match would incorrectly highlight both simultaneously. */
const TABS = [
  { label: 'Notifications', href: '/notifications', exactOnly: true },
  { label: 'Preferences', href: '/notifications/preferences', exactOnly: false },
  { label: 'Admin: Processing', href: '/notifications/admin', exactOnly: true },
  { label: 'Admin: Email Deliveries', href: '/notifications/admin/email', exactOnly: false },
  { label: 'Admin: WhatsApp Deliveries', href: '/notifications/admin/whatsapp', exactOnly: false },
];

/** Shared sub-navigation for the `/notifications*` pages (Sprint 27.1, extended
 *  Sprint 28, Sprint 29) — the exact `WorkflowTabs` clone/convention. Every
 *  "Admin:" tab is visible to every user (no client-side permission hook
 *  exists anywhere in this codebase); a non-administrator's API calls on any
 *  of them 403 and the page renders a permission-denied state, matching every
 *  other admin-only surface's existing pattern. */
export function NotificationTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex gap-6 overflow-x-auto border-b border-border"
      aria-label="Notifications"
    >
      {TABS.map((tab) => {
        const active = tab.exactOnly ? pathname === tab.href : pathname?.startsWith(tab.href);
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
