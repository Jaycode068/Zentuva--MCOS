import { Card, cn } from '@zentuva/ui';

import type { WorkspaceIcon } from './icons';

export type ModuleAccent = 'purple' | 'pink' | 'orange' | 'teal';

/** Tailwind needs each class name literally in source (no `bg-${accent}/10` string
 *  interpolation) to pick it up at build time, so the accent→class mapping is an explicit
 *  lookup table rather than a computed string. */
const ACCENT_CLASSES: Record<ModuleAccent, string> = {
  purple: 'bg-brandPurple/10 text-brandPurple',
  pink: 'bg-primary/10 text-primary',
  orange: 'bg-brandOrange/10 text-brandOrange',
  teal: 'bg-brandTeal/10 text-brandTeal',
};

/**
 * One card in the Workspace Dashboard's "Platform Modules" grid — every module in
 * `navigation-config.ts`'s Workspace group gets one, active modules link out, "Coming
 * Soon" modules render disabled (Sprint 3.5 brief: "appear disabled, not generate
 * errors, do not hide future modules"). `accent` rotates purple/pink/orange/teal per the
 * brief's "navigation also reflects these brand colours, not just purple."
 */
export function ModuleCard({
  icon: Icon,
  title,
  description,
  href,
  accent,
  comingSoon,
}: {
  icon: WorkspaceIcon;
  title: string;
  description: string;
  href: string;
  accent: ModuleAccent;
  comingSoon?: boolean;
}) {
  const body = (
    <Card
      className={cn(
        'flex h-full flex-col gap-3 p-5 transition-colors',
        comingSoon ? 'opacity-60' : 'hover:border-primary/40 hover:bg-accent/50',
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            ACCENT_CLASSES[accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        {comingSoon && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Coming Soon
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </Card>
  );

  if (comingSoon) {
    return (
      <div className="cursor-not-allowed" aria-disabled="true" title="Coming soon">
        {body}
      </div>
    );
  }

  return (
    <a href={href} className="block">
      {body}
    </a>
  );
}
