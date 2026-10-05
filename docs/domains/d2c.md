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

Sprint 34 builds the ordering link: a consumer can now browse the
catalogue, build a cart, and confirm an order entirely through that same
Conversation Layer, ending in a real, existing `SalesOrder` — never a
parallel D2C order system — with server-authoritative pricing and
idempotent creation. See §27 onward. Payment, fulfilment, and WhatsApp
itself remain not implemented.

This sprint deliberately does **not** implement WhatsApp, payment,
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

---

# Sprint 34 — D2C Consumer Ordering

## 27. D2C Ordering Architecture

The next link in the same chain Sprint 32/33 already established:

```
Conversation Layer (Sprint 33)
        ↓
D2COrderingService  (apps/api/src/d2c/ordering/)
        ↓
SalesOrderService.createForConsumer  (apps/api/src/sales/, EXISTING, extended)
        ↓
SalesOrder + SalesOrderItem  (EXISTING model, Sprint 4.8)
        ↓
Existing Product Catalogue (Sprint 4.1/4.7), reused unchanged for browsing/pricing
```

**D2C is a Sales Order channel, not a different kind of order.** No
`ConsumerOrder`/`D2COrder` model, no second order-numbering system, no
second inventory/reservation mechanism, and no second product catalogue
were created. `D2COrderingService` has no Prisma dependency of its own —
it reads products via the existing `ProductRepository`, validates the
consumer via the existing `ConsumerService`, and creates the order purely
by calling `SalesOrderService.createForConsumer()`, a new entry point on
the _same_ service the existing `POST /api/sales/orders` (B2B) endpoint
has always used — sharing its pricing/totals/order-code-generation
internals, never a parallel implementation of them (verified executably:
`d2c-ordering-independence.spec.ts`).

## 28. Consumer → SalesOrder Relationship

**Audit finding**: `SalesOrder.customerId` was a required, non-nullable FK
to `Customer`. A `Consumer` (Sprint 32) is not a `Customer` — silently
connecting a D2C order to a B2B `Customer` row, or fabricating a
placeholder `Customer` per organisation purely to satisfy the constraint,
would both have quietly converted the Consumer into something it
structurally isn't.

**Decision**: the smallest schema change that preserves the distinction —
`SalesOrder.customerId` and `.salesAgentId` became nullable, and a new
nullable `SalesOrder.consumerId` (FK to `Consumer`, `Restrict`) was added.
`customerId`/`consumerId` are mutually exclusive: a B2B order (the
pre-existing, completely unaffected case) has `customerId` set and
`consumerId` null; a D2C order has `consumerId` set and `customerId` null.
This is enforced by a DB-level `CHECK` constraint (added via raw SQL in
this sprint's migration — Prisma's schema DSL has no multi-column `CHECK`)
in addition to service-level construction. `salesAgentId` is nullable for
the same reason a D2C order has no internal human agent who "took" it —
the same `null`-means-"no human actor" convention `createdById`/
`updatedById` already use throughout this codebase.

**Blast radius, handled explicitly**: three existing B2B-only flows read
`order.customerId` assuming it was always present —
`InvoiceService.create` (invoicing requires `FULFILLED`),
`CustomerReturnService.request` (returns require a prior fulfilment), and
`DispatchService.create` (dispatch requires a `SalesFulfilment`). A D2C
order never reaches any of these states this sprint (no D2C fulfilment
exists yet), so all three are currently unreachable in practice — each got
an explicit guard (`if (!order.customerId) throw ...`) rather than a
silent `null`, documenting the boundary for whichever future sprint wires
up D2C fulfilment/invoicing. The existing Sales Order admin UI (list,
detail dialog) and the Field Sales pages were updated to a null-safe
`getSalesOrderPartyName()` helper that shows the `Consumer`'s name in
place of a `Customer`'s — live-verified: opening a D2C order in the
existing `/settings/sales` list shows "Consumer: {name}" and a `D2C`
source badge, right next to ordinary B2B orders, with zero new screens.

## 29. D2C Order Source / Channel

`enum SalesOrderSource { B2B, D2C }`, `SalesOrder.source @default(B2B)`.
Every pre-existing and future-created-via-`POST /api/sales/orders` order
is `B2B` by default and completely unaffected; `D2COrderingService` is the
only caller that ever passes `D2C`. It never alters core Sales Order
semantics (status lifecycle, totals, fulfilment eligibility) — it exists
purely so `SalesOrder`s originating from the two channels can be told
apart in reporting/admin UI, per this sprint's own live-verified admin
list badge.

## 30. Pricing — Server-Authoritative, Always

**Audit finding**: the Product Catalogue had no pricing field at all —
`docs/domains/catalogue.md` explicitly lists Pricing as out of scope, and
`docs/domains/sales.md` documents that a B2B `SalesOrderItem.unitPrice` is
typed in per-order by the sales agent (no price list, no customer-specific
pricing). This is fine for B2B (a trusted internal, authenticated agent),
but a D2C conversation has no human negotiating a price — there was
genuinely nothing to read from.

**Decision**: the smallest additive field — `Product.sellingPrice Float?`
— nullable, opt-in per product, **not** a pricing engine, price list, or
customer-specific pricing (B2B ordering never reads it; `buildItems()`,
the pre-existing B2B item-builder, is byte-for-byte unchanged). A product
is D2C-orderable iff `status === ACTIVE && type === FINISHED_PRODUCT &&
sellingPrice !== null`. Exposed via the existing
`POST`/`PATCH /api/products` endpoints (one new optional field on each,
`packages/validation/src/catalogue.ts`) and a new optional field on the
existing Product dialog — no second product-management surface.

**The conversation client can never supply a price.** The inbound
conversation contract (`TEXT`/`BUTTON`/`LIST_SELECTION`) has no price
field anywhere; `D2COrderingService`'s cart methods take only
`productId`/`quantity`; `SalesOrderService.createForConsumer()`'s own
input type has no `unitPrice` field either — the price is always the live
`Product.sellingPrice`, read at order-creation time, inside
`buildItemsFromCataloguePricing()` (the D2C counterpart to the existing
`buildItems()`, sharing its FINISHED_PRODUCT/tenant-scope validation).
Live-verified: a confirmation request with extraneous `price`/`total`
fields injected into the HTTP body produced an order priced from the
catalogue, not the injected values (docs/sprint-34-completion-report.md
"Live Verification").

## 31. Idempotency

**The established pattern, reused, not reinvented.** `SalesOrder` gained a
nullable `idempotencyKey` (`@@unique([organisationId, idempotencyKey])`),
the exact shape `SalesFulfilment.idempotencyKey`/`CustomerReturn`'s own
idempotency keys already use, generalised here to order _creation_ itself.
`SalesOrderService.createForConsumer()` follows the Sprint 9→10
idempotency-before-precheck lesson (`CustomerReturnService.request()`'s
own pattern): the `findByIdempotencyKey` lookup happens first, before any
consumer/product/quantity validation, so a genuine retry can never be
rejected by a precheck the original request already satisfied. A true
concurrent race (two callers both miss the lookup) is closed by catching
the unique constraint's `P2002` and re-fetching the winner — the same
recovery recipe `ConsumerRepository`/`ConversationRepository` (Sprints
30/32/33) already established.

The Conversation Layer mints the key exactly once, the moment the
consumer reaches order review (`CHECKOUT` → `AWAITING_CONFIRM`), and
persists it into `context.checkoutIdempotencyKey` — every subsequent
`CONFIRM_ORDER`, including genuinely concurrent duplicates arriving before
the first one's state transition commits, reads the SAME persisted key.
Live-verified with 5 truly concurrent `CONFIRM_ORDER` HTTP requests
against the running dev server producing exactly one `SalesOrder`.

## 32. Order Status — DRAFT, Not a New State

A D2C order is created `DRAFT`, the existing default every Sales Order
already starts at — no new status (`AWAITING_PAYMENT`, etc.) was added to
`SalesOrderStatus`. "Awaiting Payment" is purely display wording the
Conversation Layer applies when formatting the confirmation message
(`formatOrderStatusForConsumer()` in `conversation.service.ts`) — the real
persisted status stays `DRAFT`, exactly like every other domain object in
this codebase (`SalesOrder.status`, `Product.status`, ...) versus its
display label. Sprint 35 is expected to introduce real payment states;
this mapping function is the one place that will need to grow, never the
business logic layer underneath it.

## 33. Order Confirmation Flow (Conversation State)

Reuses the reserved `ConversationState.ACTIVE` value (documented as an
extension point since Sprint 33) — no new conversation state enum value
was needed. All flow-scoped working data (`cart: {productId,quantity}[]`,
`pendingProductId`, `checkoutIdempotencyKey`) lives in the same untyped
`context: Json?` bag every other conversation state already uses; no cart
table, no persistent shopping-cart infrastructure (brief §4) — a "cart" is
never more than an array sitting inside one `ConsumerConversation` row.

```
MAIN_MENU --[ORDER_SNACKS]--> ACTIVE/BROWSING
  --[select SKU]--> ACTIVE/AWAITING_QUANTITY
  --[quantity]--> ACTIVE/CART_MENU  (shows running cart + Add More/Review/Remove)
  --[CHECKOUT]--> ACTIVE/AWAITING_CONFIRM  (mints idempotency key, shows order summary)
  --[CONFIRM_ORDER]--> MAIN_MENU  (SalesOrder created, confirmation shown)
```

`EDIT_ORDER` returns to `CART_MENU`; `CANCEL_ORDER` clears the cart and
returns to `MAIN_MENU` without creating anything; `REMOVE_ITEM` presents
the current cart as a list and removes the chosen line. `MENU`/reset works
from any of these states exactly as it already did before this sprint
(brief §20 — unchanged).

**Bug found and fixed during live verification**: when a tenant's D2C
catalogue is empty, the original implementation displayed the main-menu
buttons while leaving the conversation's own persisted state in
`BROWSING` — clicking one of those buttons was then misrouted into the
product-selection handler as if it were a SKU id (a real consumer would
have seen "How many would you like?" after clicking "My Account"). Fixed
by genuinely transitioning to `MAIN_MENU` in that branch; covered by a new
regression test and re-verified live against a real second, catalogue-less
tenant.

## 34. Main Menu — Order Snacks

"Order Snacks" is the one new "available now" main-menu option (brief
§11) — deliberately generic wording, never a tenant's own brand name in
the button label (the same lesson Sprint 33's own tenant-name bug taught).
My Points/My Rewards (Sprint 40), My Collection (Sprint 37), and
Promotions (Sprint 41) remain absent entirely — never shown as disabled
stubs.

## 35. Order Lookup

Satisfied at the minimum the brief asks for (§12): the `CONFIRM_ORDER`
response itself already includes the order reference, date, items,
quantities, total, currency, and status — no separate "view my orders"
command or endpoint was built. `D2COrderingService.getConsumerOrder()`
exists as a proper, ownership-enforced lookup (used internally to format
that response, and available for a future "view order" command) — a
Consumer may only ever retrieve their OWN order; a mismatched
`consumerId` and a genuinely nonexistent order both return the identical
404, never distinguishing which case occurred.

## 36. Security, Idempotency, and Concurrency — Live-Verified

- Unauthenticated `POST /d2c/conversations/messages` → `401` (unchanged
  from Sprint 33 — the ordering flow rides the same internal,
  JWT-authenticated surface, no new controller/route was added).
- Tenant isolation: a second, genuinely separate organisation (created via
  a real `/auth/register` call, exactly Sprint 33's own precedent) sees
  only its own D2C-orderable products; submitting the FIRST tenant's own
  product id as a SKU selection under the second tenant is rejected with
  the brief's exact wording ("That product is no longer available...").
- Price/total tampering: an HTTP body with extraneous `price`/`total`
  fields injected alongside `CONFIRM_ORDER` produced an order priced
  entirely from the live catalogue — those fields have no schema slot to
  land in and are silently dropped by Zod validation.
- Idempotency/concurrency: 5 genuinely concurrent `CONFIRM_ORDER` requests
  against the same in-flight checkout produced exactly one `SalesOrder`.
- Consumer ownership: enforced at `D2COrderingService.getConsumerOrder()`
  (unit-tested — no HTTP route exists to exercise it live this sprint,
  since no "view past orders" command was built, per §35).

## 37. Inventory — Deliberately Untouched

Creating or confirming a D2C order never deducts, reserves, or otherwise
touches `InventoryStock`/`InventoryTransaction` — `D2COrderingService`
and `SalesOrderService.createForConsumer()` both have zero Inventory
imports, the same "a Sales Order is a record of demand" invariant
Sprint 4.8 already established for B2B orders (verified structurally by
the existing `direct-sales-independence.spec.ts` guard, unchanged). Stock
availability is not yet shown during D2C browsing (Sprint 4.8's own B2B
UI shows it only as a live informational read, never a gate) — a
documented, deliberately deferred piece of "availability" for whichever
sprint wires up D2C fulfilment.

## 38. Deferred Scope (Sprint 34)

Explicitly not built this sprint: payment of any kind (Sprint 35), D2C
fulfilment/Collection Point (later sprint — `InvoiceService`/
`DispatchService`/`CustomerReturnService`'s new guards document exactly
where that future work plugs in), inventory deduction/reservation for D2C
orders, loyalty/rewards, marketing/promotions, a "view my past orders"
conversation command, a dedicated D2C order-management admin screen
(Sprint 39 — the existing Sales Order list/detail already shows D2C orders
today), and the Sprint 42 consumer-facing simulator.

## 39. Testing (Sprint 34)

`apps/api/src/sales/sales-order.service.spec.ts`: `createForConsumer`
(live-catalogue pricing never client-supplied, rejects an unpriced/
non-finished/cross-tenant/invalid-quantity SKU, idempotency-before-
precheck, P2002-race recovery). `apps/api/src/catalogue/product/
product.service.spec.ts`: `sellingPrice` create/update/clear pass-through.
`apps/api/src/d2c/ordering/`: `d2c-ordering.service.spec.ts` (product
browsing filters — inactive/unpriced/wrong-type/cross-tenant all
excluded; cart add/update/remove/merge; live-price cart summary with
unavailable-item dropping; ownership-enforced order lookup);
`d2c-ordering-independence.spec.ts` (no direct Product/SalesOrder/
Consumer table writes, no WhatsApp code, no forbidden cross-domain
imports, no persistent cart infrastructure). `apps/api/src/d2c/
conversation/conversation.service.spec.ts`: a full new "Order Snacks
flow" suite — browse → select → quantity → checkout → confirm → real
`SalesOrder` created; invalid quantity/product rejection; multi-item
orders (one `SalesOrder`, multiple `SalesOrderItem`s, merged quantities
for a repeated SKU); a product becoming unavailable between add-to-cart
and checkout; idempotent replay and 5-way genuine concurrency producing
exactly one order; cross-tenant SKU rejection; the empty-catalogue
state-transition regression found live. Full live verification against
the real dev database, real HTTP requests, and a real second organisation
— see `docs/sprint-34-completion-report.md`.

---

# Sprint 35 — OPay D2C Payment Integration

## 40. Payment Architecture

The next link in the same chain, closing the loop Sprint 34 deliberately
left open ("Awaiting Payment" was display wording only, §32):

```
Conversation Layer (Sprint 33/34)
        v
D2CPaymentService  (apps/api/src/d2c/payment/, new)
        v
PaymentService.createPendingForConsumer / applyProviderCallback
  (EXISTING Finance service, extended)         SalesOrderService.confirm
        v                                        (EXISTING, widened)
Payment  (EXISTING model, extended)            SalesOrder DRAFT -> CONFIRMED
        ^
        | PaymentProvider port (apps/api/src/payments/ports/)
        v
OpayPaymentProvider  (apps/api/src/payments/infrastructure/, new)
        v
OPay Cashier API (sandbox)
```

`D2CPaymentService` is the "Zentuva Payment Application" the brief asked
for — it never talks to OPay's wire format directly (that lives entirely
behind the `PaymentProvider` port, mirroring the `EmailProvider`/
`WhatsAppProvider` pattern from Sprints 28/29), and it never creates a
`Payment` or mutates a `SalesOrder` itself — every mutation goes through
`PaymentService`/`SalesOrderService`, verified structurally by
`d2c-payment-independence.spec.ts`. A new top-level `payments/` module
(distinct from both `finance/` and `d2c/`) holds only provider-agnostic
plumbing: the `PaymentProvider` port, `OpayPaymentProvider`, and the
public webhook/status controller — justified because "gateway callback"
is neither purely a Finance concern nor purely a D2C concern.

## 41. Payment Model — Reused, Not Duplicated

**Audit finding**: a D2C payment has no existing home. `Payment.customerId`
was a required FK to `Customer`, and a `Consumer` (Sprint 32) structurally
is not one. Applying the exact `SalesOrder.customerId`/`.consumerId`
pattern Sprint 34 already proved, `Payment.customerId` became nullable and
a new nullable `Payment.consumerId` was added, mutually exclusive via a
hand-added DB `CHECK` constraint (`payments_customer_xor_consumer_check`
— Prisma's schema DSL cannot express a multi-column `CHECK`, so this was
added directly to the generated migration SQL, the same technique Sprint
34's own migration used). `Payment` also gained `salesOrderId` (nullable
FK), `provider`/`providerReference`/`merchantReference`/`checkoutUrl`, a
new `PaymentMethod.ONLINE`, and three new `PaymentStatus` values —
`PENDING`, `FAILED`, `CLOSED` — purely additive alongside the untouched
`RECORDED`/`VOIDED` a B2B cash/bank-transfer payment already uses.
`PaymentRepository.create()`/`.void()` (the existing B2B path) are
byte-for-byte unchanged; four new methods
(`createPendingForConsumer`/`findByMerchantReference`/
`attachProviderDetails`/`applyProviderCallback`) were added alongside
them, reusing the exact find-then-create-then-recover-from-`P2002` recipe
(creation) and a conditional `updateMany` scoped to `status: PENDING`
(callback application) — the same two idempotency primitives every prior
sprint in this codebase already established, never a third one invented.

## 42. Payment Reference Design

`merchantReference = "PAY-" + SalesOrder.orderCode`. Because `orderCode`
is already globally unique (Sprint 4.8), `merchantReference` is
automatically globally unique too — `Payment.merchantReference` carries a
GLOBAL `@@unique`, deliberately not organisation-scoped. This solves, by
construction, the one real cross-tenant ambiguity a payment gateway
callback creates that a normal authenticated request never does: OPay's
webhook carries only a reference and a provider-generated order number,
no tenant hint at all. Looking a global reference up directly is safe —
no tenant-guessing logic was needed anywhere. The reference is also
deterministic and stable: repeating "Pay Now" on the same order, or OPay
retrying a webhook, always resolves to the same row, never mints a second
one.

## 43. Money — One Conversion Boundary

Zentuva stores every currency amount as a `Float` in MAJOR units (naira)
across every domain; OPay's `amount.total` expects an integer in MINOR
units (kobo). `toMinorUnits`/`fromMinorUnits` are the ONE place this
conversion happens, living only inside `OpayPaymentProvider` — Finance,
`D2CPaymentService`, and the Conversation Layer all continue to work in
naira throughout. Both directions use `Math.round()` to guard against
floating-point drift (`19.99 * 100 = 1998.9999999999998` rounds to
`1999`), matching the codebase's existing `roundCurrency` convention;
covered by parametrized tests for ₦100, ₦1,000, ₦10,000, and non-whole
amounts.

**Live-verified**: the real OPay sandbox Cashier UI rendered the exact
server-computed amount back (`₦1500.00` for a 1-item order, `₦3000.00`
for a 2-item order), confirming the conversion is correct in both
directions, not just in unit tests.

## 44. Currency

`Organisation.currency` (free-text, Sprint 1B.1) is read live at payment
time — `D2CPaymentService` never hardcodes `'NGN'` in the domain layer.
`OpayPaymentProvider.createPayment()` rejects any non-`NGN` currency
before ever calling OPay (this integration's only configured OPay route
settles in NGN), reported back as a safe `REJECTED` outcome rather than a
raw provider error. Live-verified: the seed organisation defaults to
`USD` (`Organisation.currency @default("USD")`, Sprint 1B.1) — the
Conversation Layer's product listing correctly showed `USD` pricing
until the organisation's currency was changed to `NGN` via the existing
`PATCH /api/organisation/me`, after which both the cart summary and the
real OPay Cashier UI immediately reflected `NGN` with no code change.

## 45. Payment State Mapping

OPay's documented Cashier statuses map onto the EXISTING `PaymentStatus`
enum — no duplicate status system:

| OPay status         | `ProviderCallbackStatus` (neutral) | `PaymentStatus`                                      | `D2CPaymentResult.status` |
| ------------------- | ---------------------------------- | ---------------------------------------------------- | ------------------------- |
| `INITIAL`/`PENDING` | `PENDING`                          | _(no transition yet)_                                | `PENDING`                 |
| `SUCCESS`           | `SUCCESS`                          | `RECORDED`                                           | `SUCCESS`                 |
| `FAIL`              | `FAILED`                           | `FAILED`                                             | `FAILED`                  |
| `CLOSE`             | `CLOSED`                           | `CLOSED`                                             | `CLOSED`                  |
| _(anything else)_   | `UNKNOWN`                          | _(no transition — logged, never silently `SUCCESS`)_ | `PENDING`                 |

`SUCCESS` maps onto the pre-existing `RECORDED` — an OPay-confirmed
payment IS, from that moment, an ordinary recorded receipt, the same
meaning `RECORDED` already carries for a manually-entered B2B cash/bank
payment. Two mapping functions (`toPaymentStatus`/`toD2CStatus`) are the
ONE place this table lives; nothing else in the codebase branches on an
OPay string.

## 46. Provider Abstraction

`PaymentProvider` (port) + `PAYMENT_PROVIDER` (DI token) +
`OpayPaymentProvider` (concrete) — the exact shape `EmailProvider`/
`WhatsAppProvider` already established (Sprints 28/29). Construction-time
configuration validation: `OpayConfigurationError` is thrown in the
constructor (not at request time) if `OPAY_MERCHANT_ID`/`OPAY_PUBLIC_KEY`/
`OPAY_SECRET_KEY` are missing, so a misconfigured deployment fails loudly
at boot — deliberately no "local/safe" fallback mode like WhatsApp's
`LocalWhatsAppProvider`, since real sandbox credentials are already
configured and this sprint has exactly one implementation. Uses Node's
built-in `fetch`, no OPay SDK, no HTTP client dependency.

**Documented ambiguity, resolved and live-verified**: OPay's own
documentation discusses request signing generally, but its concrete
Cashier-create example shows only `Authorization: Bearer {PublicKey}` +
`MerchantId: {MerchantId}` headers — no per-request `Signature` on
CREATE. This implementation follows that concrete example. Live-verified
repeatedly against the real sandbox: every create-payment call returned a
real, valid `cashierUrl` (`sandboxcashier.opaycheckout.com`), confirming
this header shape is correct for the CREATE endpoint.

## 47. Webhook Security

`POST /api/payments/opay/webhook` (`PaymentWebhookController`,
`apps/api/src/payments/`) — deliberately public/unauthenticated (OPay has
no Zentuva session to present), the same "public but gated only by
possession of an opaque value" shape `CareersController` already
established (Sprint 30). `main.ts` enables `rawBody: true` so signature
verification runs against the exact bytes received, not a re-serialized
JS object. `ThrottlerGuard` (`@nestjs/throttler`, already globally
registered by `RecruitmentModule` — not re-registered here) rate-limits
both routes.

`OpayPaymentProvider.verifyCallback()` — never bypassable, always runs
before any business logic sees the callback:

1. Parse `{ payload, sha512 }` from the raw body; malformed JSON or a
   missing `payload`/`sha512` is rejected outright.
2. Recompute `HMAC-SHA512(secretKey, JSON.stringify(payload))` and
   compare against `sha512` via `crypto.timingSafeEqual` (constant-time —
   never a plain `===`, which would leak timing information about how
   many leading bytes matched).
3. Validate `reference`/`orderNo`/`amount.total`/`amount.currency` are
   all present.
4. Map the OPay status string through §45's table, defaulting anything
   unrecognized to `UNKNOWN` — never silently `SUCCESS`.

The controller (`PaymentWebhookController.webhook()`) throws a generic
`BadRequestException('Invalid callback')` on any failure — the real
reason (bad signature vs. malformed body vs. missing fields) is logged
server-side but never returned to the caller, live-verified: a
deliberately wrong `sha512` produced exactly `400 {"error":"Bad
Request","message":"Invalid callback"}`, nothing more specific.

`D2CPaymentService.handleProviderCallback()` runs the remaining
business-level checks, each failing CLOSED (silently, safely, never
throwing past the controller — the endpoint OPay retries against must
never 500 on a callback it doesn't like):

- **Unknown reference** — no matching `Payment`; logged, ignored.
- **Amount mismatch** — `roundCurrency(payment.amount) !==
roundCurrency(cb.amount)`; recorded as an auditable
  `d2c_payment.callback_amount_mismatch` action rather than silently
  dropped, live-verified: a callback carrying the correct reference but a
  tampered amount left the payment `PENDING`, unchanged.
- **Currency mismatch** — logged, ignored.
- **`PENDING`/`UNKNOWN` status** — no-op; a payment is never marked
  resolved from an ambiguous or unrecognized status.
- **Idempotency** — `PaymentService.applyProviderCallback()`'s
  conditional `updateMany` (`WHERE status = 'PENDING'`) makes a callback
  arriving after the payment already resolved match zero rows, a safe
  no-op. Live-verified: the identical signed callback replayed 6 times
  (once sequentially, then 5 truly concurrent `Promise.all` requests)
  against an already-`SUCCESS` payment left `SalesOrderService.confirm()`
  invoked exactly once — no duplicate confirmation, no error.

**Live sandbox verification, honestly reported**: this sprint's create-
payment flow was exercised repeatedly against the real OPay sandbox (real
`cashierUrl`s returned and opened in a real browser, a real BankCard PIN
attempt, a real OPayWallet checkout reaching OPay's own `PENDING`/
`POLLING` state). OPay's own documentation describes its sandbox test
wallet numbers (`01066668888`/`01077779999`) as producing "automatic
callbacks after one minute" — this was attempted twice, waiting several
minutes each time, and OPay's sandbox never delivered an asynchronous
webhook to a real, verified-reachable public tunnel in either attempt.
Rather than block completion on an external sandbox timing dependency
outside this codebase's control, the webhook handler's own correctness
(signature verification using the real production secret key, payload
parsing, the full state-mapping/idempotency/amount-mismatch/duplicate-
callback logic above, and the `SalesOrder` confirmation) was instead
verified live by constructing a correctly HMAC-signed callback with the
real secret key and posting it directly to the running webhook endpoint —
full detail in `docs/sprint-35-completion-report.md` "Live Sandbox
Verification," reported honestly as a self-constructed callback, never
claimed as an OPay-originated one.

## 48. Finance Integration — A Deliberate Boundary

**Audit finding**: a D2C `SalesOrder` is never invoiced (Sprint 34's own
documented limitation, §38) — there is no existing invoice-settlement,
AR-reduction, or GL-journal-posting trigger that genuinely applies to an
uninvoiced order. Rather than fabricate a placeholder `Invoice` or
hand-roll a journal entry purely to force-fit into existing accounting
machinery, this sprint deliberately stops at: a verified successful OPay
payment creates a `Payment` row (via the existing `PaymentService`, method
`ONLINE`, status transitioning `PENDING -> RECORDED`) and calls the
existing `SalesOrderService.confirm()` — the SAME `DRAFT -> CONFIRMED`
transition Sprint 34 already established, widened only to accept
`actorUserId: string | null` for this sprint's system-triggered (no human
approver) case. No new `SalesOrderStatus`, no manual journal entry inside
`OpayPaymentProvider` or `D2CPaymentService`. Whichever future sprint
wires up D2C fulfilment/invoicing inherits a `Payment` row already linked
to the `SalesOrder` via `Payment.salesOrderId`.

## 49. Conversation Layer Extension

A new channel-neutral `PaymentRequiredMessage` type was added to
`ConversationOutboundMessage`
(`{ type: 'PAYMENT_REQUIRED', text, orderReference, paymentReference,
amount, currency, checkoutUrl }`) — `ConversationService` gained zero
OPay-specific knowledge; it only ever sees this neutral shape, the exact
same discipline `TEXT`/`BUTTONS`/`LIST` already followed. The reserved
`ACTIVE` conversation state gained one more step:

```
... --[CONFIRM_ORDER]--> ACTIVE/AWAITING_PAYMENT  (SalesOrder created DRAFT, "Pay Now" shown)
  --[PAY_NOW]--> real OPay cashierUrl returned as PAYMENT_REQUIRED
  --[PAY_NOW again]--> idempotently reuses the SAME pending payment/checkoutUrl
```

`handleAwaitingPayment()` calls `D2CPaymentService.initiatePayment()`
identically for both the first "Pay Now" click and any later "I've
Paid — Check Status" click — its own idempotency already returns the
correct current state (`PENDING` + `checkoutUrl`, `SUCCESS`, `FAILED`, or
`CLOSED`) without a second query method. A `PaymentProviderError` is
caught and shown as a short, generic consumer-facing message — never an
OPay error code.

## 50. Return URL

`GET /payment/:reference` (`apps/web/src/app/payment/[reference]/`) is
where OPay's `returnUrl`/`cancelUrl` both point — deliberately NOT proof
of payment on its own. Arriving at this page means only that the
consumer left the OPay Cashier; every render re-queries the real,
verified Zentuva state via the public
`GET /api/payments/opay/:reference/status` (gated only by the unguessable
reference, no session — a Consumer has none to present, the same
"public but only reachable via an opaque id" shape as the public careers
page), polling every 4 seconds while `PENDING`. **A real bug was found
and fixed during this sprint's own live browser verification**: the page
was written against Next.js 15's `use(params)` convention for unwrapping
an async `params` prop, but this codebase runs Next.js 14.2.16, where a
client component's `params` is a plain synchronous object — passing it to
React's `use()` threw `"An unsupported type was passed to use()"` on
every single render, a page that would have been 100% broken in
production. Fixed to the same plain-object `params` convention every
other dynamic route page in this codebase already uses (e.g.
`/settings/finance/reconciliation/[id]`); re-verified live afterward
showing correct `SUCCESS`/`PENDING` states for real orders.

## 51. Scope — Explicitly Not Built This Sprint

Sandbox/test mode only — no production OPay credentials or endpoint were
used or are configured for use. No payout/RSA (recipient/settlement
account) functionality, no Collection Point or fulfilment integration, no
inventory deduction, no loyalty/rewards, and no marketing/promotions tie-
in — this sprint closes the payment gap Sprint 34 left open and nothing
more. A genuine retry flow for a `FAILED`/`CLOSED` payment (minting a
fresh attempt against the same order) is deferred; today the Conversation
Layer reports the terminal state and directs the consumer to support.

## 52. Testing (Sprint 35)

`apps/api/src/payments/infrastructure/opay-payment-provider.spec.ts`:
construction/config-error tests; `toMinorUnits`/`fromMinorUnits`
parametrized for ₦100/₦1,000/₦10,000/₦99.99/₦0.10/₦19.99 (floating-point
drift guard); `createPayment` (success, non-NGN rejection, all 7 OPay
error codes, malformed response, network failure); `verifyCallback`
(valid signature and the full status table, unknown status, wrong key,
tampered payload, malformed JSON, missing fields).
`apps/api/src/payments/payment-webhook.controller.spec.ts`: invalid
signature rejected at the transport layer before `D2CPaymentService` ever
sees it; valid callback passed through and acknowledged; the real
rejection reason never leaked to the HTTP caller.
`apps/api/src/d2c/payment/d2c-payment.service.spec.ts`: idempotent
payment creation/reuse; ownership and non-payable rejection;
server-authoritative amount/currency/reference (never client-supplied);
OPay duplicate-reference recovery; every callback-validation branch from
§47; 5-way concurrent duplicate-callback idempotency; tenant isolation
via the globally-unique reference.
`apps/api/src/d2c/payment/d2c-payment-independence.spec.ts`: no direct
`Payment`/`SalesOrder`/`JournalEntry` writes, no OPay wire-format leakage
outside `payments/infrastructure/`, no forbidden cross-domain imports, no
secret/public key reference anywhere in the `d2c/payment/` files, exact
`D2CPaymentModule` import set. `finance/payment.repository.spec.ts`
gained an 18-test block covering the four new repository methods.
`d2c/conversation/conversation.service.spec.ts` was extended with a real
wired `PaymentService`/`D2CPaymentService` (not mocked) covering the full
`CONFIRM_ORDER -> AWAITING_PAYMENT -> PAY_NOW -> PAYMENT_REQUIRED` path.
227 suites / 2017 tests passing (up from Sprint 34's 223/1950 baseline,
zero regressions). Full live verification against the real dev database,
real OPay sandbox HTTP calls, a real browser session, and a genuinely
second organisation — see `docs/sprint-35-completion-report.md`.

---

# Sprint 36 — Existing Outlet -> Collection Point Enablement

## 53. Collection Point — A Capability of Outlet, Never a Parallel Entity

**The central architectural decision, made explicit**: `new CollectionPoint
entity = NO`. A Collection Point is a CAPABILITY an existing `Outlet` may
optionally carry — three additive columns directly on `Outlet` (Pattern
A, per the brief's own "prefer the smallest schema change" guidance), not
a new model, table, or `/api/collection-points` resource:

```
Outlet
  |-- normal B2B outlet (unaffected, Sprint 4.8)
  |
  `-- Collection Point capability (Sprint 36, additive)
        collectionPointStatus             CollectionPointStatus @default(DISABLED)
        collectionPointResponsibleUserId  String?  (plain id, no FK — see §55)
        collectionPointOperatingHours     String?  (free text — see §56)
```

Pattern B (a separate one-to-one configuration model) was considered and
rejected: three columns is not "substantial enough" configuration to
justify a second table per the brief's own guiding principle ("do not
introduce a new entity simply to give an existing entity additional
capability"). Territory and contact information are REUSED from the
existing `Outlet` fields, not duplicated (§56) — the actual Collection
Point-specific surface is genuinely small.

## 54. Audit Findings (Pre-Implementation)

Before writing any code, the existing Outlet/Distribution/Territory/
Employee/Inventory/Sales Order/Access Control/Audit architecture was
read end-to-end. What was found and reused, verbatim, with no new
mechanism invented:

- **Outlet** (`apps/api/src/retail/outlet/`, Sprint 4.8): `OutletStatus`
  is a two-value enum (`ACTIVE`/`INACTIVE`) — `CollectionPointStatus`
  mirrors that exact shape. `OutletService.activate()`/`.deactivate()`
  use dedicated named methods calling a private `setStatus()` helper,
  never a generic "set arbitrary status" entry point —
  `enableCollectionPoint()`/`disableCollectionPoint()` follow the
  identical shape. `OutletRepository.update()` is a conditional
  `updateMany` scoped to `{ id, organisationId }` — the same primitive
  every Collection Point mutation reuses, giving concurrent mutations a
  deterministic final state by construction (Postgres serializes
  concurrent `UPDATE`s to one row — there is no new-row race here the way
  there is for `Payment`/`SalesOrder` creation).
- **Permissions**: `OutletController` has no permission key of its own —
  every route reuses `sales.customer.view`/`sales.customer.manage`
  (`permission-catalogue.ts`'s own comment: "customers/outlets reuse
  Sales' existing `sales.customer.*` permissions"). Collection Point
  routes follow the identical reuse, adding zero new catalogue entries
  (§57).
- **Distribution Network**: `DistributionNetworkRelationship` links
  `Customer` to `Customer`, never `Outlet` to `Outlet`, and `SalesOrder`
  has no FK to it at all — confirmed there is no outlet-level network
  role to interact with or preserve.
- **Territory**: `Outlet.territoryId` already exists (optional FK to the
  existing `Territory` hierarchy, Sprint 4.8) — reused as-is (§58), no
  second territory relationship added.
- **Employee/Sales/Field**: no existing "responsible person"/"assigned
  rep" field exists anywhere on `Outlet` or `Customer`. Two conventions
  exist elsewhere for this concept: a plain, unenforced id (no Prisma FK)
  — `SalesOrder.salesAgentId`, `WorkOrder.assignedToId`,
  `Asset.custodianId` — versus a real FK relation to `Employee` — HR's
  `Department.departmentHeadEmployeeId`. Since Collection Point is a
  Sales/Retail record, not an HR org-chart one, the plain-id convention
  was followed (§55).
- **Inventory**: `InventoryStock`/`InventoryTransaction` are keyed by
  `(organisationId, productId, locationId)` against a real
  `InventoryLocation` model (Sprint 4.5) — but `InventoryLocation` has NO
  link to `Outlet` anywhere, and `Outlet` has none back. This gap is
  documented, not bridged, this sprint (§59).
- **Sales Order**: `SalesOrderSource.D2C`/`Consumer` relationship
  (Sprint 34) and OPay payment (Sprint 35) are both already complete and
  untouched by this sprint — Collection Point is the next link, not a
  change to either.
- **Access Control**: `AccessScope`/`EffectiveAccessResolver` reused
  unchanged; no new scope type was needed.
- **Audit**: `AuditService.record()` reused unchanged, three new action
  strings added to the existing `OUTLET_AUDIT_ACTIONS` map (§60).
- **Notifications**: audited — no Collection Point notification of any
  kind was built this sprint (out of scope, §62).

## 55. Responsible Representative

`Outlet.collectionPointResponsibleUserId` — an optional plain id
referencing an existing `User` (never a new `CollectionPointAgent`
entity), following the exact `SalesOrder.salesAgentId` convention rather
than a real Prisma FK relation. Validated in `OutletService` — never
trusted from the client:

1. `UserService.getById(organisationId, userId)` — a tenant-scoped
   lookup; a cross-tenant or nonexistent id returns `null`, rejected with
   a `400` (never revealing whether the id exists in another tenant).
2. `user.status === 'ACTIVE'` — the same convention
   `WorkflowEligibilityService` already uses to exclude a locked/
   suspended/deactivated user from eligibility.

No separate "Sales Rep" role or table exists — any active organisation
member can be assigned, the exact same "no separate Technician role"
precedent `MaintenanceOverviewController.listTechnicians()` already
established (itself modeled on `AssetController.listCustodians()`,
Sprint 20). The admin picker (`GET /api/retail/outlets/representatives`)
mirrors that endpoint's shape precisely: reuses `sales.customer.view`
(already required for the whole Outlet surface) rather than the heavier
`identity.users.read`, returns only `{id, firstName, lastName}` for
`ACTIVE` users.

## 56. Configuration — Reused, Not Duplicated

**Contact**: no separate "collection contact" fields were added — the
brief's own instruction ("prefer existing Outlet contact information...
do not duplicate data unnecessarily") is satisfied by simply reusing the
outlet's existing `contactPersonName`/`phoneNumber` directly. There is
nothing to keep in sync because there is nothing duplicated.

**Territory**: `Outlet.territoryId` (existing, Sprint 4.8) IS the
Collection Point's geographic context — no second territory relationship
was introduced, satisfying the brief's explicit instruction.

**Operating hours**: `collectionPointOperatingHours String?` — free text
(e.g. "Mon-Sat 9am-6pm"), the same "plain text now, structure later if
ever genuinely needed" convention `Outlet.address` already uses.
Deliberately not a scheduling engine.

**Capacity and eligible products — deliberately deferred.** Neither has
a concrete Sprint 37 requirement to design against yet (the brief
explicitly permits deferring both in that case). Introducing either now
would mean guessing at a shape ("number of orders? units? storage
capacity?" for capacity; a new join table or reused SKU reference for
product eligibility) with no real consumer to validate the guess against
— exactly the kind of premature design the brief warns against. Deferred
to whichever future sprint has an actual fulfilment requirement to build
against.

## 57. Authorization

No new permission catalogue entries. Every Collection Point route reuses
`sales.customer.view` (read: list/get representatives) or
`sales.customer.manage` (write: enable/disable/configure) — the exact
same two permissions the pre-existing Outlet routes already require,
since enabling/configuring a Collection Point is the same administrative
capability as editing the outlet itself. Live-verified: an unauthenticated
request → `401`; an authenticated user lacking `sales.customer.manage`
(this tenant's seeded Member role) → `403 Missing required permission:
sales.customer.manage` on every mutation, and `403` on the same
permission's own `view` route too — confirmed as pre-existing behavior
identical to plain `GET /api/retail/outlets`, not something this sprint
changed.

## 58. Eligibility Rules — The Actual Rules Implemented

Enforced in `OutletService.enableCollectionPoint()`, nothing beyond what
the existing architecture already supports:

1. **Tenant** — the outlet must belong to the caller's own organisation
   (the same tenant-scoped lookup every domain in this codebase uses; a
   cross-tenant id is indistinguishable from a nonexistent one).
2. **`Outlet.status === ACTIVE`** — an `INACTIVE` outlet cannot be
   enabled. Live-verified: `400 Outlet must be active to enable
Collection Point`.
3. **`Outlet.territoryId` is set** — a Collection Point's geographic
   context is the outlet's own territory; with none set, a future
   consumer-discovery query would have nothing to match against.
   Live-verified: `400 Outlet must have a territory assigned to enable
Collection Point`.

No restriction on `outletType` was added — the existing docs explicitly
document `OutletType` as "deliberately extensible — no business logic
anywhere is keyed on a specific value," and the brief warns against
inventing restrictions the architecture doesn't already support.

## 59. Inventory Boundary — Documented, Not Bridged

**The question Sprint 37 will need answered**: when a paid D2C order is
fulfilled from a Collection Point, what existing inventory location/stock
row does it deduct from?

**The audited answer**: `InventoryStock`/`InventoryTransaction`
(Sprint 4.5) are already keyed by `(organisationId, productId,
locationId)` against a real `InventoryLocation` model — not a flat,
location-less per-tenant pool. `SalesFulfilment.locationId` (the existing
B2B fulfilment path) already deducts against exactly this same triple.
**`InventoryLocation` has no relationship to `Outlet` today, in either
direction** — confirmed by inspection of both models and every file
under `apps/api/src/inventory/` and `apps/api/src/retail/`.

**The smallest bridge, documented for Sprint 37, deliberately NOT
implemented this sprint**: an optional `Outlet.inventoryLocationId ->
InventoryLocation` FK, added only when a real fulfilment requirement
exists to justify it — mirroring `Outlet.territoryId`'s own shape
exactly. No stock deduction, reservation, transfer, fulfilment
transaction, COGS, or settlement logic was written this sprint; this
section exists purely so the answer is on record before Sprint 37 starts,
not because any of it was built.

## 60. B2B Credit Boundary — Preserved, Not Reinterpreted

**A critical, explicitly-protected business boundary.** Enabling
Collection Point on an `Outlet` changes exactly one thing:
`collectionPointStatus`. It does NOT mean, and nothing in this sprint's
code treats it as meaning: the outlet has paid for its existing B2B
credit inventory, the outlet is financially settled, or a consumer's OPay
payment (Sprint 35) belongs to the outlet. `outletType`, credit terms,
`DistributionNetworkRelationship` rows, and B2B pricing are all
byte-for-byte untouched by `enableCollectionPoint`/
`disableCollectionPoint`/`updateCollectionPointConfig` — live-verified: a
diff of the update payload sent to `OutletRepository.update()` for each
of these three methods contains only Collection-Point-prefixed fields
plus `updatedById`, never `outletType`/`status`/`customerId`. How a
verified D2C payment eventually becomes a Collection Point's own
commercial/settlement obligation is explicitly Sprint 37's design
problem, not solved (or guessed at) here.

## 61. Consumer Payment Boundary — Unchanged

Sprint 35 established `Consumer -> OPay -> Zentuva` as the payment flow;
a Collection Point does not become a payment recipient merely because it
will eventually fulfil an order. No payment logic — creation, callback
handling, status mapping, or otherwise — was added, modified, or
referenced anywhere in this sprint's code. `d2c-payment-independence.spec.ts`
(Sprint 35, unmodified) continues to pass, confirming `D2CPaymentService`
has no knowledge of Collection Points at all.

## 62. Audit Trail

Three new action strings added to the existing `OUTLET_AUDIT_ACTIONS` map
(`apps/api/src/retail/outlet/outlet-audit-actions.ts`) — no new audit
mechanism:

- `outlet.collection_point_enabled`
- `outlet.collection_point_disabled`
- `outlet.collection_point_configuration_updated` (metadata includes the
  changed field names and the pre-change `responsibleUserId`/
  `operatingHours` values)

Recorded via the existing `AuditService.record()`, in the controller,
matching every other Outlet mutation's own convention exactly (actor,
organisation, entity, timestamp — no new fields). Live-verified: enabling
then configuring then disabling the same outlet produced exactly three
audit rows, each with the correct actor and before/after metadata; five
truly concurrent enable requests against the same outlet produced exactly
ONE `outlet.collection_point_enabled` row (the four losing requests never
reach the audit call, since they throw before it).

## 63. Disabling — Reversible, Never Destructive

Disabling flips `collectionPointStatus` back to `DISABLED` and touches
nothing else — `collectionPointResponsibleUserId`/`.OperatingHours` are
never cleared, so re-enabling later needs no re-entry (live-verified: a
disable→reload→re-open cycle showed the same responsible representative
and operating hours still populated, badge correctly reading
"Disabled"). No `SalesOrder`/`Payment` row exists yet that references a
Collection Point (Sprint 37 territory), so there is nothing to migrate or
reassign this sprint. A repeated `disable` call is rejected with `400
Collection Point is already disabled for this outlet` — the exact
`activate`/`deactivate` convention — rather than silently succeeding.

**Outlet status vs. Collection Point status, deliberately kept
independent**: deactivating the underlying `Outlet`
(`OutletService.deactivate()`) is completely unmodified and never
touches `collectionPointStatus` — an outlet can be `INACTIVE` with
Collection Point still recorded as `ENABLED` in the database (its
configuration is preserved, exactly like the disable case above). Any
future reader (Sprint 37's own eligibility/discovery query) must treat a
Collection Point as available only when BOTH `Outlet.status === ACTIVE`
AND `collectionPointStatus === ENABLED` — this is a read-time
combination, never a second persisted "effective" flag, and
`enableCollectionPoint()` itself already refuses to enable an `INACTIVE`
outlet in the first place (§58).

## 64. Discovery Foundation

A future consumer-facing "find a Collection Point" flow (Sprint 37/38)
will need: `organisationId` + territory match + `collectionPointStatus:
'ENABLED'` + `Outlet.status: 'ACTIVE'`. Every piece of that filter already
exists on `Outlet` today — no new query, endpoint, or algorithm was built
this sprint (explicitly out of scope: nearest-location matching, maps,
GPS, a consumer-facing selection UI). The one thing added is a composite
index, `@@index([organisationId, territoryId, collectionPointStatus])`,
purely so that future query performs well once it exists — the data model
supports the flow; the flow itself does not exist yet.

## 65. Admin & Field UI

**Admin** (`/settings/retail`, Outlets tab, edit dialog): a self-contained
"Collection Point" section was added to the existing `OutletDialog`
(edit mode only — needs an outlet id first, the same reasoning already
used for photo management) with its OWN mutations
(enable/disable/configure), deliberately never bundled into the outlet
form's "Save Changes" submit — matching the brief's "explicit mutations,
not an arbitrary field save" instruction and mirroring how Activate/
Deactivate already work as instant actions elsewhere in this codebase.
Consumer-facing language is "Collection Point"/"Enable"/"Disable" —
never "Pickup" anywhere in the UI or API (docs brief "Terminology").

**Field** (`/field/outlets/:id`): a small, read-only "Collection Point:
Enabled" badge + operating hours was added to the existing detail page —
shown only when `collectionPointStatus === 'ENABLED'`, live-verified
present on an enabled outlet and absent on a plain B2B one. Deliberately
NOT a paid-order queue, "prepare order," "ready for collection," or any
other Sprint 37 operational workflow element — purely informational, per
the brief's explicit boundary.

## 66. Scope — Explicitly Not Built This Sprint

No consumer Collection Point selection, order assignment, order
preparation, "ready for collection"/"collected" states, inventory
deduction/reservation/transfer, Collection Point settlement or accounting
settlement, field-worker paid-order queue, collection notifications,
loyalty/rewards, or payout — all explicitly Sprint 37 or later. Sprint 36
ends at: an existing Outlet, with a Collection Point capability,
configured, ready for Sprint 37 to connect a paid `SalesOrder` to it.

## 67. Testing (Sprint 36)

`apps/api/src/retail/outlet/outlet.service.spec.ts`: enable (valid
eligible outlet; inactive-outlet rejection; no-territory rejection;
cross-tenant `NotFoundException`; already-enabled rejection; never
touches `outletType`/`customerId`/`status`; 5-way concurrent enable
producing a deterministic `ENABLED` final state across every settled
call); disable (valid; already-disabled rejection; configuration
survives disable untouched; repeated-disable safety); configuration
update (valid with responsible-user validation; cross-tenant
responsible-user rejection; inactive/suspended responsible-user
rejection; explicit `null` clears the field; cross-tenant outlet
rejection; concurrent updates producing a deterministic final state); a
dedicated B2B-regression block confirming `create()`/`activate()` remain
byte-for-byte unaffected by the Collection Point capability.
`apps/api/src/retail/outlet/outlet.controller.spec.ts`: enable/disable/
config-update audit events (including before/after metadata); the
`representatives` picker's `ACTIVE`-only filter. `apps/api/src/sales/
sales-order.service.spec.ts`'s existing `Outlet` fixture was extended
with the three new fields (compile-time regression guard only, no
behavioural change). No new spec files were created — this sprint extends
the existing Outlet domain's own test files, matching its "extend, don't
parallel" architecture exactly. Full live verification against the real
dev database, real HTTP requests (including a genuinely second
organisation via `/auth/register`, an unauthenticated request, and the
seeded Member role), 5 truly concurrent enable requests, 5 concurrent
configuration updates, and a real browser session (admin dialog,
persistence-after-reload, field detail page) — see
`docs/sprint-36-completion-report.md`.

## 68. Sprint 37 — Collection Point Fulfillment & Inventory Reconciliation

Sprint 36 gave an existing `Outlet` a Collection Point _capability_.
Sprint 37 connects a real, paid D2C `SalesOrder` to that capability and
carries it through to an actual inventory deduction — Paid → Eligible
Collection Point → Assigned → Preparing → Ready for Collection →
Collected → Fulfilled → Inventory Reconciled. No parallel order entity
(`ConsumerOrder`/`CollectionOrder`/`CollectionPointOrder`/
`D2CFulfillmentOrder`) was created — `SalesOrder` remains the one
authoritative order record end to end, exactly as it already was for
B2B.

## 69. The Inventory Bridge — Decided, Then Built

Sprint 36 (§59) deliberately left this open as "Sprint 37's design
problem." The audited answer, unchanged from that section's own
reasoning: `InventoryLocation` had zero relationship to `Outlet` in
either direction, while `SalesFulfilment.locationId` already treats a
plain `(organisationId, productId, locationId)` triple as the unit of
truth for B2B. Sprint 37 adds exactly the bridge Sprint 36 already
named: `Outlet.inventoryLocationId String?` (nullable — most outlets are
never a Collection Point; NOT unique — multiple outlets may share one
warehouse, mirroring how several B2B customers already share
`SalesFulfilment.locationId` today), `onDelete: Restrict` (a location
with an outlet depending on it cannot be silently deleted out from under
it). No reservation, transfer, or second stock ledger was introduced —
an outlet configured this way draws from the exact same `InventoryStock`
row any B2B fulfilment at that location already draws from.

## 70. Eligibility — The Actual Rules Implemented

An outlet is an eligible Collection Point for a consumer's order when,
at read time, ALL of:

- `Outlet.status === 'ACTIVE'`
- `collectionPointStatus === 'ENABLED'`
- `Outlet.inventoryLocationId` is set (an enabled Collection Point with
  no configured location cannot fulfil anything — it is excluded from
  auto-assignment, not treated as an error)
- `Outlet.territoryId === Consumer.territoryId` (the same territory match
  Sprint 36's discovery foundation, §64, already named)

When more than one outlet in a territory qualifies, the oldest
(`createdAt` ascending) is chosen — deterministic, no scoring/ranking
algorithm, no nearest-location/GPS matching (explicitly out of scope,
§76). A consumer with no territory, or a territory with no eligible
outlet, results in a recorded `assignment_failed` audit row (§75) and no
`CollectionPointFulfillment` row — never a thrown error surfaced to the
paying consumer, since the payment itself already succeeded by this
point.

## 71. Order Assignment Model

Two paths reach the same `CollectionPointFulfillmentService.assignManually`
outcome:

- **Automatic** (the primary path): `D2CPaymentService.handleProviderCallback()`'s
  success branch calls `autoAssign()` immediately after a verified OPay
  payment, wrapped in try/catch that only logs — an assignment failure
  must never crash the webhook endpoint OPay retries against (the exact
  Sprint 35 "invalid callback must never 500" philosophy, §47, extended
  to a new failure mode).
- **Manual** (`POST /d2c/collection-point-fulfillments/assign`): the
  admin fallback for the "no eligible outlet existed at payment time" or
  "assign a specific outlet" cases. `outletId` is optional — omitted, the
  server re-runs the same territory match; supplied, the server still
  re-validates eligibility (§70) rather than trusting the caller's
  choice.

A `SalesOrder` can be assigned at most once — `CollectionPointFulfillment.salesOrderId`
is unique, enforced at the database level, not merely checked in
application code before insert.

## 72. Fulfillment State Model — One New, Deliberately Subordinate Model

**Audited before building anything**: `SalesOrderStatus`
(DRAFT/CONFIRMED/PARTIALLY_FULFILLED/FULFILLED/CANCELLED) already fully
answers "is this order done," but cannot represent the D2C-specific
_operational_ sub-workflow between CONFIRMED and FULFILLED — knowing an
order is "being prepared at the counter" vs. "sitting ready for the
consumer to walk in" is genuinely new information no existing field
carries. A single new model, `CollectionPointFulfillment`
(`CollectionPointFulfillmentStatus`: ASSIGNED → PREPARING →
READY_FOR_COLLECTION → COLLECTED), was added — one row per assigned
`SalesOrder`, always subordinate to it (`salesOrderId` unique FK), never
a second order record. Every transition uses the same conditional
`updateMany` guard this codebase already uses everywhere else for state
machines (`OutletRepository.update()`, `SalesOrderRepository.updateStatus()`):
scope the `WHERE` to `{id, organisationId, status: {in: fromStatuses}}`,
check the affected row count, re-fetch on success.

## 73. Inventory Mutation Boundary — Reused, Never Reinvented

The only place inventory is actually deducted is the pre-existing,
completely unmodified `SalesFulfilmentService.fulfil()` (Sprint 4.9) —
the same call the B2B "record a fulfilment" flow already makes.
`CollectionPointFulfillmentService.confirmCollection()` calls it at the
exact moment status reaches `COLLECTED`, passing `outlet.inventoryLocationId`
as the fulfilment location and a deterministic
`idempotencyKey: \`collection-point-fulfillment:${cpf.id}\``— a second,
independent safety net beyond the`CollectionPointFulfillment`status
guard, specifically against a retried`fulfil()` call itself. No new
stock table, no new mutation path, no new COGS/journal logic — a
Collection Point fulfilment posts the exact same accounting entries a
B2B one does, through the exact same code.

**Ordering matters, and was gotten wrong on the first pass — see §74.**

## 74. A Genuine Bug Found (and Fixed) by Live Verification

The first implementation flipped `CollectionPointFulfillment.status` to
`COLLECTED` _before_ calling `fulfil()`. Live verification against the
real dev database caught this immediately: the dev environment's
accounting periods didn't cover "today" (a pre-existing environmental
gap, unrelated to this sprint — see §80), so `fulfil()` threw
`NoOpenPeriodError`. But the status had already committed as `COLLECTED`
— a terminal state — before the throw. Every subsequent retry then hit
`confirmCollection()`'s own idempotency short-circuit ("already
COLLECTED, return success, never re-deduct") and silently reported
success forever, while the `SalesOrder` was never actually fulfilled and
stock was never actually deducted. Reproduced live: `SO-000024` shows
`CollectionPointFulfillment.status = COLLECTED` with
`SalesOrder.status = CONFIRMED` and `quantityFulfilled: 0` permanently,
in this dev database, as a preserved artifact of the bug being found.

**The fix**: `confirmCollection()` now calls `fulfil()` _inside_ a
try/catch that sits between the optimistic status flip and the audit
record. If `fulfil()` throws for any reason, the status flip is
explicitly reverted back to `READY_FOR_COLLECTION` (clearing
`collectedAt`/`collectedById`) before re-throwing the original error —
the operation is left genuinely retryable rather than stranded. The
original 5-way concurrency guarantee (§77) is unaffected: the same
conditional `updateMany` still ensures only one concurrent caller ever
proceeds past the guard to attempt `fulfil()` at all; the other callers
still short-circuit as an idempotent no-op _before_ touching inventory.
A dedicated regression test
(`collection-point-fulfillment.service.spec.ts`, "reverts to
READY_FOR_COLLECTION... when fulfil() fails") asserts the rollback call
shape directly. Re-verified live end to end afterward (`SO-000025`):
`fulfil()` failure now correctly reverts and remains retryable; on
retry, stock deducted exactly once (27 → 24 for a 3-unit order),
`SalesOrder.status` correctly reached `FULFILLED`.

## 75. Audit Trail

New action strings on `COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS`,
recorded via the existing `AuditService.record()` — no new audit
mechanism: assignment (auto and manual), each status transition, and
`assignment_failed` (metadata: `{reason: 'no eligible Collection Point
in territory'}` or `'consumer has no territory'`) for the case where a
paid order finds nowhere to go. Live-verified: disabling a Collection
Point mid-territory and then placing a new order produced exactly one
`assignment_failed` row with the correct reason, and the order remained
unassigned (not silently dropped) until an admin manually assigned it
once the outlet was re-enabled.

## 76. Authorization

Two new permissions, `d2c.collection_point.view`/`.fulfil`
(`SCOPABLE`), granted broadly at seed time (Administrator automatically;
Member explicitly) — a coarse gate only, since Sprint 36 already
established that a Collection Point's responsible representative can be
any active member with no special role. The actual restriction is a
resource-ownership check layered on top, new to this codebase (§ per
Sprint 36's own audit finding that no `AccessScope` mechanism does this):
the caller must either hold `sales.customer.manage` (the same permission
that already governs Collection Point configuration) or be the specific
outlet's `collectionPointResponsibleUserId`. Live-verified: the seeded
Owner/Administrator account could act on the Collection Point despite
having no `collectionPointResponsibleUserId` set on the outlet (via the
`sales.customer.manage` bypass), confirming the admin-oversight path
works independent of per-outlet assignment.

## 77. Idempotency & Concurrency

Every transition (`startPreparing`, `markReadyForCollection`,
`confirmCollection`) uses the conditional-`updateMany`-as-concurrency-guard
pattern (§72). Live-verified with genuine concurrency against the real
Postgres database, not mocks:

- **8 truly concurrent `confirmCollection` calls on the same record**
  (`SO-000027`) all returned `HTTP 201 COLLECTED`; stock decremented by
  exactly 1 unit (24 → 23), `SalesOrder` reached `FULFILLED` with
  `quantityFulfilled: 1` — no double-deduction, no error surfaced to any
  of the 8 concurrent callers.
- **A duplicate `confirmCollection` call after success** (`SO-000025`)
  returned the same `COLLECTED` result with no further stock change.
- **Disabling a Collection Point mid-flight** correctly blocked new
  auto-assignment (§75) without disturbing in-flight fulfilments already
  assigned to it.
- **Insufficient stock** (`SO-000026`, 500 units ordered against 24
  available): `markReadyForCollection` correctly rejected with `400
Insufficient stock at this Collection Point for: ...`, leaving the
  fulfilment at `PREPARING` (not silently advanced) and stock untouched.

## 78. A Confirmed, Pre-Existing Inventory Concurrency Defect (Not Introduced by This Sprint)

**Fixed in Sprint 37.1** (`docs/domains/inventory.md` §12,
`docs/sprint-37.1-completion-report.md`) — this section is kept exactly as originally
written, as the historical record of how the defect was found; it no longer describes
current behavior.

Sprint 36's audit (referenced in the prior sprint's own notes) flagged a
_theoretical_ lost-update risk in `SalesFulfilmentRepository.create()`:
it reads `InventoryStock.quantityOnHand`, computes `newQuantity` in
application code, then `upsert`s that precomputed absolute value — a
classic read-modify-write with no row lock and no atomic/conditional
decrement, under Postgres's default READ COMMITTED isolation.

Sprint 37's own concurrency testing (§77) exercises the _guard in front
of_ this mechanism, not the mechanism itself — and the brief's own
required scenario, "competing orders draining last stock units," reaches
straight through that guard into the shared mechanism underneath. It was
tested live: two different D2C `SalesOrder`s (`SO-000028`, `SO-000029`),
each for 15 units of a product with only 23 units on hand (each
individually passed `markReadyForCollection`'s pre-check, since that
pre-check reads stock independently per order and does not reserve),
fired at `confirmCollection` truly concurrently. **Both returned success.
Both `SalesOrder`s reached `FULFILLED` with `quantityFulfilled: 15`
each — 30 units recorded as fulfilled — while `InventoryStock.quantityOnHand`
ended at 8 (23 − 15, i.e. only one of the two decrements actually took
effect; the second transaction's read was stale and its write silently
overwrote the first transaction's committed decrement).** Stock never
went negative, but the underlying accounting is wrong: the warehouse
record now understates how much was actually promised to consumers by
15 units, with no error and no audit flag raised anywhere.

**This is a real, now-empirically-confirmed defect in
`SalesFulfilmentRepository.create()`** — pre-existing Sprint 4.9 shared
infrastructure used by every B2B and D2C fulfilment path alike, not code
this sprint introduced or was asked to fix. Sprint 37's own brief was
explicit that the existing inventory mutation mechanism should be reused,
not reinvented or re-architected mid-sprint, and a correct fix (an
atomic conditional decrement following the same `updateMany`-guard
pattern used everywhere else in this codebase) has a blast radius across
every consumer of `.create()` and deserves its own dedicated,
carefully-tested piece of work rather than a rushed patch bundled into a
D2C completion report. It has been flagged separately as a follow-up
task. Reported here in full rather than glossed over, per this sprint's
own explicit instruction never to claim a concurrency guarantee that
wasn't actually verified.

## 79. B2B Credit Boundary — Preserved

Unchanged from Sprint 36 (§60): nothing in this sprint's code reads or
writes `outletType`, credit terms, `DistributionNetworkRelationship`
rows, or B2B pricing. `CollectionPointFulfillmentService` only ever
touches `SalesOrder`/`CollectionPointFulfillment`/`InventoryStock` rows
scoped to the D2C order it was given — it never queries or mutates an
outlet's B2B state. `sales-fulfilment.service.spec.ts` (Sprint 4.9,
unmodified) and the existing B2B fulfilment live-verification path both
continue to pass unmodified.

## 80. Known Limitations

- **The pre-existing inventory concurrency defect, §78** — not fixed
  this sprint; flagged as dedicated follow-up work. **Update: fixed in
  Sprint 37.1** — see `docs/domains/inventory.md` §12.
- **Accounting period gap in this dev environment**: the seeded
  `AccountingPeriod` rows didn't cover the date live verification was
  run on (only "August 2026" was `OPEN`; a rolled-forward "September
  2026" period had to be created via the existing, ordinary
  `finance/accounting-periods` admin endpoint to exercise the real
  `fulfil()`/journal-posting path). This is a routine monthly bookkeeping
  gap in seed/dev data, not a Sprint 37 defect — but it is exactly the
  kind of failure `fulfil()` can throw, which is precisely what exposed
  the bug in §74.
- **Minor response staleness**: `confirmCollection()`'s own HTTP
  response embeds `salesOrderStatus` from the `CollectionPointFulfillment`
  row fetched _before_ `fulfil()` ran, so the single synchronous response
  to that one call can show the pre-fulfilment `SalesOrder` status (e.g.
  `CONFIRMED`) for one beat — the very next `GET` (and the Field UI's own
  15-second poll) shows the correct post-fulfilment status (e.g.
  `FULFILLED`). Not fixed — no caller of this API currently depends on
  that field from the mutation response specifically, and refetching the
  order purely to correct one display field after a successful mutation
  did not meet the bar for added complexity.
- **Consumer notification** — audited and confirmed unbuildable within
  this sprint's own boundaries (Notification system is User-only;
  Conversation Layer has no proactive/outbound capability, per Sprint 36
  era audit findings). Not extended this sprint; a consumer currently
  learns their order is ready only by physically checking or being told
  in person at the Collection Point.
- **Tenant isolation** — enforced identically to every other
  organisation-scoped resource in this codebase (`organisationId` scoping
  on every repository query, verified structurally by
  `collection-point-fulfillment-independence.spec.ts`) but not
  live-verified against a second real organisation this sprint, unlike
  Sprint 36's own live cross-tenant test (§67). The mechanism is the same
  one already live-verified there.

## 81. Scope — Explicitly Not Built This Sprint

Loyalty/rewards/campaigns/marketing, settlement/payout, new geography or
territory concepts, new payment or notification systems, WhatsApp
integration, nearest-location/GPS-based Collection Point selection, a
consumer-facing Collection Point picker UI, and a fix for the
pre-existing inventory concurrency defect (§78, tracked separately) —
all explicitly out of scope, per the brief's own boundary.

## 82. Testing (Sprint 37)

`apps/api/src/d2c/fulfillment/`: `collection-point-fulfillment.repository.spec.ts`
(CRUD + the conditional-`updateMany` guard), `collection-point-fulfillment.service.spec.ts`
(eligibility, both assignment paths, every state transition, the
`confirmCollection`/`fulfil()` rollback-on-failure path added in §74, the
idempotent-duplicate path, 5 mocked genuinely-concurrent
`confirmCollection` calls resulting in exactly one `fulfil()` call, and
authorization), `collection-point-fulfillment.controller.spec.ts`, and
`collection-point-fulfillment-independence.spec.ts` (structural guards:
no forbidden cross-domain imports, exact module import set including the
`AuthModule` dependency discovered during live verification — see §83).
Existing spec files extended for the new `inventoryLocationId` field
(`outlet.service.spec.ts`, `outlet.controller.spec.ts`,
`sales-order.service.spec.ts`) and the `D2CPaymentService`/`OutletService`
constructor arity changes. Full suite: 231 suites / 2084 tests passing,
zero regressions against the Sprint 36 baseline (227 suites / 2040
tests).

Live verification against the real dev database and a real running API
(not mocks) covered: a full consumer conversation → payment → webhook →
auto-assignment → Preparing → Ready → Collected → real stock deduction →
`SalesOrder.FULFILLED` path (twice — the first run surfaced and confirmed
the §74 bug, the second confirmed the fix); insufficient-stock rejection;
a disabled Collection Point correctly blocking new auto-assignment while
leaving in-flight work untouched; the admin manual-assignment fallback
correctly rejecting an ineligible outlet and succeeding once eligible;
idempotent duplicate confirmation; 8 genuinely concurrent
`confirmCollection` calls on one record; and 2 genuinely concurrent
`confirmCollection` calls for different orders competing for the same
limited stock (which surfaced the pre-existing §78 defect). See
`docs/sprint-37-completion-report.md`.

## 83. A Second Bug Found by Live Verification: Missing `AuthModule` Import

`CollectionPointFulfillmentModule` initially imported `IdentityModule`
but not `AuthModule`. The module compiled and every unit test passed
(unit tests mock the guard's dependencies directly), but booting the
real Nest application failed immediately: `JwtAuthGuard` needs
`TOKEN_SERVICE`, which is provided by `AuthModule`, not `IdentityModule`
— the exact same pattern `OutletModule`/`SalesModule` already import both
for. Fixed by adding `AuthModule` to the module's imports; the structural
independence spec's exact-import-`Set` assertion was updated to match,
with a comment explaining why. A reminder that a controller-bearing
module's dependency wiring is only fully proven by actually booting the
application, not by unit tests alone — which is exactly why this
sprint's live-verification phase exists.

## 84. Sprint 38 — Field Operations & Collection Point Mobile Experience

Turns the D2C backend capability built across Sprints 32–37.1 into a practical
mobile field-operations workflow. Not a new business domain — a UX/operations
sprint extending the EXISTING Field experience (`apps/web/src/app/(field)/`)
and the EXISTING D2C/Sales/Inventory/Collection-Point services. No new
CollectionPoint/order/inventory entity; the existing Sprint 37 state machine
and services are reused exactly as built.

## 85. The Missing Bridge: `Employee.territoryId`

**Audited before writing any code**: this sprint's own audit confirmed what
`sales-order.controller.ts`'s own doc comment already stated — no server-side
data linked a `User`/`Employee` to a `Territory` anywhere in this codebase.
`AccessScope.ASSIGNED_TERRITORY` is recorded at role-grant time but never
enforced; the one real per-person scoping mechanism that exists
(`Outlet.collectionPointResponsibleUserId`) is a plain ownership field, not a
territory concept at all. Without SOME link, a field Sales Representative's
D2C visibility could not be scoped to "their territory" at all — the brief's
own required architecture (`User → Employee → Territory → permitted D2C
orders/Collection Points`) had no foundation to enforce.

The fix: `Employee.territoryId String?`, a plain nullable FK to `Territory`
with `onDelete: SetNull` — the exact shape `Customer.territoryId`/
`Outlet.territoryId` already established, never a new generic
Territory-assignment system. A dedicated `assignTerritory` method
(`EmployeeService`/`EmployeeRepository`/`POST /hr/employees/:id/territory`)
mirrors the existing `assignDepartment`/`assignPosition`/`assignManager`/
`assignWorkSchedule` dedicated-method shape exactly. Existence validation is
a direct, read-only cross-table Prisma query inside `EmployeeRepository`
(scoped by `organisationId`, closing the tenant-isolation gap a bare foreign
key alone would leave open) rather than an injected `TerritoryRepository` —
`HrModule` deliberately imports no other domain's module
(`hr-independence.spec.ts`'s own structural guard), and this sprint's fix
preserves that boundary rather than punching a hole in it.

## 86. Field D2C Overview — the Sales Representative's Territory-Scoped View

A new, purely read-only aggregation layer, `FieldD2COverviewService`/
`FieldD2COverviewController` (`/api/d2c/field-overview/orders`,
`/api/d2c/field-overview/collection-points`) — composed entirely from
EXISTING repositories (`SalesOrderRepository`, extended with `source`/
`consumerTerritoryId` filter params; `CollectionPointFulfillmentRepository`,
extended with a batch `findManyBySalesOrderIds` lookup; `OutletRepository`,
whose `territoryId` filter already existed). No new table, no new domain
service with business logic — this layer only reads and merges.

Territory scoping is enforced server-side, mirroring the EXACT
"resource-ownership check, not `AccessScope`" shape
`CollectionPointFulfillmentService.getMyOutlets` already established: an
admin (`isOwnerBypass` or `sales.customer.manage`) sees every territory
tenant-wide; anyone else sees only their own `Employee.territoryId`'s data;
a caller with no territory assigned (or no `Employee` record at all) sees
nothing — deny-by-default, never falls back to unrestricted. Live-verified:
a field rep scoped to "Bodija" saw exactly the 2 Bodija Collection Points and
excluded a genuinely-existing third Collection Point in "Mokola" territory,
while an admin querying the identical endpoint saw all 3 — proving real
server-side filtering, not a coincidental absence of other-territory data.

Each endpoint reuses the EXISTING permission that already gates the kind of
data it returns — `d2c.consumer.view` for the order list, `d2c.collection
_point.view` for the Collection Point list — no new permission pair; this
sprint's own audit found no genuine authorization gap that would justify
one. `d2c.consumer.view` was additionally granted to the Member role at seed
time (it existed since Sprint 32 but was never granted to Member), since
without it no field Sales Representative could reach the new endpoint at
all.

**Deliberately NOT included in the order list response**: a `paymentStatus`
field. Fetching it would require widening `SalesOrderRepository`'s shared
`RELATIONS_INCLUDE` with a `payments` join used by every B2B caller of that
repository too, for a field only this one list view needs — explicitly
scoped out rather than accepted as unavoidable collateral. The richer detail
view a Collection Point representative actually opens (§87) carries real
`paymentStatus`/`paidAt`, scoped narrowly to where it matters operationally.

## 87. Collection Point Representative — Dashboard, Inventory View, Order Detail

Three additions to the existing Sprint 37 `/field/collection-point` screen
and its API (`CollectionPointFulfillmentService`/`Controller`), all reusing
Sprint 37's own data and authorization boundary — no new permission, no new
ownership check:

- **A Today dashboard and Attention Required section** — computed entirely
  client-side from data the backend already returned and already
  authorized (counts by status, a "waiting too long" highlight). Never a
  new server-side business rule. The "waiting too long" threshold is a
  documented UI-only constant, `ATTENTION_WAITING_MINUTES = 30`
  (`apps/web/.../collection-point/page.tsx`) — no existing configured
  threshold was found anywhere in the codebase for this, so rather than
  inventing a silent one, this sprint picks one reasonable default and
  names it explicitly, never enforced server-side.
- **A Collection Point inventory view** —
  `GET /d2c/collection-point-fulfillments/outlet/:outletId/inventory`
  (`CollectionPointFulfillmentService.getInventoryViewForOutlet`), reusing
  the EXACT `InventoryStockRepository.findManyByProductsAndLocation`
  primitive `SalesFulfilmentService.getAvailability` already uses for B2B —
  never a new stock-reading mechanism, and READ-ONLY (a structural guard in
  `collection-point-fulfillment-independence.spec.ts` confirms no write
  method is ever called on it). `required` sums ordered quantity across
  every NOT-YET-COLLECTED fulfilment at the outlet — a `COLLECTED` order's
  stock was already deducted via `confirmCollection`'s own call into
  `SalesFulfilmentService.fulfil()`, so counting it again would double-count
  already-spent stock as still "required." Same authorization boundary as
  the existing queue endpoint (`assertActorAuthorizedForOutlet`) — live-
  verified rejecting a non-owner with 403 and succeeding for the assigned
  rep and for an admin.
- **An order detail page** (`/field/collection-point/[id]`), using the
  EXISTING `GET /d2c/collection-point-fulfillments/:id` endpoint, enriched
  this sprint with `paymentStatus`/`paidAt` (derived from `SalesOrder
.payments`, Sprint 35 — the latest payment's `status`/`paymentDate`; `null`
  only if an admin manually assigned an order with no payment row at all)
  and `consumer.territoryName`. Shows exactly the ONE action valid for the
  order's current `CollectionPointFulfillmentStatus` — the backend's own
  guarded state machine (Sprint 37) remains the sole authority; the page
  only mirrors it for display. A confirmation step (brief "confirmation
  before irreversible operational actions") gates Confirm Collection, the
  one action that triggers real inventory deduction.

## 88. Authorization & Scoping — Live-Verified

- **Collection Point ownership** (Sprint 37's own boundary, unchanged):
  live-verified that a Member-role user with `d2c.collection_point.view`
  but no ownership of a specific outlet is rejected with 403 on both the
  existing detail endpoint and the new inventory-view endpoint; the same
  user succeeds on both once made the outlet's
  `collectionPointResponsibleUserId`.
- **Field D2C territory scope** (new this sprint): live-verified end to
  end — a field rep assigned to "Bodija" territory saw 13 real D2C orders
  and 2 real Collection Points, all correctly scoped; a genuinely separate
  organisation (`/auth/register`-created tenant) saw zero orders, zero
  Collection Points, and received `404` (not `403`, matching this
  codebase's existing cross-tenant concealment convention) on both the
  direct fulfilment-detail and inventory-view endpoints for Org A's real
  resource ids.
- **Manipulated-ID resistance**: tested directly — a cross-tenant outlet
  id, a cross-tenant fulfilment id, and an unrelated (non-owned) outlet id
  were all rejected server-side; the frontend never performs an
  authorization decision, it only renders what the backend already decided
  to return.

## 89. Concurrency — Unchanged, Re-Verified

Sprint 38 touches none of the Sprint 37/37.1 state-transition or inventory-
deduction logic — only `toResult()`'s read-side enrichment and new read-only
endpoints. Re-verified live rather than assumed: two genuinely concurrent
`confirmCollection` requests (one as the assigned rep, one as an admin)
against the same `READY_FOR_COLLECTION` order both returned `201` with
identical final state; stock decremented by exactly the order's own quantity
(one decrement, not two); the Sprint 37.1 real-PostgreSQL integration suite
(`inventory-stock-concurrency.integration.spec.ts`) still passes all 7 tests
unchanged.

## 90. Audit & Notifications

No new audit mechanism — `hr.employee.territory_assigned` was added to the
existing `HR_AUDIT_ACTIONS` map, recorded via the existing `AuditService
.record()`, matching every other Employee `assignX` action's own convention
exactly. Every Collection Point operational mutation (assignment, prepare,
ready, collect) already had audit coverage from Sprint 37 — confirmed by
re-reading `collection-point-fulfillment-audit-actions.ts`, not duplicated.

Notifications were audited, not built: the Notification system remains
User-only (confirmed again this sprint — no change), and the Conversation
Layer still has no proactive/outbound capability. Sprint 38 does not
integrate with either — the Field UI's own 15/30-second polling is the
mechanism by which a rep and a Sales Rep each see new activity, exactly the
Sprint 37 precedent. A future "Order Ready" → Notification → WhatsApp flow
(brief's own suggested future flow) remains a documented integration point
for a later sprint, not built here.

## 91. Known Limitations

- **No `paymentStatus` in the Sales Rep's order list** (§86) — a deliberate
  scope trim to avoid widening a shared, heavily-reused repository include.
- **The "waiting too long" threshold (30 minutes) is a UI-only constant**,
  not configurable, not enforced server-side, and not based on any existing
  business rule (none was found to exist) — documented explicitly rather
  than silently invented.
- **Consumer contact (phone number) is surfaced to the Collection Point
  representative but no in-app call/WhatsApp action was built** — the
  existing Notification/WhatsApp infrastructure cannot yet push to a
  Consumer (Sprint 37's own audit finding, unchanged), so this sprint
  stops at surfacing the already-authorized phone number as plain text,
  per the brief's own "otherwise simply surface the relevant information"
  instruction.
- **No dedicated admin UI for assigning `Employee.territoryId`** — settable
  today via the new `POST /hr/employees/:id/territory` endpoint (and
  exercised that way for this sprint's live verification), but no HR
  admin-screen Territory picker was built, given this sprint's explicit
  Field-operations (not D2C/HR-administration) scope.
- **Cross-tenant `Employee.territoryId` rejection was unit-tested but not
  separately live-verified** (would require creating an Employee record in
  a second live tenant purely for this one check) — the underlying
  `organisationId`-scoped Prisma query is the same established pattern used
  throughout this codebase and is covered by `employee.service.spec.ts`.

## 92. Scope Boundaries — Explicitly Not Built

Real WhatsApp API/webhook integration, consumer chatbot changes, a new
payment provider or OPay changes, loyalty/rewards, marketing campaigns,
consumer segmentation/analytics, Collection Point settlement/payout,
accounting settlement, a new inventory or order architecture, a new
CollectionPoint entity, a full inventory management UI, a full CRM, or any
analytics dashboard — all explicitly out of scope, per the brief's own
boundary.

## 93. Testing (Sprint 38)

New: `field-d2c-overview.service.spec.ts` (territory scoping — admin
bypass via `isOwnerBypass`/`sales.customer.manage`, scoped territory filter,
deny-by-default for no-territory and no-Employee-record callers, order/
Collection-Point merging logic), `field-d2c-overview.controller.spec.ts`.
Extended: `collection-point-fulfillment.service.spec.ts` (+13 tests:
`getInventoryViewForOutlet`'s SUFFICIENT/SHORT/multi-order-summing/no-stock-
row/no-location/empty-queue/authorization cases; `getById`'s new
`paymentStatus`/`paidAt`/`territoryName` mapping), `collection-point
-fulfillment.controller.spec.ts` (+2), `collection-point-fulfillment
-independence.spec.ts` (updated to allow the new read-only
`InventoryStockRepository` dependency while still forbidding any write
call through it), `employee.service.spec.ts` (+4, `assignTerritory`).
Full suite: 234 suites / 2120 tests passing, zero regressions against the
Sprint 37.1 baseline (232/2089); the Sprint 37.1 real-PostgreSQL
integration suite (7/7) re-run unchanged.

Live verification against the real dev database and a real running
application (API + web, mobile viewport) covered: the full Collection Point
representative flow end to end (a fresh consumer conversation → payment →
auto-assignment → Preparing → Ready → Confirm Collection → real inventory
deduction, 23→21 units for a 2-unit order), the dashboard/attention/
inventory-view sections rendering real data correctly on a 375px mobile
viewport, the order detail page showing enriched payment/territory fields,
the Sales Representative's territory-scoped D2C overview (13 real orders,
2 real Collection Points, correctly excluding a third-territory Collection
Point), two genuinely concurrent `confirmCollection` calls producing exactly
one stock decrement, and cross-tenant/cross-ownership/manipulated-id
rejection in every case tested. See `docs/sprint-38-completion-report.md`
for the full record.
