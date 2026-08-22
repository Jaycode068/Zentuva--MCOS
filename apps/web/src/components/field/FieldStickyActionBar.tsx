import { cn } from '@zentuva/ui';

/**
 * A sticky primary-action bar pinned above the bottom nav on every create/edit screen
 * (Sprint 4.8 brief §3 "sticky primary actions"). Sits at `bottom-16` — the height of
 * `FieldBottomNav` — so it never overlaps the tab bar.
 */
export function FieldStickyActionBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-16 z-20 flex gap-2 border-t border-border bg-background/95 p-3 backdrop-blur',
        className,
      )}
    >
      {children}
    </div>
  );
}
