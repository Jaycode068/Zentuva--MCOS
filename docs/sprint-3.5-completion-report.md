# Sprint 3.5 Completion Report — Workspace Dashboard & Global Navigation

**Date:** 2026-08-01
**Status:** Complete

## 1. Objective

Introduce a permanent, scalable application shell — Sidebar + Top Navigation + a
navigation-oriented `/workspace` dashboard — that becomes the foundation every future
authenticated experience renders through, per the brief: "not new business functionality,
but the structural foundation for a Manufacturing Operating System." Explicit constraints:
MVP-first (no analytics/charts/KPIs), reuse the Sprint 3.4 Zentuva design system without
redesigning it, move existing pages into the new shell with **no business logic changes**,
and make future modules visible-but-disabled rather than hidden. A second, smaller
instruction bundled into the same request: make `/account/profile`'s Profile Photo upload
real, built the same way as Sprint 3.4's organisation logo upload.

## 2. Implementation Summary

### Fix: real profile-photo upload (`/account/profile`)

The Sprint 3.3 "Profile Photo (placeholder only)" disabled card is now a working upload,
built by extending the exact pattern Sprint 3.4 established for organisation logos rather
than inventing a second one:

- **Backend.** `User.avatarUrl`/`avatarKey` (migration
  `20260801010000_add_user_avatar_fields`) — plain nullable columns, mirroring
  `Organisation.logoUrl`. `avatarKey` is its own column rather than stashed inside a JSON
  `settings` blob the way Organisation's `logoKey` is, since `User` has no such bucket —
  a deliberate, documented deviation from the Organisation pattern.
  `UserService.setAvatar`/`removeAvatar` inject the same `FILE_STORAGE` port
  `OrganisationService` already uses (no module wiring changes — `IdentityModule` already
  imports `FileStorageModule`) and follow the identical upload → store URL/key → delete
  old file (best-effort, `.catch(() => undefined)`) sequence as `setLogo`/`removeLogo`.
  `POST`/`DELETE /api/account/avatar` (`AccountController`) reuse `FileInterceptor('file')`
  and a new shared `assertValidImageFile` validator
  (`apps/api/src/identity/common/image-upload-validation.ts`), extracted from what was
  previously `SettingsController`'s private logo-only validator so both endpoints validate
  identically instead of drifting.
- **Frontend.** A new shared `ImageUploadCard` component
  (`apps/web/src/components/app/image-upload-card.tsx`, `shape: 'square' | 'circle'`)
  replaces what would otherwise be two near-identical ~100-line upload/preview/replace/
  remove implementations — the Branding tab's `LogoCard` was refactored to use it too,
  shrinking from ~120 lines to a thin mutation wrapper. Client-side validation
  (`apps/web/src/lib/logo-validation.ts`) was renamed to
  `apps/web/src/lib/image-upload-validation.ts` and its exports generalised
  (`validateImageFile`) since it's no longer logo-specific.
- **Tests.** Backend: 3 new `UserService` tests (`setAvatar` uploads/stores, deletes
  previous file on replace, 404s on a missing user) and 2 (`removeAvatar` clears + deletes,
  no-op when nothing to delete); `AccountController` gained 4 tests covering missing file,
  invalid mime type, successful upload + audit record, and delete + audit record. Full
  suite: 115/115 passing (up from 106/106 before this fix).
- **Verification.** Uploaded/replaced/removed a real PNG against the live API (`curl`,
  confirming the returned `avatarUrl` is servable) and through the browser UI — preview
  render, Replace/Remove buttons appearing after upload, and Remove correctly reverting to
  the initials fallback — with no console errors.

### The Workspace shell

`apps/web/src/components/workspace/` is the new permanent authenticated application
shell:

- **`WorkspaceLayout`** — composes `Sidebar` + `Topbar` + a `<main>` content area, and owns
  the one piece of shared UI state (`mobileNavOpen`) both children need.
- **`Sidebar`** — renders the same nav content twice from one source
  (`navigation-config.ts`): a fixed `lg:` column on desktop, and a slide-over drawer
  (overlay + `-translate-x-full`/`translate-x-0` panel) on mobile/tablet, closed by the
  overlay, the mobile hamburger's own toggle, or navigating to a new page.
- **`Topbar`** — the direct successor to `AuthenticatedNav` (Sprint 3.2/3.3/3.4), moved
  here rather than duplicated: it still fetches `GET /api/account/profile` and
  `GET /api/settings/workspace`, still applies tenant branding via `useApplyBranding`
  (Sprint 3.4) as a side effect on every authenticated page, and still redirects to
  `/change-password` when `mustChangePassword` is set. New in this sprint: a hamburger
  button (mobile only) that opens the `Sidebar` drawer, and the account-menu trigger now
  renders the user's uploaded avatar (this sprint's other fix) instead of always falling
  back to initials.
- **`NavigationGroup`/`NavigationItem`** — one sidebar row each; a `comingSoon` item
  renders as a non-interactive `<span>` with a "Coming Soon" badge (not an `<a>`), so it's
  genuinely unclickable and generates no navigation or error, per the brief.
- **`WorkspaceHeader`/`QuickActionCard`/`ModuleCard`** — presentational pieces used only by
  the `/workspace` dashboard page (below).
- **`navigation-config.ts`** — the single source of truth for the sidebar's three sections
  (Workspace: Dashboard + 8 future domain modules; Administration: Organisation, Users, My
  Profile, Workspace Settings (future), Security; Support: Help, Release Notes — all per
  the brief's exact list) and, by extension, the `/workspace` dashboard's Platform Modules
  grid, which maps over the same array rather than maintaining a second list. Adding a
  future module later means adding one entry here — no component changes.
- **`icons.tsx`** — a small hand-rolled 24×24 stroke-icon set (~20 icons). No icon-library
  dependency was added: this repo already hand-rolls its first-party visual components
  (`Dialog`/`DropdownMenu`, the marketing `Logo`) rather than pulling in a new package for
  a handful of uses, and this follows the same call.

### `/workspace` — the Workspace Dashboard

`apps/web/src/app/(app)/workspace/page.tsx`, deliberately **not metric-heavy** per the
brief:

- **Welcome header** (`WorkspaceHeader`) — "Welcome back, {Organisation Name}" + logo (or
  initials fallback) + organisation code + the tenant's configured theme, reading the same
  `GET /api/settings/workspace` query the rest of the app already uses.
- **Quick Actions** — 4 fixed cards (Manage Organisation, Manage Users, Product Catalogue,
  View Profile) that just navigate; no new business logic.
- **Platform Modules** — a grid built from `navigation-config.ts`'s Workspace section
  (minus Dashboard itself, which would be a redundant self-link tile on its own dashboard),
  each card accented purple/pink/orange/teal in rotation via `ModuleCard`'s `accent` prop —
  an explicit Tailwind class lookup table (`ACCENT_CLASSES`), not string interpolation,
  since Tailwind's JIT compiler needs every class name literally present in source.
- **Recent Activity** and **Platform Status** — static placeholder cards with the brief's
  exact copy ("Recent activity will appear here.", "Identity ✓ Complete / Workspace ✓
  Complete / Product Catalogue Coming Next"). No backend, no new API — same placeholder
  pattern as Sprint 3.4's Security tab.

### Route restructuring — one shared layout, zero URL changes

`settings/organisation`, `settings/users`, `account/profile`, `account/security`, and
`account/sessions` moved (`git mv`, history preserved) under a new `app/(app)/` **route
group**. Next.js route groups (`(name)`) add no URL segment — every one of these pages
keeps its exact existing path — but every route physically inside the group now shares one
`app/(app)/layout.tsx` (`<WorkspaceLayout>{children}</WorkspaceLayout>`) instead of each
route's own `layout.tsx` independently importing `AuthenticatedNav`. The two old
per-section layouts (`settings/layout.tsx`, `account/layout.tsx`) and `AuthenticatedNav`
itself are deleted — nothing else imported it. `change-password` deliberately stayed
**outside** the group: it never rendered `AuthenticatedNav` (a forced pre-workspace gate
should not have full navigation available), and that's unchanged.

Login (`apps/web/src/app/login/page.tsx`) now redirects to `/workspace` instead of
`/settings/organisation` on success; the `mustChangePassword` → `/change-password` branch
is untouched. `/change-password`'s own post-success redirect was also updated to
`/workspace` for consistency — a user granted "continue normally" after a forced password
change should land on the same permanent home a normal login does.

### Branding — orange and teal, added without touching what exists

`--brand-orange`/`--brand-teal` (plus dark-mode variants) were added to
`packages/ui/src/styles.css` and exposed as `brandOrange`/`brandTeal` Tailwind tokens in
`packages/config/tailwind/preset.js`, following the exact pattern `--brand-purple`
established in Sprint 3.1/3.2: a decorative, non-tenant-customisable brand accent, distinct
from `--primary`/`--accent-pink` (tenant-customisable) and from `--brand-purple` itself
(Zentuva's platform identity mark, never overridden by tenant branding). Nothing else was
changed — `Topbar` still applies only `--primary`/`--ring`/`--accent-pink` per tenant, so
these two new tokens exist purely for the Platform Modules grid's four-colour rotation.

## 3. Testing / Verification Performed

- Full monorepo quality gate from a clean state (`.next`/`dist`/`.turbo` wiped and
  rebuilt): `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build` all green across all
  7 workspace packages. 115/115 backend unit tests pass. The production build's route
  table confirms every moved page kept its exact URL
  (`/account/profile`, `/settings/organisation`, `/settings/users`, etc. all present
  alongside the new `/workspace`) with no `/(app)/` segment leaking into any path.
- Live end-to-end browser verification against the running dev servers:
  1. Logged in with a fresh session; confirmed the login `POST` succeeds and the client
     navigates to `/workspace` (confirmed via `location.href`, since the automation tool's
     click-coordinate mapping was unreliable for this particular form in this session —
     the underlying `router.push` behaviour itself was verified directly).
  2. `/workspace` renders the welcome header, all 4 Quick Action cards, all 8 Platform
     Module cards with the purple/pink/orange/teal rotation and correct Coming Soon
     badges, and both static Recent Activity/Platform Status cards with the brief's exact
     copy.
  3. Desktop (1280×800): fixed left sidebar, "Users"/"My Profile" correctly highlighted as
     active when visiting `/settings/users` and `/account/profile`, organisation logo/name
     and account avatar visible in the top bar.
  4. Mobile width (~375–528px): sidebar collapses to a hamburger; opening it renders the
     slide-over drawer with a dimmed overlay over the page content; clicking a nav item
     both navigates and closes the drawer.
  5. Regression check: `/settings/organisation` (all six Sprint 3.4 tabs), `/settings/users`,
     and `/account/profile` (including the new avatar upload) all render and function
     identically to before, now inside the new shell — confirming "no business logic
     changes" held.
  6. No console errors observed across any of the above.
- One environment issue encountered and resolved during verification, unrelated to
  application code: two previous sessions' dev-server processes were still holding ports
  3000/4000 with stale pre-Sprint-3.5 builds (`Cannot find module .next/server/pages/
_document.js`, and a stale `dist/main` missing the new `/account/avatar` routes). Both
  were stopped and restarted cleanly via the project's `pnpm dev` scripts before
  verification could proceed.

## 4. Known Limitations

- Platform Modules grid descriptions are static copy hand-written for this sprint, not
  sourced from `docs/backlog.md`'s Epic descriptions programmatically.
- `defaultLandingPage` (a Sprint 3.4 Preferences toggle, `'organisation' | 'users'`) is
  still not consumed anywhere — login always redirects to a fixed `/workspace`/
  `/change-password` regardless of its stored value. Pre-existing, unchanged by this
  sprint.
- "Workspace Settings" (Administration section) has no route yet — it's listed per the
  brief as "(future)" and renders Coming Soon, same as every unbuilt domain module.
- The hand-rolled icon set is deliberately minimal (no size/weight variants); if a future
  sprint needs a much larger icon surface, revisit whether a library (e.g. lucide-react)
  is worth the dependency at that point.

## 5. Deferred / Future Work

Product Catalogue (Epic 3) is the next module to move from "Coming Soon" to real, per
`docs/roadmap.md` Phase 2. When it ships, `navigation-config.ts`'s `/products` entry loses
`comingSoon: true` and the Platform Modules grid picks it up automatically — no shell
changes needed. The same applies to every other module in the Workspace section.
