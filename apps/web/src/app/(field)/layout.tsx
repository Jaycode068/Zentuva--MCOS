import type { Viewport } from 'next';

import { FieldShell } from '@/components/field/FieldShell';

/**
 * Root layout for the mobile-first Field Sales experience (Sprint 4.8, brief §3/§4). A
 * server component purely so `viewport` can be exported here — `viewportFit: 'cover'`
 * is required for `env(safe-area-inset-bottom)` padding on the sticky bottom nav, and
 * Next.js only reads `viewport` from a server component. The actual shell (auth guard,
 * header, bottom nav) is the client component `FieldShell`.
 *
 * Deliberately a SEPARATE route group from `(app)` — nothing in `WorkspaceLayout`/
 * `Sidebar`/`Topbar` is mobile-first (see docs/domains/retail-network.md "Field Sales
 * Architecture"), so this shell is built from scratch rather than retrofitted.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <FieldShell>{children}</FieldShell>;
}
