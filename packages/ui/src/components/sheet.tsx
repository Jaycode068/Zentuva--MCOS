'use client';

import * as React from 'react';

import { cn } from '../lib/cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `'bottom'` = a rounded bottom sheet (pickers, action menus) — the default.
   *  `'full'` = a full-bleed, edge-to-edge panel (multi-step flows, a photo viewer). */
  side?: 'bottom' | 'full';
  children: React.ReactNode;
}

/**
 * A minimal controlled overlay for mobile-first flows (Sprint 4.8, Field Sales) — a
 * sibling to `Dialog`, not a variant of it: `Dialog` hardcodes a centered `max-w-md`
 * panel with no size prop, which can't express a bottom sheet or a full-screen step
 * flow. Reuses `Dialog`'s exact controlled `open`/`onOpenChange` API and its
 * Escape-to-close/click-outside-to-close behaviour verbatim — same "no Radix, hand-rolled
 * overlay" trade-off (no focus trapping) as every other overlay in this package.
 *
 * Also used by the Admin surface (mobile-width row actions, the outlet-photo viewer) —
 * not exclusive to Field Sales, hence living here rather than in an app-specific folder.
 */
export function Sheet({ open, onOpenChange, side = 'bottom', children }: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 border-border bg-background shadow-lg',
          side === 'bottom'
            ? 'fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'
            : 'fixed inset-0 flex flex-col overflow-y-auto',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 space-y-1', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex justify-end gap-3', className)} {...props} />;
}
