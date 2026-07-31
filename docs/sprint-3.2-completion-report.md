# Sprint 3.2 Completion Report — Tenant Registration & Organisation Onboarding

**Date:** 2026-07-31
**Status:** Complete

## 1. Objective

Build Zentuva's first onboarding experience: a new company visits the public site, clicks
Get Started, registers its organisation through a two-section form (Organisation
Information + Owner Account), and the backend atomically provisions a new tenant —
organisation, default roles, an Owner user, and an audit entry — in one transaction with
full rollback on any failure. The user then sees a "Registration Successful" confirmation,
signs in, and lands on `/settings/organisation` showing their **own** organisation's real
data, not seeded demo data. Explicit constraints from the brief: preserve every prior
feature, don't rewrite existing authentication, don't replace the Identity Domain, don't
change the DB model unless absolutely required, reuse existing services/repositories/
validation/roles wherever possible, and rebalance the brand palette (Sprint 3.1 leaned too
heavily on purple) so deep purple, soft lavender, and pink are all visibly present.

## 2. Implementation Summary

### Backend — atomic tenant provisioning

`POST /api/auth/register` (`apps/api/src/identity/auth/auth.controller.ts`) is the new
entry point. `OrganisationService.register()` performs duplicate checks (organisation
name, owner email — both `409 Conflict` via NestJS's built-in `ConflictException`, since
the app has no global filter converting the shared `AppError` class into an HTTP response,
a gap discovered in Sprint 2.2 and worked around the same way here), generates a unique
slug and organisation code, and delegates the actual writes to
`OrganisationRepository.registerTenant`.

`registerTenant` runs inside a single `prisma.$transaction(async (tx) => {...})` block: a
thrown error at any point rolls back every write made through that `tx` client. It writes
the organisation, the three default system roles (Owner/Administrator/Member), the Owner
user, and an audit entry directly against `tx`, rather than going through
`UserRepository`/`RoleRepository`/`AuditRepository` — none of those repositories currently
accept an external `tx` client, so routing through them would have meant either adding
`tx` parameters to every method (larger surface change than this sprint's "don't change
the DB model unless necessary" and "reuse existing code" constraints, taken together,
justified) or losing atomicity. This mirrors the pattern already used and proven in
`apps/api/prisma/seed.ts`'s role/permission seeding. It's a deliberate, scoped exception,
not a violation of "reuse existing services" — documented here and in the changelog so
it's easy to find if a future sprint adds `tx` support to those repositories and this code
can be simplified.

Slug generation: kebab-case of the organisation name, with a numeric collision suffix
(`-2`, `-3`, ...) if the slug is already taken. Organisation code generation: first three
uppercase letters of the name (falls back to `ZEN` if the name has no letters), plus a
zero-padded 4-digit sequence that increments on collision — e.g. `SAH-0001` for "Sahara
Textiles Ltd", `SAH-0002` for a second organisation with the same prefix.

`registerOrganisationSchema` in `packages/validation/src/identity.ts` was fully rewritten
to match this real wire contract (it previously held an unused Sprint 1B.1 draft) —
`organisationName`, `country`, and owner `firstName`/`lastName`/`email`/`password`/
`confirmPassword`/`acceptTerms` are required; `displayName`, `industry`, address fields,
`phoneNumber`, `businessEmail`, and `website` are optional.

### Frontend — registration, success, and sign-in

- `apps/web/src/app/register/page.tsx` — the two-`Card` form (Organisation Information,
  Owner Account). Uses a **local, lenient** Zod schema (`.or(z.literal(''))` on optional
  fields) rather than the shared strict schema directly, because HTML inputs default to
  `''` and the shared schema's `.optional()` only accepts `undefined` — the same
  reconciliation pattern established in Sprint 2.1. The mutation strips `''` back to
  `undefined` before calling the API.
- `apps/web/src/app/register/success/page.tsx` — shows the new organisation's name, code,
  and owner email, passed via URL query params from the registration response (the user's
  own just-entered, non-sensitive data) rather than client state, so it survives the full
  page navigation from `/register`. Wrapped in `<Suspense>` as required by
  `useSearchParams()`.
- `apps/web/src/app/login/page.tsx` — sign-in form; stores the returned tokens
  (`setTokens` in `apps/web/src/lib/api-client.ts`) and redirects to
  `/settings/organisation`.
- `apps/web/src/app/login/forgot-password/page.tsx` — reuses the Sprint 1B.2
  `POST /auth/password/request-reset` endpoint, which existed but had no frontend caller
  until now.
- `apps/web/src/components/app/authenticated-nav.tsx` +
  `apps/web/src/app/settings/layout.tsx` — a top nav (Logo, organisation name, user
  avatar with initials, Logout) wrapping all `/settings/*` pages. There's no dedicated
  "current user" endpoint, so the user id comes from decoding the access token's `sub`
  claim client-side (`getCurrentUserId`, explicitly documented as display-only — the
  server still re-validates every request via the existing `JwtAuthGuard`); the name and
  initials come from the existing Sprint 2.2 `GET /api/users/:id` endpoint. This avoids
  adding new backend surface for a purely cosmetic need.
- Marketing site's placeholder links (`navbar.tsx`, `hero.tsx`) now point at the real
  routes: logo → `/`, Sign In → `/login`, Get Started → `/register`.

### Brand rebalance

Sprint 3.1 used `--primary` (purple) for nearly every accent, leaving pink underused. This
sprint flips the meaning of `--primary` to pink (`330 75% 55%`, `330 70% 65%` dark) so
every interactive element that reads `primary` — the default `Button` variant, `--ring`
(focus states), text links — becomes pink automatically, with no per-component changes
needed for those cases. A new `--brand-purple` / `--brand-purple-foreground` token pair
was added for non-interactive brand elements — headings, icons, illustrations, major
section titles — and every Sprint 3.1 marketing component was audited and updated to use
`brandPurple` where it was previously (incorrectly, for this sprint's balance goal) using
`primary`. `--foreground` was also reset to a neutral near-black instead of a
purple-tinted value. Result: purple reads as "the Zentuva brand mark," pink reads as "click
here" — verified visually in the browser (registration form's focus rings, CTA button, and
Terms-of-Service link all render pink; headings and the settings-page avatar render
purple; page backgrounds and cards render lavender).

### Documentation reconciliation

`docs/domains/identity.md` §10's Auth API table has carried an illustrative `POST
/auth/register` sketch (`{ organisationName, businessEmail, ..., adminFirstName, ... }` →
`{ organisation, user, accessToken, refreshToken }`) since Sprint 1A, explicitly labeled
"nothing below is implemented." That's no longer true for this one row now that the
endpoint is real, and the sketch's field names and response shape don't match what was
actually built (business email is optional, not required; the response returns
`{ organisation, owner }` with no tokens — the new Owner logs in separately). Rather than
leave a stale, misleading sketch next to real behavior, the table row and its surrounding
note were updated in place, and a short reconciliation note was added beneath the table
describing the actual request/response shape — the same "verify and fix identity.md
discrepancies" practice followed in Sprints 1B.2 and 2.1. The doc's header metadata
(Status, Sprint, See also) was also updated to list Sprint 3.2. No other sections were
touched — the rest of §10's Auth table (login/logout/refresh/password reset, all
implemented since 1B.2) was already stale before this sprint and is out of scope here.

## 3. Testing / Verification Performed

- Full monorepo quality gate from a clean state (`dist`/`.next`/`.turbo` wiped and
  rebuilt): `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build` all green across all
  7 workspace packages. 77/77 backend unit tests pass (69 pre-existing + 8 new in
  `organisation.service.spec.ts` covering `register()`: success, duplicate organisation
  name, duplicate email, and slug/code collision handling).
- Live end-to-end browser verification of the full journey against the real API and a
  local Postgres instance:
  1. Landing page → clicked "Get Started" → landed on `/register`.
  2. Filled and submitted the two-section form (Sahara Textiles Ltd, Nigeria, Owner Amina
     Yusuf) → redirected to `/register/success` showing "Sahara Textiles Ltd", code
     `SAH-0001`, and the owner's email — all correct, pulled from the real API response.
  3. Clicked "Continue to Login" → `/login` rendered correctly.
  4. Signed in with the just-created owner credentials → redirected to
     `/settings/organisation`, which showed the **real** newly-registered organisation's
     data (name, code, email, phone) — not the seeded "Boby Bites" demo data.
  5. Confirmed the authenticated nav shows "Sahara Textiles Ltd" next to the logo and an
     "AY" avatar (Amina Yusuf's initials) at desktop width (≥640px) — correctly hidden at
     narrower widths per the responsive `hidden sm:inline` styling.
  6. Tested Logout — cleared tokens and redirected back to `/login`.
  7. Re-tested duplicate protection directly against the API: re-registering the same
     organisation name returns `409 Conflict` ("already taken"); re-registering with the
     same owner email returns `409 Conflict` ("already in use").
- Verified at both desktop (1280px) and mobile (375px) viewports: the registration form
  reflows to a single column with no overflow at mobile width; all brand colors (purple
  headings, lavender backgrounds/cards, pink CTAs and focus states) are present at both
  sizes.
- No regressions observed in prior features: `/settings/organisation` and
  `/settings/users` (Sprint 2.1/2.2) continue to work under the new nav layout and brand
  palette; the landing page (Sprint 3.1) renders unchanged aside from its two
  now-functional links.

## 4. Known Limitations

- **Repository-bypass in `registerTenant`.** As described above, the transactional
  registration write goes directly against the Prisma `tx` client instead of through
  `UserRepository`/`RoleRepository`/`AuditRepository`, because none of them currently
  accept an external transaction client. This is scoped and documented, not silent — a
  future sprint that needs more cross-aggregate transactional writes should consider
  adding `tx`-aware variants to those repositories instead of continuing to grow
  transaction-specific logic in `OrganisationRepository`.
- **No dedicated "current user" endpoint.** The authenticated nav's user info is derived
  by decoding the JWT for the user id and re-fetching via `GET /api/users/:id`. This works
  and is documented as display-only, but a proper `/auth/me` endpoint would be cleaner if
  more session-derived data (e.g. permissions) is needed later.
- **"Book a Demo" is still a static anchor link.** No demo-booking flow exists — unchanged
  from Sprint 3.1, not in scope for this sprint.
- **RBAC is still name-based.** `RolesGuard` (built in Sprint 2.1) checks role _names_
  (`Owner`, `Administrator`), not the full `Permission`/`RolePermission` evaluation engine
  `docs/domains/identity.md` §6 describes. The newly-registered Owner account works
  correctly against this simpler check; the full permission engine remains deferred, as it
  has since Sprint 2.1.

## 5. Deferred / Future Work

A proper `/auth/me` endpoint (if session-derived data grows beyond a display name and
initials), the full RBAC/Permission evaluation engine, `tx`-aware repository methods (if
more transactional cross-aggregate writes are needed), a working "Book a Demo" flow, and
the real Zentuva logo asset (still a geometric recreation per the Sprint 3.1 known
limitation, unchanged this sprint) are all reasonable candidates for a future sprint but
were not part of this one's scope.
