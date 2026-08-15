'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { BoxIcon, BuildingIcon, UserIcon, UsersIcon } from '@/components/workspace/icons';
import { ModuleCard, type ModuleAccent } from '@/components/workspace/ModuleCard';
import { WORKSPACE_NAV_GROUPS } from '@/components/workspace/navigation-config';
import { QuickActionCard } from '@/components/workspace/QuickActionCard';
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader';
import { ApiError } from '@/lib/api-client';
import { getWorkspaceSettings } from '@/lib/settings';

const QUICK_ACTIONS = [
  {
    icon: BuildingIcon,
    title: 'Manage Organisation',
    description: 'Branding, regional and business settings.',
    href: '/settings/organisation',
  },
  {
    icon: UsersIcon,
    title: 'Manage Users',
    description: 'Invite, edit, and manage your team.',
    href: '/settings/users',
  },
  {
    icon: BoxIcon,
    title: 'Product Catalogue',
    description: 'Manage what your organisation manufactures and sells.',
    href: '/settings/products',
  },
  {
    icon: UserIcon,
    title: 'View Profile',
    description: 'Your personal account details.',
    href: '/account/profile',
  },
];

/** Purple/pink/orange/teal rotation across the module grid, per the Sprint 3.5 brief:
 *  "navigation also reflects these brand colours, not just purple." */
const MODULE_ACCENTS: ModuleAccent[] = ['purple', 'pink', 'orange', 'teal'];

const MODULE_DESCRIPTIONS: Record<string, string> = {
  '/workspace': 'Your workspace overview and quick links.',
  '/settings/products': 'The master catalogue of everything you manufacture or sell.',
  '/settings/procurement': 'Purchase orders for raw materials, packaging, and supplies.',
  '/settings/suppliers': 'The master record of every vendor you buy from.',
  '/settings/inventory': 'Live stock levels and the goods receipts that built them.',
  '/production': 'Recipes, batch production, and quality control.',
  '/assets': 'Manage factory equipment, vehicles and long-term business assets.',
  '/maintenance': 'Schedule preventive maintenance and manage equipment servicing.',
  '/sales': 'Customers, orders, invoicing, and payments.',
  '/distribution': 'Sales reps, distributors, and delivery tracking.',
  '/finance': 'Financial records and reporting.',
  '/reports': 'Dashboards and business intelligence.',
};

/**
 * Workspace Dashboard (Sprint 3.5) — the permanent authenticated landing page after login.
 * Deliberately navigation-oriented, not metric-heavy: no charts, KPIs, or business
 * metrics per the brief's explicit "Out of Scope." Recent Activity and Platform Status
 * are static placeholders with no backend behind them, same as the Security tab
 * placeholder pattern from Sprint 3.4.
 */
export default function WorkspaceDashboardPage() {
  const {
    data: settings,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['settings', 'workspace'],
    queryFn: getWorkspaceSettings,
  });

  // Every module except Dashboard itself — this page *is* the Dashboard, so it would be a
  // redundant self-link tile in its own "Platform Modules" grid.
  const workspaceModules = WORKSPACE_NAV_GROUPS[0]!.items.filter(
    (item) => item.href !== '/workspace',
  );

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        Loading your workspace…
      </main>
    );
  }

  if (isError || !settings) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load your workspace.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      <WorkspaceHeader settings={settings} />

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <QuickActionCard key={action.title} {...action} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Platform Modules
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaceModules.map((item, index) => (
            <ModuleCard
              key={item.href}
              icon={item.icon}
              title={item.label}
              description={MODULE_DESCRIPTIONS[item.href] ?? 'Coming soon.'}
              href={item.href}
              comingSoon={item.comingSoon}
              accent={MODULE_ACCENTS[index % MODULE_ACCENTS.length]!}
            />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Recent activity will appear here.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-foreground">Identity</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Workspace</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Product Catalogue</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Supplier Management</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Procurement</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Inventory</span>
                <span className="text-primary">✓ Complete</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-foreground">Production</span>
                <span className="text-muted-foreground">Coming Next</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              This will later become system health.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
