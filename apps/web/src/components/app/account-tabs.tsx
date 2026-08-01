'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'My Profile', href: '/account/profile' },
  { label: 'Security', href: '/account/security' },
  { label: 'Active Sessions', href: '/account/sessions' },
];

/** Shared sub-navigation for the three `/account/*` pages (Sprint 3.3). Active tab uses
 *  `text-primary`/`border-primary` (pink) — this app's convention for "active navigation"
 *  (Sprint 3.2 brand-balance brief). */
export function AccountTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex gap-6 border-b border-border" aria-label="Account settings">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <a
            key={tab.href}
            href={tab.href}
            className={cn(
              'border-b-2 pb-3 text-sm font-medium transition-colors',
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
