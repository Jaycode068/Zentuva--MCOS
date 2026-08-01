import type { WorkspaceNavGroup } from './navigation-config';
import { NavigationItem } from './NavigationItem';

export function NavigationGroup({
  group,
  activeHref,
  onNavigate,
}: {
  group: WorkspaceNavGroup;
  activeHref: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
        {group.label}
      </p>
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavigationItem
            key={item.href}
            item={item}
            active={activeHref === item.href}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
