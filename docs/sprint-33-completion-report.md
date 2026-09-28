# Sprint 33 Completion Report — Consumer Conversation Experience Foundation

## 1. Executive Summary

Built the channel-neutral **Consumer Conversation Layer** that sits between
a future WhatsApp adapter and Zentuva's existing D2C/Consumer services:

```
WhatsApp / Meta  →  WhatsApp Channel Adapter  →  Consumer Conversation Layer  →  D2C Services  →  Existing Zentuva Domains
   (not built)          (not built)                    (THIS SPRINT)            (Sprint 32, reused)     (Territory, Audit, ...)
```

`ConversationService` exposes one entry point,
`handleInboundMessage(organisationId, input)`, with zero WhatsApp knowledge.
It drives a lightweight `ConsumerConversation` session (state:
`NEW → REGISTRATION → LOCATION_SELECTION → MAIN_MENU`) through registration
(reusing Sprint 32's `ConsumerService` unchanged), structured
territory/location capture (reusing Sprint 32's `Territory` hierarchy, with
a new generic branch-point-resolution algorithm — §5), a main menu that
shows only what already works, and Sprint 32's existing
"I can't find my location" mechanism. No real WhatsApp integration, no
generic workflow engine, no second Consumer/Territory/phone-normalization
system, and no Sprint 42 simulator were built — all explicitly out of
scope per the brief.

Two real issues were found and fixed during this sprint's own live
verification, not by unit tests alone (both detailed in §5 and §9):
(1) the real seeded `Territory` hierarchy is four levels deep, so a naive
"select from the root" query showed a single, useless option — fixed with
a new generic `resolveBranchPoint()` auto-descent helper, verified against
the real seed data and covered by a corrected, more realistic test
fixture; (2) the welcome message hardcoded one tenant's brand name
("Boby Bites") regardless of which organisation was actually being served
— found by logging in as a genuinely different, newly-registered
organisation and reading the response text, fixed by threading the real
`Organisation.displayName`/`.name` through every message-building path,
and covered by a new regression test and a repeated live cross-tenant curl
check.

## 2. Audit Findings (pre-implementation)

Performed before writing any code, per the brief's non-negotiable
audit-first requirement:

- **Consumer/Territory (Sprint 32)**: `ConsumerService.registerConsumer`,
  `.updateConsumerLocation`, `.reportLocationNotFound`,
  `.findConsumerByPhone` are already exactly the operations a conversation
  needs, already idempotent, already tenant-scoped, already audited. No
  gap requiring a parallel implementation.
- **Territory hierarchy shape**: confirmed via the seeded Boby Bites data
  that it is a real, multi-level, self-referential tree
  (`Oyo State → Ibadan → {Ibadan North, Ibadan South-West} →
{Bodija, Mokola, Challenge}`) — not the flat 2-level shape an initial
  design assumption would have guessed, which directly informed the
  branch-point-resolution design in §5.
- **Notification stack (Sprints 27–29)**: `AuditService.record()` is the
  correct, existing mechanism to reuse for conversation lifecycle events;
  no existing notification-preference concept applies to a `Consumer`
  (confirmed by Sprint 32's own §8 finding that `NotificationPreference`
  is hard-wired to `User.id`) — outbound/proactive notification
  integration is left as a documented, unimplemented extension point
  (§10).
- **Authorization conventions**: `d2c.consumer.view`/`.manage`
  (Sprint 32, SCOPABLE, catalogue 149–151) already describe exactly the
  capability "drive a consumer's data via any interface" — introducing
  `d2c.conversation.*` would have been a parallel permission for the same
  underlying capability, so it was deliberately not created.
- **Idempotency conventions**: the `CandidateRepository`/
  `ConsumerRepository` find-then-create-then-recover-from-`P2002` recipe
  (Sprints 30, 32) is the established, working concurrency primitive in
  this codebase; reused as-is for `ConversationRepository.findOrCreate`
  rather than inventing a new locking/idempotency mechanism.

## 3. Data Model

```prisma
enum ConversationChannel          { WHATSAPP }
enum ConversationState            { NEW, REGISTRATION, LOCATION_SELECTION, MAIN_MENU, ACTIVE }
enum ConversationStatus           { ACTIVE, ENDED }
enum ConversationMessageDirection { INBOUND, OUTBOUND }

model ConsumerConversation {
  id                     String
  organisationId         String
  consumerId             String?               // null until registration completes
  channel                ConversationChannel    @default(WHATSAPP)
  externalConversationId String                 // e.g. WhatsApp phone number
  state                  ConversationState      @default(NEW)
  context                Json?                  // small flow-scoped working data
  status                 ConversationStatus     @default(ACTIVE)
  lastInteractionAt      DateTime
  // @@unique([organisationId, channel, externalConversationId])
}

model ConsumerConversationMessage {           // append-only history
  id             String
  organisationId String
  conversationId String
  direction      ConversationMessageDirection
  payload        Json                          // the exact inbound/outbound shape
  createdAt      DateTime
}
```

`ACTIVE` state and `ConversationStatus.ENDED` are reserved, documented
extension points (§10) — not used by any code path this sprint.

One pre-existing file required a small, backward-compatible widening:
`TerritoryRepository.findManyByOrganisation`'s `parentTerritoryId` filter
changed from `string | undefined` to `string | null | undefined` (an
explicit three-way branch: omit filter / filter by null / filter by a real
id), needed so `resolveBranchPoint` could query "the true roots"
(`parentTerritoryId: null`) as well as any other level. The existing
`TerritoryController` only ever passes a string or `undefined`, so this is
fully backward-compatible — confirmed by the full pre-existing Territory
test suite remaining green (§8).

Migration: `20260928111641_sprint33_consumer_conversation_foundation`,
applied via `prisma migrate deploy` (the same non-interactive workaround
used in Sprints 30/32, since `prisma migrate dev` cannot run
non-interactively in this environment). `prisma migrate status` confirms
51 migrations, database up to date; `prisma validate` confirms the schema
is valid.

## 4. Conversation Contract

Channel-neutral, semantic UI instructions — never a WhatsApp payload shape.

**Inbound** (`packages/validation/src/d2c.ts`, `conversationInputSchema`,
Zod discriminated union):

```ts
{ type: 'TEXT', text: string }
{ type: 'BUTTON', value: string }
{ type: 'LIST_SELECTION', value: string }
```

**Outbound** (`apps/api/src/d2c/conversation/conversation.types.ts`, plain
TS types — server-constructed, never client-submitted):

```ts
{
  conversationId: string;
  state: ConversationState;
  messages: Array<
    | { type: 'TEXT'; text: string }
    | { type: 'BUTTONS'; text: string; options: { value: string; label: string }[] }
    | { type: 'LIST'; text: string; options: { value: string; label: string }[] }
  >;
}
```

**How a future WhatsApp adapter would use this**: translate a Meta webhook
payload into one of the three inbound shapes, call
`ConversationService.handleInboundMessage(organisationId, input)`
in-process, then render each outbound `TEXT`/`BUTTONS`/`LIST` message as
the equivalent WhatsApp message type (free text / interactive buttons /
interactive list). The adapter needs no knowledge of `Territory`,
`Consumer`, or conversation state — the contract is the entire interface.

**Conversation history**: `ConsumerConversationMessage` is a minimal,
append-only, tenant/consumer/conversation-scoped log of exactly these
inbound/outbound shapes — kept for support/debugging and to power the
internal test UI's chat log; no update or delete path exists.

## 5. Territory Branch-Point Resolution (new pattern)

The brief's UX wants the consumer's first choice to already be meaningful
("Ibadan North" vs "Ibadan South-West"), but the real seeded hierarchy is
four levels deep with single-child levels at the top (`Oyo State → Ibadan`
each have exactly one child). A naive `parentTerritoryId: null` query
showed one useless option ("Oyo State") and stalled the flow — found via
live curl testing against the real database, not by the initial unit test
suite, whose fixture had (incorrectly) modeled three co-equal roots
instead of the real single-child-chain shape.

**Fix**: `resolveBranchPoint(organisationId, parentId)` walks down the
self-referential `Territory` tree through any chain of single-child levels
until reaching a level with zero or 2+ children — no hardcoded depth or
level-name assumption, so it generalizes to any organisation's differently
shaped hierarchy. Applied both when first presenting "select your
territory" and again after a territory is chosen (to auto-descend past any
further single-child prefix before presenting "select your location").

Every selection is re-validated server-side at submit time against a
fresh `resolveBranchPoint`/membership query — the client's claimed
selection id is never trusted blindly: an unknown id is rejected with a
re-prompt (state preserved), and a location whose real `parentTerritoryId`
does not match the previously-selected territory is rejected the same way
(live-verified in §9 with a genuine cross-territory id).

The test fixture was rewritten to mirror the real seed's 4-level shape,
with a strict assertion that the presented territory options equal exactly
`['Ibadan North', 'Ibadan South-West']` and never contain `'Oyo State'`/
`'Ibadan'` — closing the coverage gap that let the original bug through.

## 6. Access Control and Security

- **No new permissions**: `ConversationController` reuses Sprint 32's
  `d2c.consumer.view` (list/get) and `d2c.consumer.manage` (send message)
  exactly as-is — driving a conversation is the same administrative
  capability as managing a consumer directly.
- **Internal/authenticated-only HTTP surface** (the brief's "safer
  architecture" choice, §22 of the brief): `ConversationController`
  (`/d2c/conversations`) requires `JwtAuthGuard` + the permissions above on
  every route. There is no public, unauthenticated webhook endpoint this
  sprint, since no real WhatsApp webhook exists yet to receive one. A
  future WhatsApp adapter calls `ConversationService` directly
  (in-process), never through this permission-gated surface.
  `organisationId` is always derived from the authenticated JWT, never
  trusted from the request body.
- **Tenant isolation**: every repository method takes `organisationId` and
  includes it in the query; every write is a conditional `updateMany`.
  Live-verified: unauthenticated request → `401`; a different tenant's
  valid token fetching another tenant's conversation by id → `404` (no
  existence leak); listing returns only the caller's own conversations;
  the _same_ phone number used by two different tenants resolves to two
  separate conversations/consumers with each tenant's own correct welcome
  text (§9).
- **Audit**: `consumer_conversation.started`, `.consumer_registered`,
  `.location_updated`, `.location_request_created`, `.reset` — all via
  the existing `AuditService.record()`, no parallel audit mechanism. A
  repeated idempotent registration attempt records only one
  `.consumer_registered` event.
- **Error handling**: `handleInboundMessage` wraps `dispatch()` in a
  try/catch; any unexpected error is logged server-side and the consumer
  sees a generic, friendly text response — no Prisma error, stack trace,
  internal id, or auth internal is ever returned on the conversational
  surface.

## 7. Access Control, Modules, Independence

`ConversationModule` imports exactly `IdentityModule`, `AuthModule`,
`TerritoryModule`, `ConsumerModule` — asserted structurally by
`conversation-independence.spec.ts`, which also confirms:
`ConversationService` mutates Consumer data only through
`this.consumerService.(registerConsumer|updateConsumerLocation|
reportLocationNotFound|findConsumerByPhone|getById)(...)` calls, never
`this.prisma` or a `ConsumerRepository` directly; no file in `src/d2c/`
defines or imports a WhatsApp-specific class/module (regex-checked against
actual code constructs, not prose — the domain may legitimately _discuss_
WhatsApp in comments to explain its absence); no cross-domain table write
outside the conversation's own two tables plus Consumer (via the service);
no second Consumer/Territory/phone-normalization concept anywhere in this
domain.

## 8. Testing

| Suite                               | Tests | Focus                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation.repository.spec.ts`   | 7     | idempotent find-or-create incl. genuine concurrent-race recovery, tenant isolation on create/find/update, `reset` clearing `context` via `Prisma.JsonNull`                                                                                                                                                                                                                                                  |
| `conversation.service.spec.ts`      | 11    | full multi-step registration flow against a realistic 4-level territory fixture (asserts exact branch-point-resolved options), existing-consumer recognition, invalid-territory and cross-territory-mismatch rejection, location-not-found → registration-still-completes, 5-way concurrent registration idempotency, `MENU` reset mid-flow, per-tenant welcome-text isolation, unrecognized-input handling |
| `conversation-independence.spec.ts` | 6     | no WhatsApp-specific code, no cross-domain writes, module import list, Consumer-data access only via `ConsumerService`                                                                                                                                                                                                                                                                                      |

**Sprint 33 total**: 24 new tests, all passing.

**Full API suite after all Sprint 33 changes (including the tenant-name
fix)**:

```
Test Suites: 221 passed, 221 total
Tests:       1912 passed, 1912 total
Snapshots:   0 total
Time:        21.5 s
```

This confirms zero regressions across every pre-existing domain
(Customer/Outlet/Territory/Sales/Identity/Access Control/Notifications/
Audit/Finance/HR/Recruitment/Sprint-32-Consumer all remain green) — the
new Sprint 33 conversation tests are additive on top of that same green
baseline, not a replacement for it.

## 9. Live Verification

All performed against the actual running dev server and real Postgres
database, using a genuine second organisation
(`Rival Snacks`, `owner@rivalsnacks.test`) created live via
`POST /auth/register` specifically to test cross-tenant isolation, plus
the existing seeded `Boby Bites` organisation (`owner@bobybites.local`).

1. **New-consumer registration, end to end**: unregistered phone → `hi` →
   "Welcome to Boby Bites 👋" with Yes/Register buttons → `REGISTER` →
   "What's your name?" → name text → territory list showing exactly
   `Ibadan North` / `Ibadan South-West` (not the single "Oyo State" root —
   confirming the branch-point fix) → territory selected → location list
   showing `Bodija` / `Mokola` / "❓ I can't find my location" → location
   selected → "You're registered 🎉 / Consumer ID: CON-000011" → main menu
   buttons.
2. **Existing-consumer recognition**: a phone already linked to a
   registered consumer immediately received `state: MAIN_MENU`,
   "Welcome back, {name} 👋" on its very first-ever message — the
   welcome/registration prompt was never shown.
3. **Invalid territory selection**: an unknown territory id was rejected
   ("That's not a valid option...") with the same valid list re-presented
   and state unchanged.
4. **Cross-territory location mismatch**: selected `Ibadan North`, then
   submitted `Challenge` (a real location, but one that belongs to
   `Ibadan South-West`) — rejected the same way, state preserved.
5. **Location-not-found → `ConsumerLocationRequest`**: selected
   "❓ I can't find my location", described the location in free text,
   registration completed anyway (Consumer ID: CON-000012,
   `territoryId: null`), and `GET /d2c/consumers/location-requests`
   confirmed a real `ConsumerLocationRequest` row was created with the
   exact submitted text — Sprint 32's mechanism, unchanged.
6. **Idempotency/concurrency**: primed a conversation to the
   "awaiting name" step, then fired 5 genuinely concurrent HTTP requests
   submitting the same name — exactly one `Consumer` (CON-000013) was
   created.
7. **Session reset**: sent `MENU` mid-`LOCATION_SELECTION` on an
   already-registered consumer — correctly reset to `MAIN_MENU` with
   "Welcome back," not to `NEW`.
8. **Security**: unauthenticated `POST /d2c/conversations/messages` → `401`;
   a different tenant's token fetching another tenant's conversation by id
   → `404`; a tenant's conversation list contained only its own rows.
9. **Cross-tenant isolation, including the tenant-name fix**: the exact
   same phone number sent to Tenant A produced "Welcome to Boby Bites 👋"
   and to Tenant B produced "Welcome to Rival Snacks 👋" — two separate
   conversation ids, each showing only its own organisation's real name
   (re-confirming the fix described in §2/§5 of the domain doc, verified
   again after the final rebuild described in §11 below).
10. **Internal test UI** (`/settings/d2c/conversation`), in an actual
    browser session, both desktop and mobile (375×812) widths: logged in
    as Boby Bites, started a fresh test conversation, clicked the
    rendered "Register" button, typed a name, clicked "Ibadan North",
    clicked "Bodija", and observed "You're registered 🎉 / Consumer ID:
    CON-000014" appear in the chat log exactly as the API returned it —
    confirming the UI is a faithful, unmodified rendering of the real
    contract, not a mocked demo.

## 10. Documentation

`docs/domains/d2c.md` §14–26 (new): architecture diagram, conversation
session/channel/state design rationale, the explicit "The Conversation
Layer is channel-neutral. WhatsApp is an adapter, not the business logic."
statement, registration-via-conversation reuse of Sprint 32, the
branch-point-resolution design decision and why it was needed, the main
menu's available-vs-deferred capability boundary, the full contract shape
with an explanation of future WhatsApp-adapter usage, the tenant-name bug
found during verification, the internal test UI's scope boundary
(explicitly not the Sprint 42 simulator), access control/audit additions,
deferred scope, and testing summary.

## 11. Deferred Scope

Explicitly not built this sprint, each with a stated target:

- Real WhatsApp/Meta integration (webhooks, templates, media) — no sprint
  number assigned in the brief; whenever the WhatsApp Channel Adapter
  itself is scheduled.
- The Sprint 42 consumer-facing simulator.
- Ordering (`ORDER_SNACKS → SELECT_PRODUCT → SELECT_QUANTITY →
REVIEW_ORDER → CONFIRM_ORDER`) — Sprint 34. Extension point documented:
  new `handle*` branches on the existing `dispatch()` switch plus the
  already-reserved `ConversationState.ACTIVE`; no new session
  infrastructure anticipated.
- My Points / My Rewards — Sprint 40.
- My Collection — Sprint 37.
- Promotions — Sprint 41.
- Outbound/proactive conversation messages driven by the existing
  Notification infrastructure — extension point documented (a future
  notification-processing job would call `ConversationService`/append an
  outbound `ConsumerConversationMessage` the same way an inbound reply
  does), not implemented.
- Any generic/reusable workflow engine for conversation state (the
  existing `ConversationState` enum + `context` bag is judged sufficient
  and intentionally not replaced with the heavier `WorkflowInstance`
  engine — see domain doc §17).

## 12. Quality Gates

- `npx prisma validate` — schema valid.
- `npx prisma migrate status` — 51 migrations, database up to date.
- `npx tsc --noEmit` (apps/api) — clean.
- `pnpm --filter api test` — 221 suites / 1912 tests passing, 0 failed.
- `eslint "src/d2c/**/*.ts"` — clean, no warnings.
- `pnpm --filter api exec nest build` — succeeds.
- `pnpm --filter web build` — succeeds; `/settings/d2c/conversation` built
  as a static route with no errors.

No pre-existing issues were encountered in any of the above; no issue was
suppressed or worked around — the two real bugs found during this sprint
(§5, and the tenant-name issue in §2/§9) were fixed at the root and
re-verified, not patched over.

## 13. Git Status

- **Branch**: `main`
- **HEAD**: `b7e769e` — "Sprint 32: Consumer Identity, Territory & Location
  Foundation" (Sprint 33 work is entirely uncommitted, per explicit
  instruction)
- **Modified**:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/app.module.ts`
  - `apps/api/src/retail/territory/territory.repository.ts`
  - `apps/web/src/components/workspace/navigation-config.ts`
  - `docs/domains/d2c.md`
  - `packages/validation/src/d2c.ts`
- **Untracked**:
  - `apps/api/prisma/migrations/20260928111641_sprint33_consumer_conversation_foundation/`
  - `apps/api/src/d2c/conversation/` (repository, message repository,
    service, controller, module, types, audit actions, and all three spec
    files)
  - `apps/web/src/app/(app)/settings/d2c/conversation/` (`page.tsx`,
    `api.ts`)
  - `docs/sprint-33-completion-report.md` (this file)

**No commit was made and nothing was pushed**, per explicit instruction —
all of the above is left uncommitted for review.
