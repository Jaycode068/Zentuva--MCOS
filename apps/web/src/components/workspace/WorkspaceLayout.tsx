'use client';

import { useState } from 'react';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * The permanent authenticated application shell (Sprint 3.5 brief §"Application Layout"):
 * Sidebar + Topbar + Main Content Area on desktop, with the sidebar collapsing into a
 * drawer on mobile. Every authenticated route renders this exactly once via
 * `app/(app)/layout.tsx` — a Next.js route group, so `/workspace`, `/settings/*`, and
 * `/account/*` all keep their existing URLs while sharing one layout instance instead of
 * each `layout.tsx` importing the top nav separately (the duplication this sprint removes).
 */
export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
