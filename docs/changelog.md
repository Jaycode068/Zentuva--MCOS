# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

_Nothing yet._

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
