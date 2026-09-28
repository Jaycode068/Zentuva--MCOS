# D2C — Consumer Identity, Territory & Location Foundation

## 1. Purpose

Sprint 32 establishes the backend foundation for identifying D2C (direct-
to-consumer) end consumers and associating them with Zentuva's existing,
structured geographic/territory directory, so later sprints can reliably
route an order to a Collection Point and a Sales Representative. This is
the identity layer for the eventual:

```
QR → WhatsApp → Consumer Registration → Location → Order → Payment → Collection Point
```

This sprint deliberately does **not** implement WhatsApp, ordering, payment,
loyalty, Collection Points, or marketing campaigns — see §11 "Deferred
Scope."

## 2. Consumer vs Customer vs User vs Employee vs Outlet

A distinct business actor, never conflated with an existing one:

```
User       = authenticated internal/system user (login, password, session)
Employee   = organisation workforce identity (HR record)
Customer   = existing B2B commercial account (Sprint 4.8)
Outlet     = B2B retail/distribution physical location (Sprint 4.8)
Consumer   = D2C end consumer — NEW this sprint
```

A `Consumer` has no `passwordHash`, no session, no role/permission grants of
its own, and is never assignable a `User`/`Employee` row. It may eventually
interact with Zentuva exclusively through a future WhatsApp conversation,
never logging in at all — the data model must not assume otherwise.

## 3. Channel Neutrality (the central architectural requirement)

`ConsumerService` (`apps/api/src/d2c/consumer/consumer.service.ts`) is a
pure business-logic service with **zero** knowledge of WhatsApp, HTTP, or
any other channel. `ConsumerController` (this sprint's internal/admin HTTP
surface) is a thin caller of exactly the same methods a future channel
adapter is expected to call directly:

```
                 Consumer
                    │
          ┌─────────┴─────────┐
          │                   │
     WhatsApp             Simulator
      Adapter               Adapter
          │                   │
          └─────────┬─────────┘
                    │
             Consumer/D2C
              Application
                Services
           (ConsumerService)
```

The service contract this sprint establishes and tests explicitly (brief
§26 — future channel adapters depend on this, not on any HTTP route or
database detail):

- `registerConsumer(organisationId, input, actorUserId?)` — idempotent by
  `[organisationId, normalizedPhone]`.
- `findConsumerByPhone(organisationId, rawPhoneNumber)`.
- `getConsumerProfile(organisationId, id)` / `getById(organisationId, id)`.
- `updateConsumerLocation(organisationId, id, territoryId, actorUserId?)`.
- `list`, `updateProfile`, `activate`/`suspend`/`deactivate`,
  `reportLocationNotFound`, `listLocationRequests`,
  `resolveLocationRequest`.

Verified executably, not just documented: `d2c-independence.spec.ts`
structurally asserts no D2C file imports or defines any WhatsApp-specific
class/module, imports no Finance/Sales/Production/HR/Workflow/Notifications
module, and writes to no table outside its own two.

## 4. Structured Location — Territory Is Reused, Not Duplicated

**Audit finding**: Zentuva already has exactly the structured location
hierarchy this sprint needs. `Territory` (Sprint 4.8,
`apps/api/src/retail/territory/`) is a self-referential, organisation-
defined hierarchy of arbitrary depth with a free-text `type` per level — the
seeded Boby Bites data is already `Oyo State → Ibadan → {Ibadan North,
Ibadan South-West} → {Bodija, Mokola, Challenge}`, literally the exact
worked example the brief describes ("Select your territory: [Ibadan
North]... Select your location: [Bodija]...").

**Decision: no new Location/ConsumerTerritory/D2CTerritory/ConsumerRegion
model was created.** `Consumer.territoryId` is a plain optional FK to the
existing `Territory` table, identical in shape to
`Customer.territoryId`/`Outlet.territoryId`. A leaf-level `Territory` row
(e.g. "Bodija", type `Area`) **is** the consumer's structured location; its
self-referential ancestor chain up to the root already gives a future
Collection Point matching algorithm every level it could need:

```
Consumer
   ↓
territoryId → Territory ("Bodija", type Area)
                  ↓ parentTerritoryId
              Territory ("Ibadan North", type LGA)
                  ↓ parentTerritoryId
              Territory ("Ibadan", type City)
                  ↓ parentTerritoryId
              Territory ("Oyo State", type State)
```

The two-step "select territory, then select location" UI the brief
describes is purely a presentation-layer concept (filter `Territory` by
`parentTerritoryId`) — there is no schema-level distinction between
"territory" and "location." Sprint 32 does **not** implement Collection
Point assignment; it only ensures a Consumer has a reliable, structured
geographic identity a future sprint can match against.

## 5. Phone Number Identity

**Audit finding**: a reusable, tested, Nigeria-aware phone normalization
utility already exists — `normalizePhoneNumber`
(`apps/api/src/notifications/phone-number-normalizer.ts`, Sprint 29's
WhatsApp delivery work). `ConsumerService` imports and reuses it directly;
no second normalization implementation was written.

- `08012345678`, `2348012345678`, and `+2348012345678` all normalize to the
  identical `+2348012345678`.
- `Consumer.normalizedPhone` is **required** (never null) —
  `registerConsumer()` throws a `400` if the supplied phone cannot be
  normalized at all, extending the utility's own "fail safely rather than
  guess" philosophy from "ineligible for a WhatsApp send" to "cannot become
  a Consumer's identity key." This guarantees the uniqueness constraint
  below is always a real, enforceable guarantee — never silently bypassed
  by a null value.
- `Consumer.phoneNumber` stores the original, as-typed input (support/
  audit-recoverable); `normalizedPhone` is the actual identity key used for
  lookups and the uniqueness constraint.

**Tenant-scoped, not global**: `@@unique([organisationId, normalizedPhone])`
— the same phone number may belong to a different Consumer in a different
organisation; it is never a cross-tenant identity.

## 6. Idempotent Registration & Concurrency

Registration reuses the exact `CandidateRepository.findOrCreate` recipe
(Sprint 30 — check, then create, and on a `P2002` race, re-fetch and return
the winner rather than surfacing the constraint violation) applied to phone
identity instead of email. A repeated or truly concurrent registration
request for the same `[organisationId, normalizedPhone]` converges on
exactly one `Consumer` row — live-verified with 5 simultaneous real HTTP
requests producing exactly one created row and four `alreadyRegistered:
true` responses, all pointing at the same consumer id (§8 below).

## 7. Non-Existent Location — `ConsumerLocationRequest`

A controlled "I can't find my location" signal
(`apps/api/src/d2c/consumer/consumer-location-request.repository.ts`) —
deliberately **not** a mechanism for creating official geography
automatically. `rawLocationText` is captured as non-authoritative context
only (e.g. "somewhere around Challenge"); it is never parsed or matched
against `Territory` names, and no code path in this domain ever writes to
the `Territory` table. An internal user reviews the open worklist
(`GET /d2c/consumers/location-requests`) and, if warranted, creates a real
`Territory` row through the existing, unchanged Territory admin flow —
separately, deliberately, by hand.

## 8. Communication Preferences Foundation

**Audit finding, and why `NotificationPreference` was NOT reused**:
`NotificationPreference.userId`/`Notification.recipientUserId` are both
hard-wired to a real `User.id`. A Consumer structurally never has one (§2),
so it cannot hold a row in that table without violating the Consumer/User
separation this sprint mandates — a genuine architectural reason, not an
oversight, to introduce something new here instead.

Given no second D2C notification type exists yet to distinguish (brief:
"do not build the marketing campaign engine, segmentation, or campaign
management"), the minimum foundation is exactly one field:
`Consumer.marketingOptIn Boolean @default(false)` — the same asymmetric-
default convention `NotificationPreference.emailEnabled`/`whatsappEnabled`
already established ("do not silently enroll into promotional messaging").
A future sprint that introduces real D2C notification categories
(transactional, collection, promotional, ...) should design a proper
Consumer-facing preference structure then, informed by which categories
actually exist — not speculatively now.

## 9. Public vs Internal Consumer Data

`ConsumerController`'s `toConsumerResponse` is a hand-built response shape,
never a raw Prisma entity returned directly. Today every field it returns
is already internal/admin-appropriate, since there is no consumer-facing
channel yet. The documented expectation for whoever builds the future
WhatsApp/consumer-facing response shape: it must expose strictly less (no
internal `id`, no raw `createdById`/`updatedById`, no audit metadata) — it
must **not** reuse `toConsumerResponse` as-is.

## 10. Access Control, Audit, and Security

- **Permissions**: `d2c.consumer.view` / `d2c.consumer.manage`
  (SCOPABLE, catalogue 149 → 151), following the exact
  `sales.customer.view`/`.manage` naming/shape convention. No new
  authorization mechanism, no D2C-specific guard — `PermissionsGuard`/
  `@RequirePermission` reused as-is.
- **HTTP surface is internal/admin only**: `ConsumerController`
  (`/d2c/consumers`) requires `JwtAuthGuard` + the permissions above on
  every route, exactly like `CustomerController`. There is deliberately no
  public, unauthenticated, or "my own" consumer route this sprint (unlike
  Sprint 30's public careers page) — no consumer-facing session mechanism
  exists yet. A future WhatsApp adapter calls `ConsumerService` directly,
  never through this permission-gated surface.
- **Tenant isolation**: every repository method takes `organisationId` and
  includes it in the query; every write is a conditional `updateMany`.
  Live-verified (§8 below): cross-tenant `GET`/`PATCH`/status-action all
  return `404` (no existence leak), cross-tenant search returns an empty
  list, and a cross-tenant `territoryId` on location update is rejected
  as "Territory not found" — the SAME tenant-scoped `TerritoryRepository`
  lookup `Customer`/`Outlet` already use.
- **Audit**: every lifecycle change (`consumer.registered`,
  `.profile_updated`, `.location_updated`, `.activated`/`.suspended`/
  `.deactivated`, `.location_request_created`/`.location_request_resolved`)
  is recorded via the existing `AuditService.record()` — no parallel audit
  table. A repeated idempotent registration attempt does **not** record a
  second `consumer.registered` event — only the actual creation does.

## 11. Deferred Scope

Explicitly not built this sprint (later sprints' responsibility):
WhatsApp API/Meta integration/webhooks/templates, the WhatsApp simulator,
D2C ordering, payment gateway/links, Collection Points and their
assignment, consumer fulfilment, D2C inventory deductions, loyalty
points/rewards, campaigns/promotions/marketing segmentation, demand
intelligence, and the full Sprint 39 D2C Sales Administration dashboard
(this sprint's `/settings/d2c/consumers` page is a lightweight internal
verification view only, not that dashboard).

## 12. Frontend

`/settings/d2c/consumers` (`apps/web/src/app/(app)/settings/d2c/consumers/`)
— a minimal internal admin list/detail/location view, added to the main
sidebar under Workspace. Register dialog, detail dialog (profile, territory
select, status actions, "log location not found"). Built on the existing
`@zentuva/ui` kit and `react-hook-form`/`zodResolver`, mirroring
`retail/customer-dialog.tsx`'s exact pattern — not the eventual Sprint 39
dashboard, not any consumer-facing/WhatsApp UI.

## 13. Testing

`apps/api/src/d2c/consumer/`: `consumer.repository.spec.ts` (idempotent
find-or-create, the real `P2002` race-recovery path exercised with a
genuinely concurrent `Promise.all`, tenant isolation on
create/find/update), `consumer.service.spec.ts` (phone-normalization
equivalence, invalid-phone rejection, invalid-territory rejection, location
clear, status transitions), `d2c-independence.spec.ts` (channel-neutrality
and cross-domain-write structural guards). Full live verification against
the real dev database and real HTTP requests — see
`docs/sprint-32-completion-report.md`.
