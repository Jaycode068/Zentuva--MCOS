'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

import { WORKSPACE_NAV_GROUPS } from './navigation-config';
import { NavigationGroup } from './NavigationGroup';

/**
 * The permanent left sidebar (Sprint 3.5 brief §"Application Layout"). Renders as a fixed
 * column on desktop (`lg:` and up) and as a slide-over drawer on mobile/tablet, both
 * sharing the same nav content so there's exactly one place the module list is defined
 * (`navigation-config.ts`) — "Do not duplicate navigation across pages."
 */
export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();

  const navContent = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {WORKSPACE_NAV_GROUPS.map((group) => (
        <NavigationGroup
          key={group.label}
          group={group}
          activeHref={pathname}
          onNavigate={onClose}
        />
      ))}
    </nav>
  );

  return (
    <>
      <aside className="hidden shrink-0 border-r border-border bg-card lg:flex lg:w-64 lg:flex-col">
        {navContent}
      </aside>

      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-foreground/30 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={onClose}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl transition-transform',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          role="dialog"
          aria-label="Workspace navigation"
        >
          {navContent}
        </aside>
      </div>
    </>
  );
}
