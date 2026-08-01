'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { getWorkspaceSettings } from '@/lib/settings';

import { BrandingTab } from './tabs/branding-tab';
import { BusinessTab } from './tabs/business-tab';
import { GeneralTab } from './tabs/general-tab';
import { PreferencesTab } from './tabs/preferences-tab';
import { RegionalTab } from './tabs/regional-tab';
import { SecurityTab } from './tabs/security-tab';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'branding', label: 'Branding' },
  { id: 'regional', label: 'Regional' },
  { id: 'business', label: 'Business' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'security', label: 'Security' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Workspace Configuration Center (Sprint 3.4) — replaces the single-page Organisation
 * Settings (Sprint 2.1) with a multi-tab layout, per the brief. Every tab shares one
 * `GET /api/settings/workspace` query (key `['settings', 'workspace']`) — the same key
 * `AuthenticatedNav` uses for branding, so a save on any tab keeps the nav's logo/colours
 * in sync automatically via `queryClient.setQueryData`. Each tab saves independently
 * (its own `PATCH` call, its own mutation state) — this shell only owns which tab is
 * visible and the one shared read.
 */
export default function WorkspaceSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  const {
    data: settings,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['settings', 'workspace'],
    queryFn: getWorkspaceSettings,
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">
        Loading workspace settings…
      </main>
    );
  }

  if (isError || !settings) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load workspace settings.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {settings.organisationCode} · Make Zentuva feel like your own operating system.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <nav
          className="flex gap-1 overflow-x-auto pb-2 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
          aria-label="Workspace settings sections"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === 'general' && <GeneralTab settings={settings} />}
          {activeTab === 'branding' && <BrandingTab settings={settings} />}
          {activeTab === 'regional' && <RegionalTab settings={settings} />}
          {activeTab === 'business' && <BusinessTab settings={settings} />}
          {activeTab === 'preferences' && <PreferencesTab settings={settings} />}
          {activeTab === 'security' && <SecurityTab />}
        </div>
      </div>
    </main>
  );
}
