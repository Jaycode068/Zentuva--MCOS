/**
 * The shape of `Organisation.settings` (Sprint 3.4 brief §5 "store as structured
 * settings"). Low-cardinality, behavioural preferences that don't warrant their own
 * columns — contrast with the Regional/Business fields, which are plain typed columns on
 * `Organisation` following the pattern established in Sprint 2.1/1B.1.
 *
 * `mergeWorkspaceSettings` deep-merges whatever is actually stored (which may be `{}` for
 * every organisation created before this sprint, or a partial object if a future sprint
 * adds a new preference) over {@link DEFAULT_WORKSPACE_SETTINGS}, so every read always
 * returns a complete, defaulted object — callers never need to null-check individual
 * preference keys.
 */
export type WorkspaceTheme = 'light' | 'dark' | 'system';

export interface WorkspacePreferences {
  /** Which `/settings/*` or `/account/*` page a user lands on right after login. */
  defaultLandingPage: 'organisation' | 'users';
  compactNavigation: boolean;
  animationsEnabled: boolean;
  emailNotifications: boolean;
  systemNotifications: boolean;
  marketingEmails: boolean;
  /** Disabled by default per the brief — no AI features exist yet to gate. */
  aiFeatures: boolean;
  /** Disabled by default per the brief. */
  experimentalFeatures: boolean;
}

export interface WorkspaceSettings {
  theme: WorkspaceTheme;
  preferences: WorkspacePreferences;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  theme: 'system',
  preferences: {
    defaultLandingPage: 'organisation',
    compactNavigation: false,
    animationsEnabled: true,
    emailNotifications: true,
    systemNotifications: true,
    marketingEmails: false,
    aiFeatures: false,
    experimentalFeatures: false,
  },
};

export function mergeWorkspaceSettings(stored: unknown): WorkspaceSettings {
  const storedObj = (
    stored && typeof stored === 'object' ? stored : {}
  ) as Partial<WorkspaceSettings>;

  return {
    theme: storedObj.theme ?? DEFAULT_WORKSPACE_SETTINGS.theme,
    preferences: {
      ...DEFAULT_WORKSPACE_SETTINGS.preferences,
      ...(storedObj.preferences ?? {}),
    },
  };
}

type LogoVariant = 'light' | 'dark';

/**
 * `logoKey`/`darkLogoKey` — the opaque {@link FileStorage} key for each uploaded logo —
 * are stashed inside this same JSON column rather than getting their own Prisma columns.
 * They're internal bookkeeping (needed only so a replaced/removed logo's old file can be
 * deleted), never part of the public `WorkspaceSettings` shape returned by the API, so
 * they're read/written directly rather than through {@link mergeWorkspaceSettings}.
 */
export function getLogoStorageKey(stored: unknown, variant: LogoVariant): string | undefined {
  const obj = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const field = variant === 'dark' ? 'darkLogoKey' : 'logoKey';
  const value = obj[field];
  return typeof value === 'string' ? value : undefined;
}

export function withLogoStorageKey(
  stored: unknown,
  variant: LogoVariant,
  key: string | undefined,
): Record<string, unknown> {
  const obj = {
    ...((stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>),
  };
  const field = variant === 'dark' ? 'darkLogoKey' : 'logoKey';
  if (key === undefined) {
    delete obj[field];
  } else {
    obj[field] = key;
  }
  return obj;
}
