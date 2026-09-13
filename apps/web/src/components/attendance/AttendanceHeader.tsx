'use client';

import Link from 'next/link';

/**
 * Slim header for the self-service Attendance shell — the exact
 * `TechnicianHeader` pattern (Sprint 22), its own component so this
 * surface never implies it's part of Field Sales or Field Maintenance.
 * A single screen, so no back chevron is needed.
 */
export function AttendanceHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur">
      <Link href="/attendance" className="text-sm font-semibold tracking-tight text-brandPurple">
        Zentuva Attendance
      </Link>
    </header>
  );
}
