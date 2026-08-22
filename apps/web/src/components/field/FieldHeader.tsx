'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Slim, app-like header for the Field Sales shell — a back chevron on every screen
 * except Home (browser back-button behaviour would work too, but a visible affordance
 * matches the "easy back navigation" priority from the brief), and the Zentuva mark.
 * Deliberately not the ~64px desktop `Topbar` — every pixel of vertical space matters
 * on a phone screen doing task-focused work.
 */
export function FieldHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === '/field';

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
      <Link href="/field" className="text-sm font-semibold tracking-tight text-brandPurple">
        Zentuva Sales
      </Link>
    </header>
  );
}
