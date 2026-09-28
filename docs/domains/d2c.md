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

Sprint 33 builds the next link in that chain: a channel-neutral
**Consumer Conversation Layer** that turns a sequence of inbound
messages/button clicks into registration, location capture, and a main
menu — see §14 onward. WhatsApp itself is still not implemented.

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

---

# Sprint 33 — Consumer Conversation Experience Foundation

## 14. Purpose and Architecture

Sprint 33 sits directly on top of Sprint 32's Consumer/Territory foundation
and builds the piece the brief's own end-to-end diagram places between a
future messaging channel and Zentuva's business services:

```
WhatsApp / Meta  →  WhatsApp Channel Adapter  →  Consumer Conversation Layer  →  D2C Services / Consumer Services  →  Existing Zentuva Domains
   (not built)          (not built)                    (THIS SPRINT)              (Sprint 32, reused unchanged)         (Territory, Audit, ...)
```

**The Conversation Layer is channel-neutral. WhatsApp is an adapter, not
the business logic.** `ConversationService`
(`apps/api/src/d2c/conversation/conversation.service.ts`) has no knowledge
of WhatsApp, Meta's API, webhooks, templates, or media — it exposes one
entry point, `handleInboundMessage(organisationId, input)`, that a future
WhatsApp adapter and the future Sprint 42 consumer-facing simulator are
both expected to call directly. Nothing in this domain imports or
references a WhatsApp SDK, and `conversation-independence.spec.ts` asserts
this structurally (no `WhatsApp*` class/import anywhere in `src/d2c/`).

This sprint does **not** build: real WhatsApp integration of any kind, a
generic workflow/BPMN engine (Zentuva already has one — deliberately not
reused here, since a conversation's state machine is a much smaller,
purpose-built concept), a second Consumer/Territory/phone-normalization
implementation, ordering, or the Sprint 42 simulator.

## 15. Conversation Session

`ConsumerConversation` (`apps/api/prisma/schema.prisma`) is the lightweight
session concept the brief asked for — organisation, an optional
`consumerId` (null until registration completes), `channel` (see §16),
`externalConversationId` (the channel's own identifier for this thread —
a WhatsApp phone number today, deliberately named generically), `state`
(§17), a small untyped `context: Json?` bag for in-flight step data, and
`status` (`ACTIVE`/`ENDED`, `ENDED` reserved/unused this sprint).

**The WhatsApp phone number is deliberately not the primary database
identity.** `ConsumerConversation.id` is its own `cuid()`; identity
resolution is always `[organisationId, channel, externalConversationId]`
(`@@unique` constraint) — the same phone number is a _different_ row in a
different organisation (live-verified, §21), and a future non-phone
channel (e.g. a web widget with a session token as its
`externalConversationId`) fits the same model without a schema change.

## 16. Channel Abstraction — Deliberately Minimal

`enum ConversationChannel { WHATSAPP }` — one value. The brief explicitly
warned against adding a speculative `SIMULATOR` value now; the future
Sprint 42 simulator can call `ConversationService.handleInboundMessage()`
directly with `channel: 'WHATSAPP'` (it is exercising the same channel
contract, not a different one) or introduce its own enum value in that
sprint, informed by what the simulator actually needs then.

## 17. Conversation States — Lightweight Interaction State, Not a Workflow Engine

`enum ConversationState { NEW, REGISTRATION, LOCATION_SELECTION, MAIN_MENU, ACTIVE }`
(`ACTIVE` reserved for the future ordering flow, §20; unused this sprint).
State plus the small `context: Json?` bag (holding only `step`,
`territoryId`, or similar flow-scoped scalars — never a serialized object
graph) is deliberately **not** built on Zentuva's existing
`WorkflowDefinition`/`WorkflowInstance` engine: a workflow instance models
a multi-approver business process with history and eligible-approvers
logic; a conversation's state is a single actor's own in-progress
interaction, advanced by their own next message. Reusing the workflow
engine here would mean modelling "the consumer approves their own step,"
which is not what that engine is for.

## 18. Registration via Conversation — Reusing Sprint 32, Not Duplicating It

`ConversationService` never touches `prisma.consumer` directly — every
mutation goes through the real, unmodified `ConsumerService`
(`registerConsumer`, `updateConsumerLocation`, `reportLocationNotFound`,
`findConsumerByPhone`), and `conversation-independence.spec.ts` asserts
this is the _only_ way this domain's code is allowed to touch Consumer
data. The flow:

1. First contact → `welcomeMessage(organisationName)` (tenant's own
   `Organisation.displayName`/`.name`, fetched via the already-imported
   `OrganisationService` — never hardcoded; see §22 for why this matters).
2. `REGISTER` → `state: REGISTRATION`, asks for a name.
3. Name received → `consumerService.registerConsumer(organisationId,
{ fullName, phoneNumber: externalConversationId })` — idempotent by
   Sprint 32's own `[organisationId, normalizedPhone]` guarantee (§6, §21).
   The Consumer is created at this point (before location is known) so
   that a subsequent "I can't find my location" report always has a real,
   already-existing `consumerId` to attach to — `ConsumerLocationRequest`
   keeps its Sprint-32 schema (`consumerId` required, non-nullable)
   unchanged.
4. Territory/location selection (§19) → `state: MAIN_MENU`, "You're
   registered 🎉 / Consumer ID: {code}".

An already-registered phone (`findConsumerByPhone` match) short-circuits
straight to `MAIN_MENU` with a "Welcome back" message on the very first
inbound message — the welcome/registration prompt is never shown to an
existing consumer.

## 19. Territory Branch-Point Resolution (new pattern this sprint)

**Problem found during live verification, not unit testing**: the real
seeded `Territory` hierarchy is four levels deep (`Oyo State → Ibadan →
{Ibadan North, Ibadan South-West} → {Bodija, Mokola, Challenge}`), but the
brief's UX wants the consumer's _first_ choice to already be a meaningful
one ("Ibadan North" vs "Ibadan South-West"), not the single root
("Oyo State"). A naive `parentTerritoryId: null` query would have shown a
one-item list and stalled the conversation.

**Fix**: `resolveBranchPoint(organisationId, parentId)` — a generic helper
that walks down the self-referential `Territory` tree through any chain of
single-child levels until it reaches a level with zero or two-or-more
children, with no hardcoded depth or level-name assumption:

```
resolveBranchPoint(org, null):
  children = Territory.findMany({ organisationId, parentTerritoryId: null })   // [Oyo State]
  while children.length === 1:
    parent = children[0]
    children = Territory.findMany({ organisationId, parentTerritoryId: parent.id })
  return { settled: last single-child ancestor (or null), children: the real branch options }
```

Applied both when first presenting "select your territory" and again after
a territory is chosen (to auto-descend past any further single-child
prefix before presenting "select your location"). Every territory/location
selection is re-validated server-side against a fresh
`resolveBranchPoint`/membership query at submit time — the client's
claimed selection is never trusted blindly (brief §12): an unknown id is
rejected with a re-prompt, and a location whose real `parentTerritoryId`
does not match the previously-selected territory is rejected the same way
(cross-territory mismatch, live-verified §21) — this is what prevents a
consumer from picking a location that does not belong to their selected
territory, and generalizes to any organisation's differently-shaped
hierarchy without code changes.

`ConsumerLocationRequest` (Sprint 32's "I can't find my location"
mechanism) is reused unchanged from within the conversation: selecting the
always-appended `LOCATION_NOT_FOUND` option asks for free text and calls
`consumerService.reportLocationNotFound` — no approval workflow, no
`Territory` auto-creation, exactly Sprint 32's existing behaviour.

## 20. Main Menu — Available vs. Deferred Capabilities

`MAIN_MENU` presents only what already works: **My Account** (profile
summary), **Update My Location** (re-enters the territory/location flow in
`UPDATE` mode), **Help**. Per the brief, capabilities with no backing
implementation yet are **not shown at all** (no disabled/"coming soon"
buttons) — Order Snacks (Sprint 34), My Points/My Rewards (Sprint 40), My
Collection (Sprint 37), and Promotions (Sprint 41) are absent from the menu
entirely, listed only here and in the completion report as the deferred
roadmap.

`ConversationState.ACTIVE` and a `context.step` of `ORDER_SNACKS` /
`SELECT_PRODUCT` / `SELECT_QUANTITY` / `REVIEW_ORDER` / `CONFIRM_ORDER` are
the documented (not implemented) extension point Sprint 34 is expected to
fill in by adding new `handle*` branches to the existing `dispatch()`
switch — no new session/state infrastructure should be needed.

## 21. Conversation Command/Response Contract

Inbound (`packages/validation/src/d2c.ts`, `conversationInputSchema`, a
discriminated union) and outbound
(`apps/api/src/d2c/conversation/conversation.types.ts`,
`ConversationOutboundResponse`, plain TypeScript types since it is
server-constructed, never client-submitted) are both channel-neutral,
semantic UI instructions — never a WhatsApp payload shape:

```ts
// Inbound
{ type: 'TEXT', text: string }
{ type: 'BUTTON', value: string }
{ type: 'LIST_SELECTION', value: string }

// Outbound
{ conversationId, state, messages: Array<
  | { type: 'TEXT', text }
  | { type: 'BUTTONS', text, options: { value, label }[] }
  | { type: 'LIST', text, options: { value, label }[] }
> }
```

A future WhatsApp adapter's job is purely translation: turn a Meta webhook
payload into one of the three inbound shapes above, call
`ConversationService.handleInboundMessage()`, then render each outbound
`TEXT`/`BUTTONS`/`LIST` message as the equivalent WhatsApp message type
(free text, interactive buttons, an interactive list) — it never needs to
know about `Territory`, `Consumer`, or any state-machine detail.

**Conversation history**: `ConsumerConversationMessage` is a minimal,
append-only, tenant/consumer/conversation-scoped log (`direction`,
`payload`, `createdAt` — no update/delete path) of every inbound and
outbound message, kept for support/debugging and to power the internal
test UI's chat log (§23). It stores exactly the same `ConversationInput`/
`ConversationOutboundMessage` shapes already defined above, nothing extra.

**Idempotency/concurrency**: no new mechanism — `ConversationRepository
.findOrCreate` follows the exact `CandidateRepository`/`ConsumerRepository`
find-then-create-then-recover-from-`P2002` recipe (§6). Live-verified: 5
genuinely concurrent HTTP registration-name submissions against the same
new phone number produced exactly one `Consumer` row.

**Session reset**: sending `MENU` (or `RESET`/`START OVER`) at any state
resets to `MAIN_MENU` (if already registered) or `NEW` (if not), clearing
`context` via `Prisma.JsonNull`. No expiry/timeout logic — a deliberately
simple mechanism per the brief.

**Security — the "safer architecture" choice (brief §22)**: since no real
WhatsApp webhook exists yet to receive an unauthenticated inbound call,
`ConversationController` (`/d2c/conversations`) is entirely
internal/JWT-authenticated, reusing Sprint 32's `d2c.consumer.view`/
`.manage` permissions (driving a conversation is the same administrative
capability as managing a consumer directly — no new
`d2c.conversation.*` permission was introduced). `organisationId` is
always taken from the authenticated caller's JWT, never trusted from the
request body. A future WhatsApp adapter is expected to call
`ConversationService` directly (in-process), not through this HTTP
surface, which exists only for the internal test UI (§23).

**Cross-tenant checks, live-verified**: an unauthenticated request is
rejected `401`; a valid token from a different organisation fetching
another tenant's conversation by id returns `404` (no existence leak);
listing conversations returns only the caller's own tenant's rows; the
_same_ phone number used against two different organisations resolves to
two distinct conversations and (on registration) two distinct consumers,
confirming `externalConversationId` is never treated as globally unique.
A tenant-name bug was found this way during this sprint's own
verification and is recorded next.

## 22. Tenant-Aware Copy (bug found and fixed during live verification)

An early version of `welcomeMessage()` had the organisation's name
("Boby Bites") hardcoded into the greeting string. Live cross-tenant
testing (logging in as a genuinely different organisation) surfaced this
immediately — the wrong tenant's brand was shown in the greeting even
though all _data_ isolation was already correct. This is a reminder that
tenant-isolation verification must include user-visible copy, not only
database rows. Fixed by injecting `OrganisationService` (already exported
by the already-imported `IdentityModule` — no new module dependency) and
threading the real `Organisation.displayName ?? .name` through every
message-building path; covered by a regression test asserting each
organisation's welcome text contains only its own name.

## 23. Internal Test Interface

`/settings/d2c/conversation` (`apps/web/src/app/(app)/settings/d2c/conversation/`)
is a small internal chat-style harness — **not** the future Sprint 42
consumer-facing simulator — added to the sidebar as "Conversation Tester."
It picks a test phone number, sends real `TEXT`/`BUTTON`/`LIST_SELECTION`
input against the real `ConversationController`/`ConversationService`/
`ConsumerService`, and renders the bot's buttons/list options as clickable
elements. Useful for manual verification and for observing the exact
contract a future adapter/simulator would produce and consume; not
intended as, and should not be extended into, the polished consumer-facing
experience Sprint 42 is expected to build separately.

## 24. Access Control, Audit — Sprint 33 Additions

No new permissions: `ConversationController` reuses `d2c.consumer.view`
(list/get) and `d2c.consumer.manage` (send message) exactly as-is. New
audit actions, recorded via the existing `AuditService.record()` (no
parallel audit mechanism): `consumer_conversation.started`,
`.consumer_registered`, `.location_updated`,
`.location_request_created`, `.reset` — mirroring the granularity of
Sprint 32's own Consumer audit actions (§10).

## 25. Deferred Scope (Sprint 33)

Explicitly not built this sprint: real WhatsApp/Meta integration of any
kind (webhooks, templates, media), the Sprint 42 consumer-facing
simulator, ordering (Sprint 34 — `ORDER_SNACKS` state/extension point
documented in §20 but not implemented), My Points/My Rewards (Sprint 40),
My Collection (Sprint 37), Promotions (Sprint 41), outbound/proactive
conversation messages driven by the existing Notification infrastructure
(the extension point is that a future sprint's notification-processing
job would call `ConversationService`/append an outbound
`ConsumerConversationMessage` the same way an inbound reply does — not
built this sprint), and any generic/reusable workflow engine for
conversations (§17).

## 26. Testing (Sprint 33)

`apps/api/src/d2c/conversation/`: `conversation.repository.spec.ts`
(idempotent find-or-create incl. genuine concurrent-race recovery, tenant
isolation on create/find/update, `reset` clearing `context` via
`Prisma.JsonNull`); `conversation.service.spec.ts` (full multi-step
registration flow against a realistic 4-level territory fixture asserting
the exact branch-point-resolved options, existing-consumer recognition,
invalid-territory and cross-territory-mismatch rejection,
location-not-found → registration-still-completes, 5-way concurrent
registration idempotency, `MENU` reset mid-flow, per-tenant welcome-text
isolation, unrecognized-input error handling);
`conversation-independence.spec.ts` (no WhatsApp-specific code, no
cross-domain writes, `ConversationService` never touches Consumer data
except through `ConsumerService`). Full live verification against the
real dev database and real HTTP/browser sessions, including a genuine
second organisation created via `/auth/register` — see
`docs/sprint-33-completion-report.md`.
