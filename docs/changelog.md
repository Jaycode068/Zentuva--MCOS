# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

_Nothing yet._

## [Sprint 3.5.1 Workspace Navigation Refinement] - 2026-08-02

### Added

- Three future modules now appear as disabled "Coming Soon" entries in the Workspace
  sidebar and the `/workspace` dashboard's Platform Modules grid, so the navigation
  communicates the full long-term Manufacturing Operating System roadmap rather than
  only the modules already scheduled: **Suppliers** (`/suppliers`), **Asset Register**
  (`/assets`), and **Maintenance** (`/maintenance`). All three use the existing
  `comingSoon` mechanism from `navigation-config.ts` (Sprint 3.5) — non-clickable,
  visually identical to Procurement/Inventory/Production/Sales/Distribution/Finance/
  Reports, no routes or pages created.

### Notes

- Navigation-only change: no backend, database, API, or authentication changes. No new
  domain documentation, since these modules haven't been designed yet.

## [Sprint 4.1 Product Catalogue Foundation] - 2026-08-01

### Added

- **Product Catalogue domain** (`apps/api/src/catalogue/product/`) — the first
  non-Identity business domain module, following the same repository/service/controller
  architecture established for Identity: `ProductRepository`, `ProductService`,
  `ProductController`, `ProductModule`. Product is the master source of truth every
  future manufacturing module (Inventory, Production, Sales, ...) is expected to
  reference by id — see `docs/domains/catalogue.md`.
- **`Product` Prisma model** (migration `20260801184041_add_product_catalogue`):
  identity fields (auto-generated immutable `code`, `name`, `displayName`, `slug`),
  classification (`ProductCategory` enum — Snacks/Beverage/Water/Confectionery/Raw
  Materials/Packaging/Others; `ProductType` enum — Finished Product/Raw Material/
  Packaging Material), free-text `unit`, one image (`imageUrl`/`imageKey`, same
  `FileStorage` pattern as `Organisation.logoUrl`/`User.avatarUrl`), `ProductStatus`
  (Draft/Active/Archived — never physically deleted), and `createdById`/`updatedById`
  metadata (plain columns, no FK relation, same convention as `AuditLog.actorUserId`).
- **Product Code generation** — `PRD-000001`, `PRD-000002`, ... (`ProductService.
generateUniqueCode`), a global sequential collision-avoidance loop mirroring
  `OrganisationService.generateUniqueOrganisationCode` (Sprint 3.2). Immutable and never
  accepted on create/update input.
- **API** — `GET`/`POST /api/products`, `GET`/`PATCH /api/products/:id`,
  `POST /api/products/:id/activate`, `POST /api/products/:id/archive`,
  `POST`/`DELETE /api/products/:id/image`. `GET` requires only authentication (Member has
  read-only access); every write requires Owner or Administrator (`RolesGuard`, same
  mechanism as every other domain since Sprint 2.1). Status transitions are validated —
  activating an already-active product (or archiving an already-archived one) is a `400`,
  not a silent no-op.
- **`packages/validation/src/catalogue.ts`** — `createProductSchema`,
  `updateProductSchema`, and the `ProductCategory`/`ProductType`/`ProductStatus` enum
  schemas, mirroring `identity.ts`'s plain-string-literal convention (no `@prisma/client`
  import, since `apps/web` also depends on this package).
- **Frontend `/settings/products`** (under the Sprint 3.5 Workspace shell): a product
  table (image, code, name, category, type, status badge, updated date, actions), simple
  client-side search by name/code (no pagination, per the brief), and a proper empty-state
  for a catalogue with no products yet. A reusable `ProductDialog` handles both Create and
  Edit (the image upload control only appears in Edit mode, since uploading requires an
  existing product id); `ProductViewDialog` is a read-only details modal. Product image
  upload/preview/replace/remove reuses the Sprint 3.4 `ImageUploadCard` component.
- **Workspace navigation** — "Products" in the sidebar and the `/workspace` dashboard's
  Quick Actions/Platform Modules now point at `/settings/products` and lost their "Coming
  Soon" state; every other module continues showing "Coming Soon."
- **Seed data** — 5 example Boby Bites products (Plantain Chips, Potato Chips, Roasted
  Groundnut, Kulikuli, Chin Chin), all `SNACKS`/`FINISHED_PRODUCT`/`ACTIVE`, no images.
- Every mutating endpoint is audited: `product.created`, `product.updated`,
  `product.activated`, `product.archived`, `product.image.uploaded`,
  `product.image.removed`.
- 24 new backend unit tests (`ProductService`/`ProductController`) — 139/139 total.

### Known limitations

- No variants, batch numbers, expiry dates, barcode/QR generation, taxes, multi-image
  galleries, bulk import/export, pricing, or inventory/procurement/sales integration —
  all explicitly out of scope per the brief, reserved for their own future sprints.
- Category and Product Type are fixed enums, not a tenant-configurable taxonomy.
- The Create Product dialog cannot attach an image in the same request — a product must
  be created first (its id is needed by the upload endpoint), then edited to add an
  image.

## [Sprint 3.5 Workspace Dashboard & Global Navigation] - 2026-08-01

### Added

- **Permanent Workspace shell** — `apps/web/src/components/workspace/` (`WorkspaceLayout`,
  `Sidebar`, `Topbar`, `NavigationGroup`, `NavigationItem`, `WorkspaceHeader`,
  `QuickActionCard`, `ModuleCard`) replaces the ad-hoc `AuthenticatedNav` every
  `/settings/*`/`/account/*` route previously imported on its own. Desktop renders a fixed
  left sidebar + top bar; mobile/tablet collapse the sidebar into a slide-over drawer
  opened from a hamburger button. Wired in once via `apps/web/src/app/(app)/layout.tsx` (a
  Next.js route group — adds no URL segment), so every authenticated route shares one
  layout instance instead of duplicating navigation per route.
- **`/workspace` — the new permanent landing page after login**
  (`apps/web/src/app/(app)/workspace/page.tsx`): a welcome header (organisation logo/name +
  workspace theme), a Quick Actions grid (Manage Organisation, Manage Users, Product
  Catalogue, View Profile), a Platform Modules grid covering every domain from
  `docs/roadmap.md` Phase 2/3 (active modules link out, unbuilt ones render disabled with a
  "Coming Soon" badge), and two static placeholder cards (Recent Activity, Platform
  Status) — deliberately not metric-heavy or backed by any new API, per the brief's
  explicit "Out of Scope: analytics, charts, KPIs, notifications, activity feeds."
- `apps/web/src/components/workspace/navigation-config.ts` — single source of truth for
  the sidebar's three sections (Workspace/Administration/Support) and the sidebar/Platform
  Modules grid it drives. Adding a future module means adding one entry here.
- `apps/web/src/components/workspace/icons.tsx` — a small hand-rolled stroke-icon set (no
  icon-library dependency added), same rationale as the existing hand-rolled `Dialog`/
  `DropdownMenu`/marketing `Logo`.
- **Orange and teal brand tokens** (`--brand-orange`, `--brand-teal` in
  `packages/ui/src/styles.css`, `brandOrange`/`brandTeal` in
  `packages/config/tailwind/preset.js`) — decorative accents (not tenant-customisable like
  `--primary`/`--accent-pink`, not the platform identity mark like `--brand-purple`) used
  to rotate purple/pink/orange/teal across the Platform Modules grid, per the brief's
  "navigation should reflect these brand colours, not just purple."

### Changed

- **Login now redirects to `/workspace`** instead of `/settings/organisation`
  (`apps/web/src/app/login/page.tsx`); the forced first-login `mustChangePassword` →
  `/change-password` branch is unchanged, and `/change-password`'s own post-success
  redirect now also lands on `/workspace` (`apps/web/src/app/change-password/page.tsx`).
- **Route restructuring, no URL changes**: `settings/organisation`, `settings/users`,
  `account/profile`, `account/security`, `account/sessions` moved under a new
  `app/(app)/` route group so they share `WorkspaceLayout`. Because route groups add no
  URL segment, every existing link/bookmark to these pages keeps working unchanged —
  confirmed in the production build's route table and via live browser navigation.
  `apps/web/src/app/settings/layout.tsx` and `apps/web/src/app/account/layout.tsx` (each
  independently rendering `AuthenticatedNav`) are deleted, replaced by the one
  `app/(app)/layout.tsx`.
- `AuthenticatedNav` is retired; its logic (account/workspace queries, branding
  application, `mustChangePassword` guard, account dropdown) moved into `Topbar`, which
  also gained a mobile hamburger button and now shows the user's uploaded profile photo in
  the account-menu trigger when one exists (falls back to initials otherwise).

### Fixed

- **`/account/profile`'s "Profile Photo" card is a real upload**, not the Sprint 3.3
  disabled placeholder. Built the same way as Sprint 3.4's organisation logo upload:
  `POST`/`DELETE /api/account/avatar` (`apps/api/src/identity/account/account.controller.ts`)
  reuse the same `FileStorage` port and a new shared `assertValidImageFile` validator
  (`apps/api/src/identity/common/image-upload-validation.ts`, extracted from the
  logo-upload validation `SettingsController` already had). `User.avatarUrl`/`avatarKey`
  are new plain nullable columns (migration `20260801010000_add_user_avatar_fields`) —
  `avatarKey` is its own column rather than stashed in a JSON `settings` blob the way
  Organisation does it, since `User` has no such bucket. Frontend: a new shared
  `ImageUploadCard` component (`apps/web/src/components/app/image-upload-card.tsx`)
  replaces what would otherwise be two near-identical upload/preview/replace/remove
  implementations — the Branding tab's logo cards were refactored to use it too, so both
  features share one implementation instead of two.

### Known limitations

- Platform Modules grid descriptions and the module list itself are static copy — nothing
  reads from `docs/backlog.md`'s Epics programmatically.
- No `defaultLandingPage` preference is consumed anywhere yet (Sprint 3.4 added the
  Preferences toggle; login always redirects to a fixed destination regardless of its
  value) — unchanged by this sprint.
- "Workspace Settings" (Administration section) and every module below Dashboard render
  as "Coming Soon" per the brief — no route exists for them yet.

## [Sprint 3.4 Workspace Configuration & Organisation Branding] - 2026-08-01

### Added

- `apps/web/src/app/settings/organisation/page.tsx` — replaces the single-page
  Organisation Settings (Sprint 2.1) with a multi-tab Workspace Configuration Center:
  General, Branding, Regional, Business, Preferences, and a Security placeholder. A
  sidebar on desktop collapses to a horizontal scrollable tab bar on mobile/tablet. Every
  tab shares one `GET /api/settings/workspace` query and saves independently via its own
  `PATCH`.
- `apps/api/src/identity/settings/` — a new `SettingsController`/`SettingsModule` at
  `/api/settings/*`, built entirely on the existing `OrganisationService`/`AuditService`
  (no new repository):
  - `GET`/`PATCH /api/settings/workspace` — the full workspace profile (General +
    Branding + Regional + Business + Preferences fields) as one partial-update surface,
    same pattern as `PATCH /api/organisation/me` (Sprint 2.1).
  - `POST`/`DELETE /api/settings/logo?variant=light|dark` — multipart logo upload/removal,
    type/size validated server-side, with old files cleaned up on replace.
  - Every write requires Owner or Administrator (`RolesGuard`, reused from Sprint 2.1);
    `GET` is open to any authenticated user.
- **File storage abstraction** — `FileStorage` port
  (`apps/api/src/identity/organisation/ports/file-storage.port.ts`) plus a
  `LocalFileStorage` adapter that writes to local disk and serves files via
  `/api/uploads/*` (mounted in `main.ts`). Mirrors the `PasswordHasher`/`TokenService`/
  `SessionStore` port pattern from Sprint 1B.2 — a future S3-backed adapter implements the
  same interface with no change to `OrganisationService`/`SettingsController`.
- **Nine new `Organisation` columns** (migration
  `20260801000000_add_workspace_branding_fields`): `darkLogoUrl`, `primaryColor`,
  `accentColor`, `timeFormat`, `numberFormat`, `registrationNumber`, `taxId`,
  `employeeCount` — plain typed columns, same convention as the Sprint 1B.1/2.1 profile
  fields. `businessType` (existing, previously unused) is now used for "Manufacturing
  Sector". Workspace theme and every Preferences toggle live inside the existing
  `settings` Json column instead of new columns — see
  `apps/api/src/identity/organisation/workspace-settings.ts`
  (`DEFAULT_WORKSPACE_SETTINGS`, deep-merged with stored settings on every read).
- **Live tenant branding** — `apps/web/src/lib/branding.ts` converts a tenant's chosen
  hex primary/accent colours to the app's existing HSL CSS custom properties
  (`--primary`/`--ring`/`--accent-pink`) and applies them via `useApplyBranding`, called
  from `AuthenticatedNav` (rendered on every authenticated page) alongside the
  light/dark/system theme class toggle. No component was changed to consume tenant
  colours — everything already read `hsl(var(--primary))` via the existing Tailwind
  tokens. Zentuva's own `--brand-purple` is deliberately never overridden — it stays the
  platform's own identity colour across every tenant.
- `AuthenticatedNav` now also renders the organisation's own logo (or a colour-matched
  initials avatar when none is uploaded, `apps/web/src/lib/org-initials.ts`) next to the
  organisation name — alongside, not replacing, the Zentuva product mark.
- Client-side logo validation (`apps/web/src/lib/logo-validation.ts`): type, size (2 MB),
  and — for raster images — pixel dimensions, checked before the upload request for fast
  feedback; type and size are re-validated server-side as the authority.
- Every workspace write is audited: `workspace.settings.updated`,
  `workspace.logo.uploaded`, `workspace.logo.removed`
  (`apps/api/src/identity/organisation/workspace-audit-actions.ts`).
- 17 new backend unit tests (workspace settings merge, logo upload/replace/remove
  key-tracking, `SettingsController` mapping/validation/authorization) — 106/106 total.

### Known limitations

- **"Reset to Zentuva default" isn't a real "unset."** The colour pickers default to
  Zentuva's own pink shades when no override is stored, but saving always writes a
  concrete hex value — there's no way to explicitly clear back to "inherit the platform
  default" once a colour has been customised (a cosmetic gap, not a data-integrity one).
- **Favicon and Email Header Logo are placeholders only**, per the brief — disabled
  upload buttons, no backend support.
- **Security tab is a placeholder only**, per the brief — five "Coming Soon" cards
  (Password Policy, Sessions, MFA, SSO, API Keys). This is workspace-wide security
  _policy_, distinct from the per-user `/account/security` page Sprint 3.3 already
  shipped (linked from this tab, not duplicated).
- **Server-side image-dimension validation doesn't exist** — only client-side (no
  image-parsing dependency was added this sprint). Type and size are validated on both
  sides.
- **"Business Description" isn't a separate field from General's "Description".** The
  brief listed both, but they're the same underlying `Organisation.description` column —
  duplicating an editable field across two tabs risked two conflicting unsaved drafts of
  the same value, so it's rendered in General only.

## [Sprint 3.3 Account Management & Authentication Experience] - 2026-07-31

### Added

- `apps/api/src/identity/account/` — a new `AccountController`/`AccountModule` at
  `/api/account/*`, entirely reusing existing services (`UserService`,
  `OrganisationService`, `AuthService`, `AuditService`) rather than new repositories:
  - `GET /account/profile` / `PATCH /account/profile` — the caller's own name, phone
    number, and (read-only) employee code, email, role, organisation, joined date, plus
    the security fields (`lastLoginAt`, `failedLoginAttempts`, `passwordChangedAt`,
    `mustChangePassword`) reused by the Security page.
  - `POST /account/change-password` — verifies the current password, hashes and stores
    the new one, and revokes every _other_ active session while keeping the calling
    session signed in (`AuthService.changePassword` + a new
    `SessionRepository.revokeAllForUserExcept`).
  - `GET /account/sessions` / `DELETE /account/sessions/:id` — lists the caller's active
    sessions and revokes one by id, with an ownership check
    (`AuthService.revokeSession`) so a session can only be revoked by the user who owns
    it.
- `User.phoneNumber`, `User.mustChangePassword`, `User.passwordChangedAt` — three new
  columns (migration `20260731000000_add_user_account_management_fields`).
  `mustChangePassword` defaults `true` only for accounts created with an admin-chosen
  temporary password (`UserService.createUser`, Sprint 2.2); self-registered Owners and
  invitation-acceptance users default `false`, since both already chose their own
  password. `passwordChangedAt` is stamped by `UserRepository.updatePasswordHash`
  (shared by change-password and reset-password) and starts `null` ("Never changed").
- `strongPasswordSchema` in `@zentuva/validation` (min length + upper/lower/number/
  special character), applied to both the new `changePasswordSchema` and — as a
  consistency fix — the existing `resetPasswordSchema` (Sprint 1B.2), so every "set a new
  password" path enforces the same policy.
- Frontend: `/change-password` (shared by voluntary changes and the forced first-login
  redirect), `/reset-password/[token]` (completes the Sprint 3.2 forgot-password flow —
  `POST /auth/password/reset` existed since Sprint 1B.2 but had no frontend page until
  now), and `/account/profile`, `/account/security`, `/account/sessions` (wrapped in a
  shared `AccountTabs` sub-nav).
- `PasswordStrength` and `PasswordInput` components
  (`apps/web/src/components/auth/`) — a live strength checklist and a show/hide-password
  toggle, shared across `/login`, `/change-password`, and `/reset-password/[token]`.
- `packages/ui/src/components/dropdown-menu.tsx` — hand-rolled (no Radix, same rationale
  as `Dialog` in Sprint 2.2), used by `AuthenticatedNav`'s new user menu (My Profile /
  Security / Active Sessions / Logout), replacing the bare Logout button from Sprint 3.2.
- `AuthenticatedNav` now calls the new `GET /api/account/profile` instead of Sprint 3.2's
  `GET /api/users/:id` + client-side JWT decode — one request now covers the avatar's
  display data _and_ the `mustChangePassword` flag, which the component uses to redirect
  to `/change-password` before rendering anything else on any `/settings/*`/`/account/*`
  page. `UserController`'s `getUser`-for-self hack and `api-client.ts`'s
  `getCurrentUserId` are removed as a result — both are now genuinely dead code.
- Login page improvements: Remember Me checkbox (backed by a new `remember` parameter on
  `setTokens` — `true` uses `localStorage`, `false` uses `sessionStorage`), show/hide
  password, autofocus on the email field, and a "password updated" banner after a
  successful reset (`/login?passwordReset=1`).
- `POST /auth/password/request-reset`'s dev-mode `resetToken` is now surfaced on
  `/login/forgot-password` as a clickable dev-only link — there's still no real email
  service ("mock for now" per the brief), so this is how the reset flow is testable at
  all without one.
- Every new mutation is audited: `account.profile.updated`, `account.password.changed`
  (new — `apps/api/src/identity/account/account-audit-actions.ts`), plus session
  revocation and password-reset events reusing the existing `auth.session.revoked`/
  `auth.password.reset_requested`/`auth.password.reset` actions from Sprint 1B.2.
- 12 new backend unit tests (`account.controller.spec.ts`, plus `changePassword`/
  `revokeSession` cases added to `auth.service.spec.ts`) — 89/89 total.

### Known limitations

- Discovered (not introduced) during this sprint's manual verification: rapidly calling
  `POST /auth/refresh` within the same wall-clock second as the token it's rotating was
  issued can throw a 500 (Prisma unique-constraint collision on `tokenHash`), because
  refresh JWTs are signed deterministically and `iat` only has second granularity. Only
  reachable via back-to-back scripted requests, not normal browser use. Flagged as a
  follow-up task rather than fixed here, per this sprint's "do not redesign already
  implemented authentication" constraint.
- "Profile Photo" is a placeholder only, per the brief — no upload endpoint exists.

## [Sprint 3.2 Tenant Registration & Organisation Onboarding] - 2026-07-31

### Added

- `POST /api/auth/register` (`apps/api/src/identity/auth/auth.controller.ts`) — the first
  self-service entry point into Zentuva. Accepts organisation details plus an Owner
  account and atomically provisions a new tenant: organisation, its default system roles,
  the Owner user, and an audit entry, all inside one Prisma interactive transaction
  (`OrganisationRepository.registerTenant`) so any failure rolls back every write. Rejects
  duplicate organisation names and duplicate emails with `409 Conflict`
  (`OrganisationService.register`).
- `registerOrganisationSchema` (`packages/validation/src/identity.ts`) — full rewrite of
  the unused Sprint 1B.1 draft to match the real wire contract (`organisationName`,
  `country`, owner `firstName`/`lastName`/`email`/`password`/`confirmPassword`,
  `acceptTerms`, plus optional display name, industry, address fields, phone, business
  email, and website).
- Slug and organisation-code generation: slug = kebab-case of the organisation name with a
  numeric collision suffix (`-2`, `-3`, ...); organisation code = first 3 uppercase letters
  of the name (fallback `ZEN`) + zero-padded 4-digit sequence, incrementing on collision
  (e.g. `SAH-0001`).
- `apps/web/src/app/register/` — the two-section registration form (Organisation
  Information, Owner Account) and `/register/success` confirmation page showing the new
  organisation's name, code, and owner email (passed via URL query params from the
  registration response, not client state, so it survives the full-page navigation).
- `apps/web/src/app/login/` and `apps/web/src/app/login/forgot-password/` — sign-in page
  (stores tokens, redirects to `/settings/organisation`) and a password-reset request page
  that reuses the Sprint 1B.2 `POST /auth/password/request-reset` endpoint, previously
  built but never wired to any frontend.
- `apps/web/src/components/app/authenticated-nav.tsx` + `apps/web/src/app/settings/layout.tsx`
  — a top nav (Logo, organisation name, user avatar with initials, Logout) wrapping all
  `/settings/*` pages. The current user's id comes from decoding the access token's `sub`
  claim client-side (`getCurrentUserId`, display-only, never an authorization decision);
  the name/initials come from the existing `GET /api/users/:id` endpoint — no new backend
  surface was added for this.
- `apps/web/src/lib/auth.ts` (`registerOrganisation`, `login`, `logout`,
  `requestPasswordReset`) and `api-client.ts` additions (`setTokens`, `clearTokens`,
  `getCurrentUserId`).
- **Brand rebalance**: `packages/ui/src/styles.css`'s `--primary` now means pink (was
  purple in Sprint 3.1), so every interactive element that reads `primary` — the default
  `Button` variant, focus rings, links — becomes pink automatically. A new `--brand-purple`
  token was introduced for non-interactive brand elements (headings, icons, illustrations,
  section titles) and applied across the Sprint 3.1 marketing components. This corrects
  Sprint 3.1's purple-heavy balance per this sprint's explicit brief.
- `packages/ui/src/components/checkbox.tsx` — native checkbox styled with
  `accent-primary`, used for the registration form's Terms of Service acceptance.
- `apps/api/src/identity/organisation/organisation.service.spec.ts` — 8 tests covering
  `register()`: success, duplicate name, duplicate email, slug/code collision handling.

### Known limitations

- `OrganisationRepository.registerTenant` writes directly against the Prisma transaction
  client rather than through `UserRepository`/`RoleRepository`/`AuditRepository`, because
  none of those repositories currently accept an external `tx` client. This is a deliberate,
  documented exception to "reuse existing repositories" — the alternative (adding `tx`
  parameters to every repository method) was judged out of scope for this sprint. See
  `docs/sprint-3.2-completion-report.md` for the full rationale.
- No dedicated "current user" endpoint exists yet; the authenticated nav's user info comes
  from decoding the JWT for the id and re-fetching via `GET /api/users/:id`. Fine for
  display, but a future sprint should consider a proper `/auth/me` endpoint if more
  session-derived data is needed.
- "Book a Demo" on the landing page remains a static anchor link — no demo-booking flow
  exists, unchanged from Sprint 3.1.

## [Sprint 3.1 Public Marketing Website — Landing Page] - 2026-07-31

### Added

- Public landing page at `/` (`apps/web/src/app/page.tsx`): Navbar, Hero, Trusted By,
  Problem, What is Zentuva, Platform Modules, Why Zentuva, Retail Intelligence, AI,
  Platform Vision Timeline, CTA, and Footer sections — replaces the Sprint 0 placeholder
  page. No authentication, no backend integration, per the brief.
- `apps/web/src/components/marketing/`: 13 new components (`navbar`, `hero`,
  `trusted-by`, `problem-section`, `what-is-zentuva`, `platform-modules`, `why-zentuva`,
  `retail-intelligence`, `ai-section`, `vision-timeline`, `cta-section`, `footer`,
  `logo`, `container`, `icons`) — all reusable, no lorem ipsum, all copy original.
- Repositioned the product: "The Operating System for African Manufacturing," not an ERP
  or SaaS product — reflected in `layout.tsx` metadata and throughout the page copy.
- **Rebrand**: `packages/ui/src/styles.css`'s `--primary` changed from green to a deep
  purple, plus two new brand tokens (`--lavender`, `--accent-pink`) registered in
  `packages/config/tailwind/preset.js`. This is a shared design-system change — it also
  restyles the existing `/settings/organisation` and `/settings/users` pages, which is
  intentional (one consistent brand, not a marketing-only skin).
- `buttonVariants` now exported from `packages/ui` (was previously internal to
  `Button`) — needed to style `<a>` elements as buttons (nav links, CTAs) without adding
  a Radix `Slot`/`asChild` dependency.

### Known limitations

- **No real logo file.** The brief said to use an attached logo; no image file was ever
  placed in the repo (only shared as an inline chat image mid-session). `ZentuvaMark`
  (`apps/web/src/components/marketing/logo.tsx`) is a best-effort geometric recreation of
  the "Z" mark in the same colors, not the literal source asset. See
  `docs/sprint-3.1-completion-report.md` "Known limitations."
- "Get Started," "Book a Demo," "Request Demo," "Join Early Access," and "Sign In" are all
  static links with no form or backend behind them yet — explicitly out of scope (Sprint
  3.2 covers authentication UI).

## [Sprint 2.2 Organisation Management — User Management] - 2026-07-31

### Added

- `apps/api/src/identity/user/user.controller.ts` + `user.module.ts` — the User
  Management HTTP surface: `GET /api/users` (list), `GET /api/users/:id` (view), both any
  authenticated user; `POST /api/users` (create) and `PATCH /api/users/:id` (combined
  profile/role/status update), both Owner/Administrator only via the same `RolesGuard`
  introduced in Sprint 2.1.
- `UserRepository.findManyWithRolesByOrganisation` / `findByIdWithRoles` /
  `createWithRole`, and `RoleRepository.replaceUserRole` — a user's role assignment is
  treated as "exactly one" for this sprint's MVP model (even though `UserRole` technically
  permits many), resolved by system role _name_ rather than `roleId` (no role-listing
  endpoint exists yet).
- `createUserSchema` / `updateUserSchema` / `userManagementStatusSchema` /
  `systemRoleNameSchema` (`packages/validation/src/identity.ts`) — the wire contract for
  this sprint's endpoints, including the 3-value `ACTIVE`/`INACTIVE`/`LOCKED` status view
  mapped onto the DB's 5-value `UserStatus` enum (`INACTIVE` → `SUSPENDED`).
- `user.activated` / `user.deactivated` audit actions (`user-audit-actions.ts`), alongside
  the existing `user.created`/`user.updated`, recorded on every `POST`/`PATCH` via the
  existing `AuditService`.
- `packages/ui`: `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter` (hand-rolled, no new
  dependency), `Select`, `Badge`.
- `apps/web/src/app/settings/users/` — the Users settings page: a table (Name, Email,
  Employee Code, Role, Status), a Create User dialog, an Edit User dialog, and one-click
  Activate/Deactivate per row. No pagination/search/filter/sort, per the brief.
- Seed script (`apps/api/prisma/seed.ts`) now seeds Administrator and Member development
  accounts alongside the existing Owner, via a new `seedUser` helper — same
  "no hardcoded credentials, required env vars" pattern. `apps/api/.env.example`'s
  `SEED_ADMIN_*` placeholder values were also replaced with the actual predictable
  local-development credentials (previously only present in the untracked `.env`), plus
  new `SEED_ADMINISTRATOR_*`/`SEED_MEMBER_*` vars.

### Fixed

- Discovered (not introduced by this sprint) that this app has no global exception filter
  converting the shared `AppError` class into an HTTP response — a `@zentuva/utils`
  `AppError` thrown inside a request handler silently becomes a generic `500`, losing its
  intended status code. `UserService` uses NestJS's own `ConflictException`/
  `NotFoundException` instead (matching `AuthService`'s existing convention), and
  `updateUser` checks the target exists up front so it never reaches
  `UserRepository`'s `AppError`-throwing path. The underlying gap (no filter) is
  pre-existing and unchanged; flagged for a future sprint.

Documentation: `docs/domains/identity.md` reconciled with the shipped User Management API
(§10 Users table, §6 RolesGuard note, §8 audit events table), plus `docs/roadmap.md` and
`docs/database/README.md` swept for the same staleness — see
`docs/sprint-2.2-completion-report.md` §9 for the full list.

## [Sprint 2.1 Organisation Management — Organisation Profile] - 2026-07-30

### Added

- `apps/api/src/identity/organisation/organisation.controller.ts` + `organisation.module.ts`
  — the Organisation Management HTTP surface: `GET /api/organisation/me` (any authenticated
  member) and `PATCH /api/organisation/me` (Owner/Administrator only), backed by the
  `OrganisationService`/`OrganisationRepository` built in Sprint 1B.1.
- `RolesGuard` + `@Roles(...)` decorator (`apps/api/src/identity/auth/guards/roles.guard.ts`,
  `.../decorators/roles.decorator.ts`) — a minimal role-name authorization check (Owner or
  Administrator may update; Member is read-only), per this sprint's explicit "a simple
  role-name check is sufficient... do not build a permission engine" scope. Not the
  generalized permission-key evaluation system identity.md §6 describes long-term — that
  remains future work.
- `RoleRepository.findRoleNamesForUser` / `RoleService.getRoleNamesForUser` — needed by
  `RolesGuard`; didn't exist after Sprint 1B.1/1B.2.
- `Organisation.displayName` column (migration
  `20260730180000_add_organisation_display_name`) — a new MVP field this sprint's field
  list introduced that wasn't in the original identity.md design.
- `updateOrganisationProfileSchema` (`packages/validation/src/identity.ts`) rewritten to
  match this sprint's exact wire contract (`organisationName`, `displayName`, `description`,
  `email`, `phoneNumber`, `website`, `country`, `state`, `city`, `addressLine`, `industry`,
  `currency`, `timezone`) — supersedes the unused Sprint 1B.1 draft, which had no controller
  consumer yet. The controller maps these wire names to their Prisma column names
  (`name`, `phone`, `addressLine1`, `timeZone`).
- `organisation.updated` audit action (`organisation-audit-actions.ts`), recorded on every
  successful profile update via the existing `AuditService`.
- `packages/ui`: `Input`, `Label`, `Textarea`, `Card`/`CardHeader`/`CardTitle`/
  `CardDescription`/`CardContent` — shadcn/ui-style primitives, following the existing
  `Button` component's pattern.
- `apps/web/src/lib/api-client.ts` — a minimal token-aware `fetch` wrapper (reads a bearer
  token from `localStorage`; no login page exists yet, see the completion report's "Known
  limitations").
- `apps/web/src/app/settings/organisation/` — the Organisation Settings page
  (`GET`/`PATCH` via TanStack Query, React Hook Form + Zod validation, four sections:
  General Information, Contact Information, Address, Business Settings), plus Save
  Changes/Cancel.
- `react-hook-form`, `@hookform/resolvers` added to `apps/web`.

### Fixed

- NestJS applies method-level `@UsePipes()` to every parameter, including custom
  decorators like `@CurrentUser()` — not just `@Body()`. Combined with a Zod schema, this
  silently stripped the `@CurrentUser()` payload down to `{}` (Zod's default "strip unknown
  keys" behaviour), which surfaced as a Prisma error on `PATCH /api/organisation/me`. Fixed
  by scoping the pipe to `@Body(new ZodValidationPipe(schema))` instead of the method-level
  `@UsePipes()`, which no other existing endpoint had triggered (none previously combined a
  body-validated `@UsePipes()` with `@CurrentUser()` on the same handler).

Known limitations and deferred work are documented in
`docs/sprint-2.1-completion-report.md`.

## [Sprint 1B.3 Product Backlog] - 2026-07-30

### Added

- `docs/backlog.md` — the single source of truth for Zentuva's long-term product roadmap:
  purpose, product vision, guiding principles, a 13-Epic roadmap (Epic 0 Engineering
  Foundation through Epic 12 AI Platform), current sprint status, a "Future Ideas (Not
  Prioritised Yet)" list, and backlog-maintenance guidance.

Documentation only — no application code, schema, packages, APIs, UI, tests, migrations,
or configuration were touched, per the Sprint 1B.3 brief.

## [Sprint 1B.2 Identity Domain Implementation — Authentication Layer] - 2026-07-30

### Added

- `apps/api/src/identity/auth/` — the Authentication Layer: `AuthService` (login, refresh
  token rotation with reuse detection, logout/logout-all, password reset, invitation
  acceptance, account locking), `AuthController` exposing the 8 `/auth/*` endpoints,
  `JwtAuthGuard` + `@CurrentUser()` (pure authentication, no RBAC), `ZodValidationPipe`, and
  the three brief-required ports behind interfaces: `PasswordHasher` (bcrypt),
  `TokenService` (JWT via `@nestjs/jwt`), `SessionStore` (database-backed, wraps
  `SessionRepository`).
- `apps/api/src/identity/crypto/` — `CryptoModule` providing `PASSWORD_HASHER`, split out
  from `AuthModule`/`IdentityModule` to avoid a circular dependency (`UserService` needs it
  too).
- `apps/api/src/identity/password-reset/` — `PasswordResetRepository` + `PasswordResetService`
  (not built in Sprint 1B.1 since nothing called them yet).
- `User.failedLoginAttempts` column (migration
  `20260730173455_add_user_failed_login_attempts`) — the mechanism `UserStatus.LOCKED`
  (added 1A.1) deliberately left as "a Sprint 1B implementation detail."
- `RoleRepository.assignToUser` / `RoleService.assignRoleToUser` — invitation acceptance
  needs to create a `UserRole` row; this capability didn't exist after Sprint 1B.1.
- New environment variables: `BCRYPT_SALT_ROUNDS`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`,
  `MAX_LOGIN_ATTEMPTS` — validated at boot (non-empty, ≥32 chars for JWT secrets, access ≠
  refresh secret).
- `packages/validation/src/identity.ts`: `acceptInvitationWithTokenSchema`, extending the
  existing `acceptInvitationSchema` with `token`/`firstName`/`lastName`.
- 47 unit tests across 4 new spec files, covering every test target the brief lists
  (password hashing, JWT generation, login, refresh, logout, password reset, invitation
  acceptance, account locking, session management, token rotation).
- `docs/sprint-1B.2-completion-report.md`.

### Changed

- `apps/api/prisma/seed.ts` — switched from `argon2` to `bcrypt` for the seeded admin
  user's password, matching the Authentication Layer's chosen hasher (the `argon2` choice
  in Sprint 1B.1 predated this sprint settling the question; without this change the
  seeded user could never log in). The `argon2` dependency was removed.
- `docs/domains/identity.md` — updated where implementation revealed genuine discrepancies:
  password hashing is bcrypt (not the earlier unconfirmed argon2id assumption); the refresh
  token is a JWT with its own secret (per this sprint's brief) while remaining hashed,
  rotated, and reuse-detected exactly as originally designed; invitation acceptance now
  collects `firstName`/`lastName` (not carried by the `Invitation` entity); `User.status
LOCKED`'s triggering mechanism is now specified; four audit action strings were added to
  §8's event table (`auth.logout_all`, `auth.password.reset_requested`,
  `auth.session.revoked`, `user.locked`). See the completion report's "Deviations" for full
  reasoning on each.

No RBAC evaluation, permission guards, role/organisation/user-management APIs, email
delivery, MFA, OAuth, or SSO were implemented — per the Sprint 1B.2 brief, this was the
Authentication Layer only.

## [Sprint 1B.1 Identity Domain Implementation] - 2026-07-29

### Added

- `apps/api/prisma/schema.prisma` — implemented the full Identity Domain schema (11 models, 3
  enums) exactly per `docs/domains/identity.md` §9. Removed the Sprint 0 placeholder `HealthCheck`
  model.
- Migration `20260729182400_init_identity_domain` — drops `_health_check`, creates all 11 Identity
  tables. Applied and verified against a live Postgres database.
- `apps/api/prisma/seed.ts` — seeds the "Boby Bites" organisation, system roles (Owner,
  Administrator, Member), the full permission catalog, and the first admin user. Admin
  email/password come from required environment variables — no hardcoded credentials.
- `apps/api/src/identity/` — six repositories (Organisation, User, Role, Invitation, Session,
  Audit) with real, tenant-scoped Prisma access, and six matching domain services wired into a new
  `IdentityModule` (imported into `AppModule`, no controllers yet). Verified the full provider
  graph resolves via NestJS dependency injection at runtime.
- `packages/validation/src/identity.ts` — Zod schemas for every documented Identity API contract
  (registration, login, profile updates, invitations, roles, etc.), not yet wired into any
  controller.
- `argon2` added as an `apps/api` dependency, used only to hash the seeded admin user's password.
- `docs/sprint-1B.1-completion-report.md`.

### Changed

- `docs/domains/identity.md` — renamed the system role "Admin" to "Administrator" throughout
  (prose, tables, sequence diagrams), matching the Sprint 1B.1 brief and resolving an existing
  inconsistency with the doc's own "Administrator Name"/"Administrator Email" registration fields.
  Label rename only — no schema or behavioural change.
- `docs/database/README.md` — documented the real Identity Domain models, migrations, and seed
  data (previously a stub).

No authentication, JWT, login, controllers, guards, Swagger, or frontend work was done — per the
Sprint 1B.1 brief, this was Database & Domain Layer only.

## [Sprint 1A.1 Identity Design Refinements] - 2026-07-29

### Changed

- `docs/domains/identity.md` — post-review MVP refinements to the Identity Domain design
  (documentation only, no code/schema/migrations touched): added immutable
  `Organisation.organisationCode`, added optional `User.employeeCode`, expanded `UserStatus` with
  a `LOCKED` state, and added two intentionally-deferred items (Organisation Type, Feature
  flags/module enablement) to the Risks & Future Expansion table.
- `docs/sprint-1A-identity-design-report.md` — added a "Post-Review Refinements" section
  summarising what changed, why, what was deferred, and re-confirming Sprint 1B approval.

The Prisma schema changes were re-validated with `prisma validate`/`prisma format` against a
scratch file, same as the original Sprint 1A schema — still not written into
`apps/api/prisma/schema.prisma`.

## [Sprint 1A Identity Design] - 2026-07-29

### Added

- `docs/domains/identity.md` — complete Identity Domain design: business rules, Organisation
  Registration/Profile split, entity design for all ten entities (Organisation, User, Role,
  Permission, UserRole, RolePermission, Invitation, Session, RefreshToken, PasswordResetToken,
  AuditLog), authentication and authorisation design, tenant isolation strategy, audit strategy,
  a Prisma schema (validated via `prisma validate`/`format` against a scratch file, not yet
  implemented in `apps/api/prisma/schema.prisma`), an API contract sketch, six Mermaid sequence
  diagrams, and a risks/future-expansion table.
- `docs/sprint-1A-identity-design-report.md` — design decisions, assumptions, open questions, and
  recommendations before Sprint 1B implementation.
- `docs/domains/README.md` — added a domain status table.
- `docs/roadmap.md` — checked off Identity domain design under Phase 1.

No API, frontend, authentication logic, or real migrations were implemented — this sprint was
design-and-documentation only, per the Sprint 1A brief.

## [Sprint 0 Finalisation] - 2026-07-29

### Added

- Root convenience scripts for the entire daily dev loop: `infra:up`, `infra:down`,
  `infra:restart`, `infra:logs`, `infra:reset`, `db:generate`, `db:migrate`, `db:studio`,
  `db:seed`, `db:reset` — no developer needs to remember a raw `docker compose` or `prisma`
  command.
- `apps/api/prisma/seed.ts` — placeholder seed script wired up via `pnpm db:seed`, ready for
  domain modules to extend.
- `apps/api` `dev:debug` script (`nest start --watch --debug`) for VS Code debugging.
- `.vscode/launch.json` — shared debug configs for NestJS (attach) and Next.js (server-side +
  client-side), plus a combined compound; `.vscode/extensions.json` and `.vscode/settings.json`
  for a consistent editor setup. (`.gitignore` updated — it previously excluded all of `.vscode/`
  except `extensions.json`, which would have silently dropped `launch.json`.)
- `docs/development/local-development.md` — the complete local development guide (first-time
  setup, command reference, migrations, Prisma Studio, debugging, environment file breakdown,
  port-conflict and Docker troubleshooting).
- Handbook Principle 10 — **Developer Experience Is a Feature** — added to
  [engineering-handbook.md](handbook/engineering-handbook.md) (version bumped to 0.2).

### Changed

- `docker-compose.yml` renamed to `docker-compose.production.yml` and documented as the
  full-stack/production-verification path, **not** the daily development workflow.
  `docker-compose.dev.yml` (Postgres + Redis only) is now the canonical dev-infra file, wrapped by
  the `infra:*` scripts above.
- Simplified the environment file story: local development now needs exactly two files
  (`apps/api/.env`, `apps/web/.env.local`) instead of copying `.env.example` into three or more
  locations. Root `.env` and the non-`.local` app `.env` files are now clearly documented as
  optional/production-compose-only.
- `docs/handbook/getting-started.md` trimmed to a quick-start that links to the full
  [Local Development Guide](development/local-development.md), removing duplicated detail between
  the two documents.
- `docs/handbook/development-workflow.md` and `docs/handbook/architecture-overview.md` updated to
  reflect the `infra:up` / `dev` / `infra:down` workflow and the dev/production compose split.

No business functionality was touched — this sprint was scoped entirely to developer experience
and local development tooling, per the Sprint 0 finalisation brief.

## [Sprint 0 Foundation]

### Added

- Initial engineering foundation: Turborepo monorepo (`apps/web`, `apps/api`, `packages/ui`,
  `packages/types`, `packages/config`, `packages/utils`, `packages/validation`).
- NestJS backend skeleton with global config module, Prisma integration, and a `/api/health`
  endpoint (`@nestjs/terminus`, checks database + heap).
- Next.js frontend skeleton (App Router) with Tailwind CSS, shadcn/ui (`packages/ui`), and
  TanStack Query provider.
- Shared tooling: ESLint, Prettier, Husky + lint-staged, EditorConfig, path aliases, shared
  TypeScript configs.
- Docker Compose for full-stack (`docker-compose.yml`, later renamed to
  `docker-compose.production.yml`) and infra-only local dev (`docker-compose.dev.yml`), plus
  per-app Dockerfiles.
- `docs/` structure: engineering handbook, coding standards, architecture overview, development
  workflow, getting started, ADRs (001–004), API/database/domain doc stubs, roadmap.

No business modules (authentication, users, product catalogue, or any domain module) were
implemented — this is foundation-only, per the task scope.
