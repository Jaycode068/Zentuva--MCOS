import type { Viewport } from 'next';

import { TechnicianShell } from '@/components/technician/TechnicianShell';

/**
 * Root layout for the mobile-first Field Technician Maintenance
 * experience (Sprint 22). A server component purely so `viewport` can be
 * exported here (Next.js only reads it from a server component); the
 * actual shell (auth guard, header) is the client component
 * `TechnicianShell`.
 *
 * Deliberately a SEPARATE route group from both `(app)` and `(field)` —
 * not a tab bolted onto the Field Sales shell. See `TechnicianShell` for
 * the full rationale.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function TechnicianLayout({ children }: { children: React.ReactNode }) {
  return <TechnicianShell>{children}</TechnicianShell>;
}
