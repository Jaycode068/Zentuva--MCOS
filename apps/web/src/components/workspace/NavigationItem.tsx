'use client';

import { cn } from '@zentuva/ui';

import type { WorkspaceNavItem } from './navigation-config';

/**
 * One sidebar row. Active state uses `bg-primary/10 text-primary` — the same
 * "active navigation" convention as the Workspace Settings tab rail (Sprint 3.4). A
 * `comingSoon` item renders as a non-interactive `<span>` (not an `<a>`) so it's
 * unclickable and generates no navigation/404, per the brief's "not generate errors."
 */
export function NavigationItem({
  item,
  active,
  onNavigate,
}: {
  item: WorkspaceNavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.comingSoon && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Coming Soon
        </span>
      )}
    </>
  );

  if (item.comingSoon) {
    return (
      <span
        className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
        aria-disabled="true"
        title="Coming soon"
      >
        {content}
      </span>
    );
  }

  return (
    <a
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {content}
    </a>
  );
}
