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

/**
 * Sprint 28 §Workstream H.1 "Organisation Configuration" — the ONLY organisation-
 * level knob email delivery has this sprint. Deliberately separate from, and
 * unrelated to, `WorkspacePreferences.emailNotifications` above: that flag
 * predates the whole Notifications domain (Sprint 3.4), is a generic UI toggle
 * with NO backend enforcement anywhere in this codebase (verified by inspection
 * before this sprint — nothing reads it), and repurposing a long-dormant,
 * ambiguously-named flag for a new, different meaning risked silently changing
 * behaviour for any organisation that had already touched it. `emailDelivery` is
 * new, narrowly scoped, and the only thing that actually gates
 * `EmailEligibilityService` (docs/domains/notifications.md §11).
 */
export interface WorkspaceEmailDeliverySettings {
  /** "Email is disabled unless explicitly enabled" (Sprint 28 §5.2) — the
   *  organisation-level half of that gate; `NotificationPreference.emailEnabled`
   *  (per-user, per-category) is the other half. BOTH must be true for a
   *  delivery to be created. */
  enabled: boolean;
  senderName: string | null;
  senderEmail: string | null;
}

export interface WorkspaceSettings {
  theme: WorkspaceTheme;
  preferences: WorkspacePreferences;
  emailDelivery: WorkspaceEmailDeliverySettings;
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
  emailDelivery: {
    enabled: false,
    senderName: null,
    senderEmail: null,
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
    emailDelivery: {
      ...DEFAULT_WORKSPACE_SETTINGS.emailDelivery,
      ...(storedObj.emailDelivery ?? {}),
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
