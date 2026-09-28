# Sprint 32 Completion Report — Consumer Identity, Territory & Location Foundation

## 1. Audit Summary (performed before any implementation)

1. **Existing relevant entities**: `Territory` (self-referential hierarchy,
   Sprint 4.8), `Customer`/`Outlet` (B2B, optional `territoryId`, `phoneNumber`
   as a free, unnormalized, non-unique string), `DistributionNetworkRelationship`,
   `SalesOrder`/`SalesOrderItem` (no consumer touchpoint needed this sprint).
2. **Existing territory/location capability**: already sufficient.
   `Territory.parentTerritoryId` + a free-text `type` per level (State/City/
   LGA/Area) gives exactly the two-step "select territory → select location"
   structure the brief describes — the seeded Boby Bites hierarchy is
   literally `Oyo State → Ibadan → {Ibadan North, Ibadan South-West} →
{Bodija, Mokola, Challenge}`, matching the brief's own worked example
   verbatim. **Decision: no new Location/ConsumerTerritory/D2CTerritory
   model was created** — a Consumer's structured location is a plain
   `territoryId` FK to a leaf `Territory` row.
3. **Existing outlet/customer relationships**: `Customer` requires only
   `customerType`/`customerName`/`phoneNumber`; no phone normalization or
   dedup exists anywhere in Customer/Outlet — genuinely new ground for
   Consumer.
4. **Existing tenant-scoping patterns**: universal — every repository read
   takes `(organisationId, id)` together; every write is a conditional
   `updateMany`; codes (`CUS-`, `TER-`, `OUT-`) are globally unique via a
   sequential `existsByCode` loop, never organisation-prefixed. Consumer's
   `CON-000001` code follows this exact convention.
5. **Existing audit patterns**: `AuditService.record({action, entityType,
entityId, organisationId, actorUserId, metadata, ipAddress, userAgent})`
   — reused as-is.
6. **Existing authorization patterns**: `PermissionsGuard`/
   `@RequirePermission`/`EffectiveAccessResolver` — reused as-is. New
   catalogue entries: `d2c.consumer.view`/`.manage` (SCOPABLE), mirroring
   `sales.customer.view`/`.manage` exactly.
7. **Existing seed/demo data reused**: Boby Bites' 7-territory hierarchy
   (`TER-000001`…`TER-000007`) — no new territories seeded.
8. **Schema collision risk**: none. `Consumer` is a genuinely new concept;
   nothing in the schema overlapped it (confirmed via a full-repo grep for
   "Consumer"/"d2c"/"D2C" before writing any code — zero matches outside an
   unrelated marketing landing-page component).
9. **Key finding — `NotificationPreference` cannot be reused as-is**:
   `Notification.recipientUserId`/`NotificationPreference.userId` are both
   hard-wired to a real `User.id`. A Consumer is explicitly never a `User`
   (brief §3), so it structurally cannot hold a row in that table. This is
   a genuine architectural reason, not an oversight, to introduce something
   smaller instead: a single `Consumer.marketingOptIn` boolean.
10. **Recommended integration approach** (implemented as designed): a new
    top-level `apps/api/src/d2c/consumer/` module, flat sibling to
    `retail/`, registered directly in `AppModule` — no umbrella module.
    `Consumer.territoryId` reuses `Territory` directly via
    `TerritoryRepository`. Phone normalization reuses
    `notifications/phone-number-normalizer.ts` verbatim. Idempotent
    registration mirrors `CandidateRepository.findOrCreate`'s exact
    check-then-create-with-`P2002`-recovery pattern. One small additional
    model, `ConsumerLocationRequest`, for the "can't find my location"
    fallback signal.

## 2. Implementation

**New files**:

- `apps/api/prisma/migrations/20260928063642_sprint32_consumer_foundation/migration.sql`
- `apps/api/src/d2c/consumer/consumer.repository.ts`,
  `consumer-location-request.repository.ts`, `consumer.service.ts`,
  `consumer.controller.ts`, `consumer-audit-actions.ts`, `consumer.module.ts`
- `apps/api/src/d2c/consumer/consumer.repository.spec.ts`,
  `consumer.service.spec.ts`, `d2c-independence.spec.ts`
- `packages/validation/src/d2c.ts`
- `apps/web/src/app/(app)/settings/d2c/consumers/api.ts`, `page.tsx`
- `docs/domains/d2c.md`, `docs/sprint-32-completion-report.md`

**Modified files**: `apps/api/prisma/schema.prisma` (2 new models, 1 new
enum, 2 new `Organisation`/1 new `Territory` back-relations),
`apps/api/prisma/seed.ts` (new `seedD2cFixtures()`, 2 demo consumers),
`apps/api/src/app.module.ts` (registers `ConsumerModule`),
`apps/api/src/identity/authorization/permission-catalogue.ts` (+2 entries),
`apps/web/src/components/workspace/navigation-config.ts` (+1 sidebar
entry), `packages/validation/src/index.ts` (+1 export), `README.md`,
`docs/domains/README.md`, `docs/roadmap.md`, `docs/backlog.md`,
`docs/changelog.md`.

**Database changes**: `ConsumerStatus` enum (`ACTIVE`/`SUSPENDED`/
`INACTIVE`); `Consumer` model (`@@unique([organisationId, normalizedPhone])`,
`consumerCode String @unique`, optional `territoryId` FK to `Territory`);
`ConsumerLocationRequest` model (required `consumerId` FK, `onDelete:
Cascade`). One migration, applied cleanly against the real dev database —
no schema change to any existing table.

**API routes** (`/d2c/consumers`, all `JwtAuthGuard` + permission-gated,
internal/admin only): `GET /`, `GET /:id`, `POST /` (register),
`PATCH /:id` (profile), `PATCH /:id/location`, `POST /:id/activate`,
`POST /:id/suspend`, `POST /:id/deactivate`, `POST /:id/location-requests`,
`GET /location-requests`, `POST /location-requests/:id/resolve`.

**Services** (channel-neutral, brief §17/§26 contract):
`registerConsumer`, `findConsumerByPhone`, `getConsumerProfile`/`getById`,
`updateConsumerLocation`, `updateProfile`, `list`, `activate`/`suspend`/
`deactivate`, `reportLocationNotFound`, `listLocationRequests`,
`resolveLocationRequest`.

**Permissions**: `d2c.consumer.view` (SCOPABLE), `d2c.consumer.manage`
(SCOPABLE). Catalogue: 149 → 151 entries.

**Audit integration**: `consumer.registered` (only on actual creation, never
on an idempotent hit), `.profile_updated`, `.location_updated`,
`.activated`/`.suspended`/`.deactivated`, `.location_request_created`/
`.location_request_resolved` — all via the existing `AuditService`.

**Seed changes**: new `seedD2cFixtures()`, unconditionally idempotent
(upsert-by-`consumerCode`, no "already seeded, skip everything" guard).
Two demonstration consumers only (`CON-000001` Blessing Okafor → Bodija,
`CON-000002` Tayo Bello → Challenge), reusing the existing Boby Bites
organisation and territories — no new organisation, no new territories.

## 3. Integration Audit

- **Identity**: reuses `OrganisationService.getById` (to read
  `Organisation.country` for phone normalization), `JwtAuthGuard`,
  `TokenPayload`. No changes to `User`/`Employee`/authentication.
- **Customer/Outlet**: zero coupling — Consumer never references or is
  referenced by `Customer`/`Outlet`. Verified structurally (§5).
- **Territory**: the ONE deliberate integration point — `Consumer.territoryId`
  is a plain FK to the existing `Territory` table, validated via the same
  `TerritoryRepository.findById(organisationId, id)` call
  `CustomerService.assertTerritoryExists` already uses. No new geography
  model.
- **Sales**: zero coupling — Sprint 32 does not touch `SalesOrder`/
  `SalesOrderItem` at all, per the brief's explicit "unless absolutely
  required" scoping (it was not required).
- **Notifications**: reuses `normalizePhoneNumber`
  (`notifications/phone-number-normalizer.ts`) as a plain utility import —
  the ONLY import from that directory, verified by
  `d2c-independence.spec.ts`. Does NOT reuse `NotificationPreference`/
  `Notification` (§1 finding 9) — introduces `Consumer.marketingOptIn`
  instead, with the architectural reasoning documented in
  `docs/domains/d2c.md` §8.
- **Access Control**: two new catalogue entries only, `PermissionsGuard`/
  `@RequirePermission` reused unchanged. No new guard, no new scope type.
- **Audit**: `AuditService.record()` reused unchanged, no parallel table.

## 4. Tests

```
Test Suites: 218 passed, 218 total
Tests:       1889 passed, 1889 total
Snapshots:   0 total
```

**New this sprint**: 3 suites / 28 tests —
`consumer.repository.spec.ts` (6: idempotent create, repeated-registration
returns existing, a genuine `Promise.all` race converging on exactly one
row via the real `P2002`-recovery path, tenant isolation on create/find/
update), `consumer.service.spec.ts` (16: phone-normalization equivalence
across 3 input formats, unnormalizable-phone rejection, invalid-territory
rejection on register AND on location update, repeated-registration
returns existing not new, location-clear without touching Territory,
status-transition guards), `d2c-independence.spec.ts` (6 structural guards:
no cross-domain table writes, no WhatsApp-specific class/import, no
Finance/Sales/Production/HR/Workflow/Notifications-service import, no
second geography model name, `ConsumerModule`'s import list is exactly
`IdentityModule`/`AuthModule`/`TerritoryModule`, the phone normalizer is
imported rather than reimplemented).

**Pre-existing suites**: all 215 suites / 1861 tests from before this
sprint still pass unchanged in the same run — confirmed Customer, Outlet,
Territory, Sales, Identity, Access Control, Notifications, Audit, Finance,
and Recruitment are all unaffected.

## 5. Quality Checks

- **Prisma**: `npx prisma validate` → schema valid. `npx prisma migrate
status` → "Database schema is up to date!" (50 migrations, the new one
  applied cleanly).
- **Typecheck**: `tsc --noEmit` clean on both `apps/api` and `apps/web`
  (after rebuilding `@zentuva/validation`, whose new `d2c.ts` exports both
  apps depend on).
- **Lint**: `eslint` on every new/changed file — 0 errors, 0 new warnings.
  (One pre-existing, unrelated warning remains in `prisma/seed.ts` — an
  unused `compressorSchedule` variable from an earlier sprint, untouched
  by this one.)
- **API build**: `nest build` — clean.
- **Web build**: `next build` — clean; `/settings/d2c/consumers` compiles
  and appears in the route manifest.

## 6. Live Verification (real HTTP requests against the running dev server)

1. **Consumer registration**: `POST /d2c/consumers` with a local-format
   Nigerian number (`08099998888`) → `201`, `normalizedPhone:
"+2348099998888"`, `consumerCode: "CON-000003"`.
2. **Duplicate registration, three equivalent formats**: re-registered the
   same person as `2348099998888` then `+2348099998888` → both returned
   `alreadyRegistered: true` with the SAME `id`/`consumerCode` — confirmed
   via direct DB query that exactly one row exists for that
   `normalizedPhone`.
3. **True concurrency race**: fired 5 genuinely simultaneous `curl`
   requests (backgrounded, `wait`ed together) for the same phone number →
   exactly one `201`-equivalent creation (`alreadyRegistered: false`),
   four `alreadyRegistered: true`, all five responses carrying the
   identical `id`; direct DB query confirmed exactly 1 row for that
   `normalizedPhone`.
4. **Invalid phone rejected**: `phoneNumber: "123"` → `400`, "Phone number
   is not in a recognized Nigerian local format."
5. **Invalid territory rejected**: both on register and on
   `PATCH .../location` with a non-existent `territoryId` → `400`,
   "Territory not found."
6. **Location update**: assigned a real "Bodija" territory id → `200`,
   `territoryId` correctly set and persisted.
7. **Location-not-found signal**: `POST .../location-requests` with
   "somewhere around Challenge, near the market" → `201`; confirmed via
   `GET /d2c/consumers/location-requests` it appears in the open worklist;
   confirmed the `Territory` table's row count stayed at 7 (no
   auto-creation); resolved it via `POST .../resolve` → disappears from the
   open list.
8. **Unauthorized access**: no token → `401` "Missing bearer access
   token"; Member role (holds neither `d2c.consumer.view` nor `.manage`) →
   `403` on both `GET` (list) and `POST` (register) with the correct
   missing-permission message.
9. **Cross-tenant isolation**: enabled a real second, pre-existing
   organisation's user for login, then confirmed: `GET` on a real Boby
   Bites consumer id → `404`; `PATCH .../location` on the same id → `404`;
   `?search=Funmi` → empty list (no data leak); `POST .../suspend` on the
   same id → `404`; registering a consumer IN the other org and then
   assigning it a Boby Bites `territoryId` → `400` "Territory not found"
   (tenant-scoped territory lookup correctly rejects a cross-tenant id).
10. **Audit**: confirmed via direct DB query — `consumer.registered`,
    `.location_updated`, `.location_request_created`,
    `.location_request_resolved` all recorded with correct `entityId`/
    `metadata`; critically, the 5-way concurrent registration race produced
    exactly ONE `consumer.registered` audit row, not five — the controller
    only records the event when `created === true`.
11. **Seed idempotency**: ran `pnpm run prisma:seed` twice in direct
    succession after all live-testing activity — territory count stayed at
    7, both `CON-000001`/`CON-000002` demo consumers remained exactly as
    seeded, no duplicates, no errors.
12. **Internal admin UI**: logged in as Administrator, navigated to
    `/settings/d2c/consumers` — list renders all 5 real consumers with
    code/phone/territory; clicked into "Funmi Adeleke" — detail dialog
    correctly showed the raw→normalized phone transformation, the
    "Bodija" territory selection, status action buttons, and the
    location-not-found logging form; used the "Register Consumer" dialog
    end-to-end through the real UI (not just `curl`) — new consumer
    "CON-000006" appeared in the list immediately. Verified at both desktop
    and 375px mobile width — renders cleanly at both, no overflow.

## 7. Architecture Verification

- **Channel neutrality — confirmed**: `ConsumerService` contains zero
  WhatsApp-specific code, imports, or classes. `d2c-independence.spec.ts`
  asserts this executably (no `class WhatsApp*`, no `import ... WhatsApp*
from`), not just by convention. The only cross-domain import in the
  entire `d2c/consumer/` directory is the plain `normalizePhoneNumber`
  utility function — no `NotificationsModule`, no `NotificationService`.
  `ConsumerController` is a thin, replaceable caller of the exact same
  service methods a future WhatsApp/simulator adapter is expected to call
  directly.
- **Territory/location reuse — confirmed**: no `ConsumerTerritory`/
  `D2CTerritory`/`WhatsAppTerritory`/`ConsumerRegion`/`Location` model
  exists anywhere in this sprint's code (asserted by
  `d2c-independence.spec.ts`). `Consumer.territoryId` is a plain FK to the
  pre-existing `Territory` table, validated through the pre-existing
  `TerritoryRepository`.

## 8. Deferred to Later Sprints

WhatsApp API/Meta integration/webhooks/templates, the WhatsApp simulator,
D2C ordering, payment gateway/links, Collection Points and their
assignment, consumer fulfilment, D2C inventory deductions, loyalty
points/rewards, campaigns/promotions/marketing segmentation, demand
intelligence, and the full Sprint 39 D2C Sales Administration dashboard.
Also explicitly deferred within the identity model itself: a real
multi-category communication-preference structure (today: one
`marketingOptIn` boolean only, per §1 finding 9); a "resubmit a resolved
location request" or any richer location-request workflow beyond
open/resolved; changing an existing consumer's identity phone number
(re-normalization/re-uniqueness/merge implications, out of scope).

## 9. A Note on Live-Verification Test Data

To perform the cross-tenant isolation tests in §6 item 9, a known password
was set (via direct DB update, bcrypt-hashed) on a pre-existing, already
locally-seeded second organisation's owner account
(`owner@testtenant.local`, from an earlier sprint's cross-tenant test
fixtures) — its original password was unknown and unrecoverable, and no
credentials were guessed or bypassed. This is local Postgres development
data only, not a production system; the change is harmless and left in
place, consistent with this project's "nothing deletes rows" convention.
One consumer was also registered under that organisation (`CON-000005`,
"Other Org Consumer") purely to test cross-tenant territory-assignment
rejection — left in place as harmless demonstration data.

## 10. Git

- **No commit made.**
- **No push made.**
- Branch: `main`.
- HEAD: `0d052ee123a2d8e010417b0ba37cba2f68854ca2` — "Sprints 30, 30.1, 30.2:
  Recruitment & Candidate Interview Management" (unchanged by this
  sprint's work).
- Modified files (11): `README.md`, `apps/api/prisma/schema.prisma`,
  `apps/api/prisma/seed.ts`, `apps/api/src/app.module.ts`,
  `apps/api/src/identity/authorization/permission-catalogue.ts`,
  `apps/web/src/components/workspace/navigation-config.ts`,
  `docs/backlog.md`, `docs/changelog.md`, `docs/domains/README.md`,
  `docs/roadmap.md`, `packages/validation/src/index.ts`.
- Untracked/new (6 top-level paths, excluding the unrelated `.claude/`
  tooling directory): `apps/api/prisma/migrations/20260928063642_sprint32_consumer_foundation/`,
  `apps/api/src/d2c/`, `apps/web/src/app/(app)/settings/d2c/`,
  `docs/domains/d2c.md`, `docs/sprint-32-completion-report.md`,
  `packages/validation/src/d2c.ts`.
- All work remains in the working tree for review, per this sprint's own
  standing "DO NOT commit. DO NOT push." instruction.
