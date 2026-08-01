import { orgInitialsFor } from '@/lib/org-initials';
import type { WorkspaceSettings } from '@/lib/settings';

const THEME_LABEL: Record<WorkspaceSettings['theme'], string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * The Workspace Dashboard's welcome section (Sprint 3.5 brief: "Welcome back,
 * {Organisation Name}" + Organisation Logo + Organisation Name + Workspace Theme).
 * Deliberately not a KPI/metrics header — this sprint's dashboard is navigation-oriented,
 * per the brief's explicit "Not metric-heavy" instruction.
 */
export function WorkspaceHeader({ settings }: { settings: WorkspaceSettings }) {
  const orgName = settings.displayName?.trim() || settings.organisationName;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {settings.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL
          <img
            src={settings.logoUrl}
            alt=""
            className="h-12 w-12 rounded-lg border border-border object-contain"
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {orgInitialsFor(orgName)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {orgName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {settings.organisationCode} · Workspace Theme: {THEME_LABEL[settings.theme]}
          </p>
        </div>
      </div>
    </div>
  );
}
