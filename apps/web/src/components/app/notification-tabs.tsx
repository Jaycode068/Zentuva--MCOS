'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Notifications', href: '/notifications' },
  { label: 'Preferences', href: '/notifications/preferences' },
  { label: 'Admin: Processing', href: '/notifications/admin' },
];

/** Shared sub-navigation for the `/notifications*` pages (Sprint 27.1) — the exact
 *  `WorkflowTabs` clone/convention. "Admin: Processing" is visible to every user
 *  (no client-side permission hook exists anywhere in this codebase); a
 *  non-administrator's API calls on that page 403 and the page renders a
 *  permission-denied state, matching every other admin-only surface's existing
 *  pattern. */
export function NotificationTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex gap-6 overflow-x-auto border-b border-border"
      aria-label="Notifications"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/notifications' ? pathname === tab.href : pathname?.startsWith(tab.href);
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
