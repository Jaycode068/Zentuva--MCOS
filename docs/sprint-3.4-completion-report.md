# Sprint 3.4 Completion Report — Workspace Configuration & Organisation Branding

**Date:** 2026-08-01
**Status:** Complete

## 1. Objective

Transform Organisation Settings from a single page into a complete Workspace
Configuration Center — General, Branding, Regional, Business, Preferences, and a Security
placeholder — so every tenant can customise how Zentuva looks and behaves for their
organisation and feel like they own their own operating system, not a shared generic
application. Explicit constraints from the brief: reuse everything from Sprint 2.1
(Organisation Profile), Sprint 2.2 (User Management), and Sprint 3.2 (Registration &
Login); extend rather than redesign; don't duplicate code; keep the schema simple,
storing numerous low-stakes settings as structured JSON rather than new columns; design
the file-storage layer so cloud storage can replace local disk later without touching
business logic.

## 2. Implementation Summary

### Backend — one new controller, reusing the existing Organisation service

`apps/api/src/identity/settings/` (`SettingsController` + `SettingsModule`) adds
`GET`/`PATCH /api/settings/workspace` and `POST`/`DELETE /api/settings/logo`. It injects
`OrganisationService` and `AuditService` — the same two services `OrganisationController`
(Sprint 2.1) already used — and adds no new repository. `OrganisationController` itself
was not touched: `/api/organisation/me` still works exactly as it did, per the brief's "do
not redesign or replace existing functionality." `/api/settings/workspace` is a superset
of the same Organisation row, extended with Branding/Regional/Business/Preferences
fields.

`OrganisationService` gained three methods, all built on the existing
`OrganisationRepository.updateProfile` (already generic — it accepts any
`Prisma.OrganisationUpdateInput`, so no repository change was needed for the plain-column
fields):

- **`updateWorkspaceSettings`** — plain fields (Regional/Business/Branding colours) pass
  straight through to `updateProfile`. `theme`/`preferences`, when present, are merged
  into the existing `settings` JSON column (read-modify-write) rather than overwritten,
  so a single-toggle Preferences save never clobbers the other toggles.
- **`setLogo`** / **`removeLogo`** — upload/delete via the new `FileStorage` port,
  storing the returned URL on `logoUrl`/`darkLogoUrl` and the storage key inside
  `settings` (see "Branding architecture" below) so a replaced or removed logo's old file
  gets cleaned up.

### Schema — nine new columns, settings JSON for the rest

Migration `20260801000000_add_workspace_branding_fields` adds `darkLogoUrl`,
`primaryColor`, `accentColor`, `timeFormat`, `numberFormat`, `registrationNumber`,
`taxId`, and `employeeCount` as plain nullable `String` columns — the same convention
Sprint 1B.1/2.1 established for every other Organisation profile field. `businessType`
(an existing, previously-unused column) is now used for "Manufacturing Sector" rather
than adding a duplicate field.

Brand Theme and every Workspace Preferences toggle (compact navigation, animations,
three notification channels, AI features, experimental features) deliberately do **not**
get their own columns — they live inside the pre-existing `settings Json` column, per the
brief's explicit "if settings become numerous, store as JSON" guidance.
`apps/api/src/identity/organisation/workspace-settings.ts` defines
`DEFAULT_WORKSPACE_SETTINGS` and `mergeWorkspaceSettings`, which deep-merges whatever is
actually stored (`{}` for every organisation created before this sprint) over the
defaults on every read, so the API never returns a partially-undefined settings object.

### Branding architecture

**Colours.** `primaryColor`/`accentColor` are stored as hex strings (what a native
`<input type="color">` produces) and converted client-side to the app's existing HSL
custom-property format via `apps/web/src/lib/branding.ts`'s `hexToHslTriplet`, then
applied as inline style overrides on `<html>` (`--primary`/`--ring`/`--accent-pink` and
their `-foreground` pairs, with a simple lightness-threshold contrast pick for the
foreground). **No component was changed** to make this work — every component already
reads these tokens via `packages/config/tailwind/preset.js`'s Tailwind colour extension,
so overriding the CSS variables at the root is sufficient. `--brand-purple` is
deliberately never touched: per the brief's UI Requirements ("Deep Purple — Platform
identity"), that colour stays Zentuva's own brand mark across every tenant — only the
interactive layer (primary/accent) is customisable.

**Theme.** `light`/`dark`/`system` toggles the existing `.dark` Tailwind class
(`darkMode: ['class']` was already configured, just never driven by anything until now).
`system` additionally registers a `prefers-color-scheme` media-query listener so the
theme follows the OS setting live.

**Application point.** Both are applied from `AuthenticatedNav` (via a new
`useApplyBranding` hook), which already renders on every `/settings/*` and `/account/*`
page — no new provider or layout wrapper was needed. `AuthenticatedNav` fetches
`GET /api/settings/workspace` (a second query alongside its existing `GET /api/account/
profile`) and applies branding as a side effect. Because every tab on the Workspace
Settings page shares the same `['settings', 'workspace']` react-query cache key
`AuthenticatedNav` uses, saving a colour or theme change on any tab updates the nav
(and therefore the whole app's branding) immediately — verified live in the browser with
no page reload.

**Logo storage.** `apps/api/src/identity/organisation/ports/file-storage.port.ts`
(`FileStorage`) mirrors the `PasswordHasher`/`TokenService`/`SessionStore` port pattern
from Sprint 1B.2. `LocalFileStorage` writes to `<UPLOAD_DIR>/logos/<organisationId>/
<uuid>.<ext>` and returns an absolute URL built from a new `API_PUBLIC_URL` env var
(default `http://localhost:4000`) plus a static route mounted in `main.ts`
(`useStaticAssets(..., { prefix: '/api/uploads/' })`). The opaque storage `key` needed to
delete an old file on replacement is stashed inside the `settings` JSON column
(`logoKey`/`darkLogoKey` — internal bookkeeping, never exposed in the API response) rather
than getting its own column. **Future cloud storage migration:** implementing `FileStorage`
against S3 (or similar) and swapping the provider binding in `SettingsModule` is the only
change needed — `OrganisationService`/`SettingsController` would not change at all.

### Frontend — a multi-tab Workspace Configuration Center

`apps/web/src/app/settings/organisation/page.tsx` replaces its Sprint 2.1 single-page
form with a shell that fetches `GET /api/settings/workspace` once and renders one of six
client-side tabs (no new routes — "smooth tab switching" per the brief), each in its own
file under `tabs/`:

- **General** — Organisation Name (read-only per the brief — still editable via the
  untouched `PATCH /api/organisation/me` if a future sprint needs that), Display Name,
  Description, Email, Phone, Website. Nearly identical to the Sprint 2.1 page it replaces.
- **Branding** — Company Logo and optional Dark Logo (upload/replace/remove, initials
  avatar fallback via a new `orgInitialsFor` helper shared with `AuthenticatedNav`),
  Favicon and Email Header Logo (disabled placeholders per the brief — "do not
  implement"), Workspace Name (the same `displayName` column as General's Display Name,
  shown here too since it's semantically part of branding — not a duplicate field),
  Primary/Accent colour pickers, and the Light/Dark/System theme selector.
- **Regional** — Country/State/City/Timezone, Currency, Date/Time/Number Format
  (dropdowns over a small fixed set of options), Language (a disabled "English" selector —
  no column, per the brief's "English only for MVP"), Fiscal Year Start.
- **Business** — Industry, Manufacturing Sector, Number of Employees, Business
  Registration Number, Tax Identification Number. All optional per the brief.
- **Preferences** — Default Landing Page plus seven toggles (Compact Navigation,
  Animations, three notification channels, AI Features, Experimental Features — the last
  two default off). Each toggle saves immediately on change rather than requiring a
  separate Save click, matching the brief's "avoid long scrolling pages" guidance for a
  page that's otherwise just a list of switches.
- **Security** — five "Coming Soon" cards (Password Policy, Sessions, MFA, SSO, API
  Keys), per the brief's explicit "do not implement." Links to the real, already-shipped
  `/account/security` (Sprint 3.3) for a user's own password/session management, rather
  than duplicating it.

Every tab reads from and writes to the same shared query key, saves independently (its
own `PATCH` payload, its own mutation state), and a small shared `Field`/`ReadOnlyField`
component (`apps/web/src/components/app/settings-field.tsx`) avoids repeating the same
~15-line form-field wrapper six times.

Responsive layout: a vertical sidebar on desktop (`lg:` breakpoint) collapses to a
horizontal scrollable tab bar on mobile/tablet — verified at 375px with no overflow.

## 3. Testing / Verification Performed

- Full monorepo quality gate from a clean state (`dist`/`.next`/`.turbo` wiped and
  rebuilt): `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build` all green across all
  7 workspace packages. 106/106 backend unit tests pass (89 pre-existing + 17 new:
  `updateWorkspaceSettings` merge behaviour, `setLogo`/`removeLogo` key-tracking and
  cleanup, and a full `settings.controller.spec.ts` covering mapping, validation, and
  authorization).
- Manual verification directly against the live API (`curl`) before the frontend
  consumed these endpoints: `GET`/`PATCH /settings/workspace` (confirmed defaults merge
  correctly for an organisation with no settings stored yet, confirmed a partial
  preferences update doesn't clobber untouched preferences), multipart logo upload
  (confirmed the file is actually servable at the returned URL), logo replacement
  (confirmed the old file is deleted from disk), logo deletion, invalid-mime-type
  rejection, oversized-file rejection, and the Member-role write restriction (`GET`
  succeeds, `PATCH`/upload/delete all correctly `403`).
- Live end-to-end browser verification:
  1. Logged in as an Owner, opened the new tabbed `/settings/organisation` — all six
     tabs present, General tab shows Organisation Name as read-only.
  2. Branding tab: uploaded/replaced logos (verified via the API test above; the upload
     control itself was verified by code review, type-check, and visual inspection —
     simulating a native file-picker dialog through the browser automation tool wasn't
     attempted), changed Primary Brand Colour and Theme, saved — **the entire page's
     colours and light/dark mode updated instantly, with no reload**, including the top
     navigation's organisation-initials avatar and the Save button itself picking up the
     new colour.
  3. Confirmed the distinction holds: the tenant's new primary colour appears throughout
     the app, while the account-menu avatar (Zentuva's own `--brand-purple`) stays purple
     regardless of tenant branding.
  4. Regional, Business, Preferences, Security tabs all render correctly; toggling a
     Preferences switch fires an immediate `PATCH` (confirmed via network inspection).
  5. Verified at mobile viewport (375px): horizontal scrollable tab bar, single-column
     forms, branding colours carried over correctly, no horizontal overflow.
  6. Regression check: `/settings/users` (Sprint 2.2) still lists all users correctly,
     now rendering with the tenant's branding applied — no functional change, confirming
     the branding CSS-variable approach doesn't interfere with pages it wasn't built for.

## 4. Known Limitations

- **No true "reset to platform default" for colours.** The colour pickers default to
  Zentuva's own pink shades when nothing is stored, but saving always persists a concrete
  hex value — there's no explicit "clear this override" action. A cosmetic gap, not a
  data-integrity one.
- **Favicon and Email Header Logo are placeholders only**, per the brief.
- **No server-side image-dimension validation.** Type and size are validated on both the
  client and server; pixel dimensions are checked client-side only (no image-parsing
  dependency was added this sprint to keep the API's dependency footprint unchanged).
- **"Business Description" isn't a separate field from General's "Description".** Both
  are the same `Organisation.description` column — rendering it editable in two tabs
  risked two unsaved, conflicting drafts of the same value, so it lives in General only,
  documented here rather than silently dropped.
- **Security tab is entirely a placeholder**, per the brief's explicit "do not
  implement" — the five cards have no backend behind them.
- **RBAC is still name-based** (`RolesGuard`, Sprint 2.1) — every write in this sprint
  reuses the exact same Owner/Administrator check `OrganisationController` already used;
  no change to the authorization model itself.

## 5. Deferred / Future Work

A real S3-backed `FileStorage` adapter (the port is ready for it — see "Branding
architecture" above), Favicon/Email Header Logo upload, server-side image-dimension
validation, an explicit colour "reset to default," the Security tab's five real features,
and the full RBAC/Permission evaluation engine remain candidates for future sprints but
were out of scope here.
