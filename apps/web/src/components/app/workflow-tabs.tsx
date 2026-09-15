'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const TABS = [
  { label: 'Overview', href: '/settings/workflows' },
  { label: 'Workflow Definitions', href: '/settings/workflows/definitions' },
  { label: 'Workflow Instances', href: '/settings/workflows/instances' },
  { label: 'My Approvals', href: '/settings/workflows/my-approvals' },
];

/** Shared sub-navigation for the `/settings/workflows/*` pages (Sprint 26,
 *  docs/domains/workflow.md) — the exact `AccessTabs` clone/convention. */
export function WorkflowTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex gap-6 overflow-x-auto border-b border-border"
      aria-label="Workflow & Approval"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/settings/workflows'
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
