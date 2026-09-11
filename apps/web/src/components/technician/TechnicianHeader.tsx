'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Slim, app-like header for the Field Technician Maintenance shell —
 * a back chevron on every screen except Home, and the Zentuva mark. The
 * `FieldHeader` equivalent for a different audience: deliberately its own
 * component, not shared with Field Sales, so its branding never implies a
 * technician is inside the Sales app.
 */
export function TechnicianHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === '/technician';

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur">
      {!isHome && (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <Link href="/technician" className="text-sm font-semibold tracking-tight text-brandPurple">
        Zentuva Maintenance
      </Link>
    </header>
  );
}
