import { Card } from '@zentuva/ui';

import type { WorkspaceIcon } from './icons';

/**
 * One card in the Workspace Dashboard's "Quick Actions" grid (Sprint 3.5 brief — "Manage
 * Organisation, Manage Users, Product Catalogue, View Profile"). Plain navigation, no
 * business logic: clicking sends the user to an existing page.
 */
export function QuickActionCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: WorkspaceIcon;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a href={href} className="block">
      <Card className="flex h-full items-start gap-4 p-5 transition-colors hover:border-primary/40 hover:bg-accent/50">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </Card>
    </a>
  );
}
