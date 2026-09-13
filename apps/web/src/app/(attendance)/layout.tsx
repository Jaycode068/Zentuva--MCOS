import type { Viewport } from 'next';

import { AttendanceShell } from '@/components/attendance/AttendanceShell';

/**
 * Root layout for the mobile-first self-service Attendance experience
 * (Sprint 24) — a server component purely so `viewport` can be exported
 * here (Next.js only reads it from a server component); the actual shell
 * (auth guard, header) is the client component `AttendanceShell`.
 *
 * Deliberately a separate route group from `(app)`, `(field)`, and
 * `(technician)` — see `AttendanceShell` for the full rationale.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <AttendanceShell>{children}</AttendanceShell>;
}
