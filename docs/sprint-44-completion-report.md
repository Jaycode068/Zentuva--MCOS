# Sprint 44 — Tenant D2C Conversation Configuration — Completion Report

## 1. Objective

Every tenant's WhatsApp conversation (Sprints 33/34/35/41/42/43.5) has so far spoken
with exactly one voice — Boby Bites' own hardcoded welcome text, menu labels, and
wording baked directly into `ConversationService`. This sprint places a controlled,
tenant-scoped **configuration** layer in front of that already-proven state machine, so
a second tenant can have its own business identity, welcome message, menu
labels/ordering/enabled capabilities, and customer-facing wording — **without** a second
conversation engine, per-tenant code branches, a generic chatbot/rules engine, or any
Boby-Bites-specific code anywhere in the stack:

```
WhatsApp → WhatsApp Adapter → ConversationService → Conversation Config Resolver → Tenant Configuration → Existing D2C Domain Services
```

The governing principle, unchanged from the brief: **one shared conversation engine,
tenant-scoped configuration. Configuration, not code.**

## 2. Existing Architecture Audited

Before writing anything, confirmed:

- `ConversationService.handleInboundMessage` (Sprint 33) is the one entry point both the
  real Meta WhatsApp webhook (`WhatsAppInboundAdapterService.handleWebhookPayload` →
  `processInboundMessage`) and the admin Conversation Tester
  (`ConversationController.sendMessage`) already converge on — confirmed by direct
  inspection of both call sites, not assumed. Any configuration wired into this one
  method is automatically honored by every channel that reaches it, with zero extra
  wiring.
- `Organisation.settings Json` is explicitly reserved, by its own doc comment, for
  low-cardinality behavioral toggles that don't warrant their own columns — not the
  established pattern for anything with real structure or validation needs.
  `NotificationPreference`/`CashflowSettings` (typed, one-row-per-scope tables) are the
  correct, established precedent for exactly this shape of requirement (a capability
  list with ordering, a message catalogue) — confirmed this is the dominant pattern, not
  an exception.
- `CollectionPointFulfillmentService.notifyReady`/`notifyCollected` also hardcode
  tenant-identity-bearing customer-facing text (`READY_FOR_COLLECTION`/
  `COLLECTION_CONFIRMED`) outside `ConversationService` entirely — deliberately brought
  into the SAME configuration resolver rather than left as a second, un-configurable
  surface, since the brief's own message-catalogue examples explicitly name this
  category.
- `packages/ui` has no Switch/Toggle component — `Checkbox` is the correct, available
  primitive for capability enable/disable toggles.
- The shared `Field`/`ReadOnlyField` components (`apps/web/src/components/app/settings-
field.tsx`, Sprint 3.4) and the `react-hook-form` + TanStack `useMutation` admin-form
  pattern (`branding-tab.tsx`) were reused, not rebuilt.

## 3. Configurable vs. Platform-Controlled Boundary

**Tenant-configurable:** business display name (reused from `Organisation`, not
duplicated), support phone/email override, 6 main-menu capabilities'
enabled/label/sortOrder, 14 curated customer-facing message strings.

**Platform-controlled, never exposed as editable:** the internal capability identifier
(`ORDER_SNACKS`, `MY_ORDERS`, etc. — routing stays fixed regardless of display label),
the conversation state machine itself, every domain service `ConversationService` calls
(Consumer/Territory/Ordering/Payment/Loyalty/Collection Point Fulfilment), the channel
adapter layer, the `{{variable}}` substitution mechanism and its per-key allowlist.

Deliberately curated to exactly 14 message keys (out of ~50+ raw strings found in the
pre-Sprint-44 `conversation.service.ts`) — covering General/Registration/Ordering-
Payment/Collection/Account, per the brief's own category examples — rather than making
every single string configurable, per the brief's own explicit "avoid configuration
explosion" warning.

## 4. Data Model

Three new, purely additive tables (migration
`20261009090000_sprint44_tenant_conversation_config`), each independently keyed by
`organisationId` alone:

- **`D2CConversationCapabilityConfig`** (`organisationId, capability` unique) —
  `enabled`, `displayLabel` (nullable — null means "use the platform default label"),
  `sortOrder`.
- **`D2CConversationMessageConfig`** (`organisationId, messageKey` unique) — `value`.
- **`D2CConversationProfile`** (`organisationId` unique) — `supportPhoneOverride`,
  `supportEmailOverride`.

Two new enums, `D2CConversationCapability` (6 values) and `D2CConversationMessageKey`
(14 values) — a controlled registry, not an arbitrary string. `prisma migrate diff`
confirmed before writing: 2 new enums, 3 new tables, zero drops, zero column changes to
any existing table.

## 5. Default Configuration & Zero-Code Onboarding

**Absence = platform default, no row needed.** A brand-new tenant requires ZERO rows in
any of the three tables to get full, correct, byte-identical-to-pre-Sprint-44 behavior —
`resolveEffectiveConfig` falls back to `DEFAULT_CAPABILITY_LABELS`/
`DEFAULT_CAPABILITY_ORDER`/`DEFAULT_CAPABILITY_ENABLED`/`DEFAULT_MESSAGES`
(`d2c-conversation-config.types.ts`) at every field, independently. This is the
intentional answer to "safe zero-code tenant onboarding" — no `seed.ts` change was made
or needed, confirmed functionally by all 2348 pre-existing tests (none of which create
any `D2CConversation*Config` row) continuing to pass with unchanged behavior.

`DEFAULT_MESSAGES`' 14 values are the pre-Sprint-44 hardcoded strings extracted
verbatim — this sprint changes nothing about what Boby Bites' consumers see until an
admin actively customizes something.

## 6. Capability Registry — Stable Identifier, Configurable Label

Internal capability routing (`ORDER_SNACKS`, `MY_ORDERS`, `MY_REWARDS`, `MY_ACCOUNT`,
`UPDATE_LOCATION`, `HELP`) is a fixed Prisma enum — never a free-text tenant value.
Only `displayLabel`/`enabled`/`sortOrder` are tenant data. A tenant renaming "Order
Snacks" to "Shop Boby Treats" changes the DISPLAY LABEL only — the alias table and the
menu's routed `value` both key off the stable internal identifier, never the label,
proven by a dedicated unit test and by the live verification in §15 (sending "1" under
the renamed label still entered the real Order Snacks/Browsing flow).

**Disabled capability = unmatched input, not a special error.** `handleMainMenu` checks
`isCapabilityEnabled(config, matchedCapability)` and, if disabled, falls through to the
exact same `UNKNOWN_COMMAND` + menu response any other unrecognized input produces — no
special-casing, and this applies uniformly regardless of how the value was resolved
(stale numbered reply, exact text alias, or the literal internal command string typed
directly). Proven by a unit test and live (§15).

## 7. Message Catalogue & Safe Template Substitution

14 keys (`WELCOME`, `MAIN_MENU_PROMPT`, `HELP`, `UNKNOWN_COMMAND`, `ASK_NAME`,
`REGISTRATION_COMPLETE`, `LOCATION_UPDATED`, `ASK_QUANTITY`, `ORDER_CREATED`,
`PAYMENT_SUCCESS`, `MY_ORDERS_EMPTY`, `READY_FOR_COLLECTION`, `COLLECTION_CONFIRMED`,
`ORDER_CANCELLED`), each with its own explicit `MESSAGE_VARIABLE_ALLOWLIST` entry (most
empty, `WELCOME: ['businessName']`, `ORDER_CREATED: ['orderCode','currency','total',
'status']`, etc.).

`renderConversationMessage(messageKey, template, variables)` is a plain regex
`/\{\{(\w+)\}\}/g` substitution — `\w+` has no dots, so `{{order.total}}`-style
property-path tokens are structurally impossible to match (verified by a dedicated
test: left completely untouched, never evaluated). Only a variable name present in that
specific key's own allowlist is substituted; anything else — including a genuinely
unexpected variable name within an otherwise-allowed key — is left as literal
`{{...}}` text, never blanked, never evaluated as code. Every `variables` argument at
every call site is always a plain, already-resolved `{name: string|number}` object the
caller computed — never a live domain entity passed through for property access.
Server-side validation (`assertValidMessageValue`) rejects a save containing any
variable name outside that key's allowlist, before it ever reaches the database.

## 8. Tenant Isolation

Proven at three levels:

- **Unit** (`conversation.service.spec.ts`, "Sprint 44" block) — two separate
  `makeHarness(ORG_A)`/`makeHarness(ORG_B)` instances, each with its own mocked
  `configService.resolveEffectiveConfig`, confirm each tenant's welcome response
  contains only its own business name and capability labels, never the other's.
- **Real PostgreSQL** (`d2c-conversation-config-concurrency.integration.spec.ts`) —
  concurrent capability saves for two real tenants never cross-contaminate; a read for
  Tenant A during a Tenant B write storm never observes Tenant B data.
- **Real PostgreSQL, through the admin service methods themselves**
  (`d2c-conversation-config-active-safety.integration.spec.ts`, "Final Architectural
  Test") — `getAdminView`/`getPreview` called for two real organisations with two
  genuinely different saved configurations never leak one tenant's welcome text or
  capability label into the other's admin view or preview response.
- **Live, over real Meta WhatsApp traffic** — see §15.

## 9. API Surface

`D2CConversationConfigController` (`d2c/conversation-config`):

| Route                             | Permission                |
| --------------------------------- | ------------------------- |
| `GET /`                           | `d2c.conversation.view`   |
| `GET /preview`                    | `d2c.conversation.view`   |
| `PUT /profile`                    | `d2c.conversation.manage` |
| `PUT /capabilities`               | `d2c.conversation.manage` |
| `PUT /messages/:messageKey`       | `d2c.conversation.manage` |
| `PUT /messages/:messageKey/reset` | `d2c.conversation.manage` |

Every write returns the fresh `getAdminView()` so the admin UI never needs a second
round trip. `updateCapabilities` always receives and validates the FULL desired
capability set (never a partial patch), written inside one `$transaction` — a
validation failure or mid-save error never leaves a half-updated menu.

## 10. Admin UI

`/settings/d2c/conversation-settings` (the brief's suggested `/settings/d2c/
conversation` path was already taken by the Sprint 33 Conversation Tester) — four
sections: **Profile** (support phone/email override with a "customized" vs "using
organisation default" indicator), **Main Menu** (enabled checkbox, label input,
sort-order input, client-side duplicate/empty-menu guards supplementing the server's
own authoritative validation), **Customer-Facing Messages** (grouped by category,
current value, allowed-variables hint, customized badge, per-key reset-to-default), and
**Conversation Preview**. Added to `d2c-tabs.tsx`'s segment-aware route list — confirmed
no collision with the existing `/settings/d2c/conversation` (Tester) or
`/settings/d2c/conversations` (transcript viewer) routes, since the match requires an
exact path or a `/`-prefixed continuation, and `-settings` is neither.

## 11. Preview — No Second Rendering Implementation

`getPreview()` calls `resolveEffectiveConfig` then the SAME `buildWelcomeMessage`/
`buildMainMenuMessages` pure functions `ConversationService` itself calls — the preview
can never show an admin something the real conversation wouldn't actually send. Proven
directly: the Final Architectural Test integration test (§8) calls `getPreview` for two
real tenants and confirms each preview's JSON contains only that tenant's own saved
text.

## 12. ConversationService Integration

`handleInboundMessage` resolves config exactly once per inbound message
(`D2CConversationConfigService.resolveEffectiveConfig(organisationId)`) and threads the
resulting `EffectiveConversationConfig` object through `dispatch()` and every state
handler — replacing the prior `organisationName: string` parameter and every hardcoded
customer-facing string, including through the entire ordering sub-flow
(`beginOrdering`, `handleOrdering`, `renderBrowsing`, `handleBrowsing`,
`handleAwaitingQuantity`, `handleCartMenu`, `presentRemoveOptions`/
`handleAwaitingRemove`, `beginCheckout`, `handleAwaitingConfirm`,
`handleAwaitingPayment`, `handleReset`). Resolving once per turn and passing the result
down, rather than re-querying mid-turn, is what guarantees a config change landing
between two turns can never produce a response mixing old and new wording within a
single reply — proven directly in §13.

`CollectionPointFulfillmentService.notifyReady`/`notifyCollected` were widened to call
the same resolver for `READY_FOR_COLLECTION`/`COLLECTION_CONFIRMED`, removing their
previously-sole dependency on `OrganisationService` (now redundant and removed from that
constructor).

**Known, accepted minor behavior difference:** address/operating-hours now render as
blank lines (empty-string substitution) rather than being omitted entirely when absent —
judged acceptable; a tenant can customize the template if this matters to them.

## 13. Active-Conversation Safety

`d2c-conversation-config-active-safety.integration.spec.ts`, against real PostgreSQL:
created a real `ConsumerConversation` row mid-flow (`ACTIVE` / ordering sub-state
`ORDER_CONFIRMATION`, a real cart in `context`), then performed real admin
`updateMessage`/`updateCapabilities` calls for the same tenant, then re-read the
conversation row and confirmed every field — `state`, `context`, `consumerId`,
`updatedAt` — byte-identical to before. This holds structurally, not by luck:
`ConsumerConversation` and the three `D2CConversation*Config` tables are entirely
separate, with no trigger or cascade linking them (only an `organisationId`→
`Organisation` cascade-on-delete, unrelated to a configuration edit). A second test in
the same file confirms the OTHER half of the safety property: the very next
`resolveEffectiveConfig` call DOES reflect the change — nothing is stuck on a stale
cache; a config edit takes effect starting the next turn, never corrupting the turn in
flight.

## 14. Access Control & Audit

Two new `SCOPABLE` permissions, `d2c.conversation.view`/`d2c.conversation.manage`
(`permission-catalogue.ts`), reusing the EXISTING configurable permission system —
`EffectiveAccessResolver` + `isOwnerBypass` — never a hardcoded role check. Not granted
to Member at seed time, matching the `d2c.communication.*` precedent (a brand/identity
configuration surface, not a routine operational task).

Every write (`updateProfile`, `updateCapabilities`, `updateMessage`,
`resetMessageToDefault`) calls `AuditService.record()` with a field-level `{old, new}`
diff in `metadata` — a genuinely new shape (no prior exact precedent; the two closest,
`CashflowSettingsController` and `SettingsController.updateWorkspace`, either dump the
whole new row or record only changed field names), but the audit MECHANISM itself is
fully reused — same `AuditLog.metadata: Json` field, same `record()` signature.

## 15. Live Verification (Real Meta WhatsApp API)

Performed against the REAL Meta Graph API (`WHATSAPP_PROVIDER_MODE=meta`, confirmed via
a live read-only Graph API call that `WHATSAPP_PHONE_NUMBER_ID` resolves to
`+234 707 506 8241`, "Boby Bite"), with the real seeded Boby Bites tenant
(`cmt962ypb00077bjpz2wew4mz`) and a real, already-registered test consumer ("Live Test
Shopper", `+2348038331161`). Inbound delivery used the same technique established in
Sprint 40.5 (Meta cannot reach `localhost` without a public tunnel, never set up): a
realistic Meta-shaped webhook payload POSTed directly to the local `/api/whatsapp/
webhook` endpoint. Every OUTBOUND reply below was a genuine send through Meta's live
API, confirmed by a real WAMID recorded on the real `ConsumerWhatsAppDelivery` row and
delivered to the real phone:

1. **Capability rename displays correctly, live** — `ORDER_SNACKS` relabeled to
   "🛍️ Shop Boby Treats"; the real main-menu message sent via Meta showed the new label
   at its configured position.
2. **Disabled capability disappears from the real menu** — `MY_REWARDS` disabled; the
   real menu Meta delivered had only 5 options, no Rewards entry.
3. **Disabled capability rejected on direct invocation, live** — sent the real alias
   text `"rewards"`; Meta delivered back "Sorry, I didn't understand that." plus the
   same 5-option menu — never a rewards response, never an error.
4. **Message-catalogue customization delivered live** — `MAIN_MENU_PROMPT` customized to
   a distinctive test string; the real "menu" command's Meta-delivered reply showed the
   customized text verbatim.
5. **Reset-to-default takes effect live** — the `MAIN_MENU_PROMPT` row deleted (reset);
   the next real "menu" command's Meta-delivered reply showed the platform default text
   ("What would you like to do?") again.
6. **Renamed capability still ROUTES correctly, live** — sent `"1"` (the renamed
   capability's real menu position); the real Meta-delivered reply was the genuine Order
   Snacks product list — proving the label rename never broke the stable internal
   routing.
7. **Cancel never touches a business record** — sent `"cancel"` from inside the real
   Browsing flow; conversation returned to `MAIN_MENU` with `context: null`; confirmed
   via direct database query that no new `SalesOrder` was created.

All test configuration (message/capability rows) was deleted after verification,
restoring Boby Bites to its exact pre-test state (zero rows in all three new tables,
same as every other un-customized tenant). The test server was run with
`WHATSAPP_PROVIDER_MODE=meta` passed as a one-off process environment override — `.env`
itself was never edited and remained `local` throughout and after.

## 16. Concurrency Tests (Real PostgreSQL)

`d2c-conversation-config-concurrency.integration.spec.ts` — 5 scenarios: two concurrent
updates to the same message key resolve to exactly one, never a torn write; concurrent
updates to different keys never interfere; a concurrent update+reset-to-default on the
same key resolves to one consistent state (update survives or row is fully gone, never
half-written); concurrent capability saves for two tenants never cross-contaminate; a
read for Tenant A during a Tenant B write storm never observes Tenant B data.
`d2c-conversation-config-active-safety.integration.spec.ts` — 3 scenarios, see §8/§13.

## 17. Test Results

- `pnpm exec jest` (unit): **255 suites / 2348 tests passing**, 0 failures. New this
  sprint: 22 tests (`d2c-conversation-config.service.spec.ts`), 8 tests
  (`d2c-conversation-config-rendering.spec.ts`), 2 tests (`conversation.service.spec.ts`
  "Sprint 44" block) — 32 new tests, 2 new suites.
- `pnpm run test:integration`: **8 suites / 33 tests passing**, 0 failures. New this
  sprint: 5 tests (concurrency), 3 tests (active-safety / Final Architectural Test) — 8
  new tests, 2 new suites.
- Full regression confirmed: every pre-existing D2C/WhatsApp/Collection Point
  Fulfilment suite still passes unchanged after the live-verification run.

## 18. Build / Typecheck / Lint Results

- `tsc --noEmit` (API): clean.
- `tsc --noEmit` (web): clean.
- `tsc --noEmit` (`packages/validation`): clean.
- `eslint` on every new/modified file across `apps/api`, `apps/web`, and
  `packages/validation`: clean after fixing one `react/no-unescaped-entities` finding in
  the new admin page.
- `pnpm run build` (web, full site): clean — the new `/settings/d2c/conversation-
settings` route built successfully as a static page.
- `npx prisma validate`: schema valid.

## 19. Known Limitations

- `READY_FOR_COLLECTION`/`COLLECTION_CONFIRMED` now render address/operating-hours as
  blank lines rather than omitting them entirely when absent (§12) — a tenant can
  customize the template if this matters.
- The admin UI's client-side capability/message validation is supplementary only — the
  server (`assertValidCapabilitySet`/`assertValidMessageValue`) is the sole source of
  truth, matching every other settings surface in this codebase.
- Live verification's inbound half remains simulated (a realistic payload POSTed
  directly to the local webhook), unchanged from every prior sprint's own documented
  limitation — no public tunnel/production deployment exists for Meta to reach this
  environment directly. Every outbound reply was, however, a genuine Meta API call.
- This WhatsApp Business app remains in Meta's development mode (an existing, unchanged
  limitation) — the test recipient used was already allow-listed from a prior sprint's
  live verification.

## 20. Deferred Work

Per the brief's own explicit scope boundary: no generic chatbot/rules/workflow engine,
no per-tenant code branches, no JSON-blob configuration. Also deferred, as genuinely out
of scope: per-tenant WhatsApp Business Account provisioning (unchanged Sprint 40.5
limitation — one shared Business phone number across tenants); a richer template
language beyond flat `{{variable}}` substitution (conditional sections, loops); bulk
import/export of a tenant's configuration; a configuration changelog/diff view in the
admin UI beyond the existing audit log.

## 21. Files Changed

**New (backend):**

- `apps/api/prisma/migrations/20261009090000_sprint44_tenant_conversation_config/`
- `apps/api/src/d2c/conversation-config/` (14 files: types, rendering, 3 repositories,
  service, audit-actions, controller, module, and their specs — 2 unit specs + 2
  integration specs)

**New (frontend):**

- `apps/web/src/app/(app)/settings/d2c/conversation-settings/{page.tsx,api.ts}`

**Modified (backend):** `prisma/schema.prisma` (2 new enums, 3 new tables); `d2c/
conversation/conversation.{service,module}.ts` + `conversation-independence.spec.ts` +
`conversation.service.spec.ts`; `d2c/fulfillment/collection-point-fulfillment.
{service,module}.ts` + `collection-point-fulfillment-independence.spec.ts` +
`collection-point-fulfillment.service.spec.ts`; `identity/authorization/permission-
catalogue.ts`; `packages/validation/src/d2c.ts`.

**Modified (frontend):** `components/app/d2c-tabs.tsx`.

**Diff summary:** 13 tracked files changed (excluding new files), 634 insertions, 170
deletions.

## 22. Database / Migration Status

One migration, confirmed additive-only via `prisma migrate diff` before writing it: 2
new enums (`D2CConversationCapability`, `D2CConversationMessageKey`), 3 new tables
(`d2c_conversation_capability_configs`, `d2c_conversation_message_configs`,
`d2c_conversation_profiles`), each with a unique constraint scoping it to
`organisationId` (+ `capability`/`messageKey` where applicable) and a cascade-on-delete
FK to `Organisation`. Zero existing columns changed, zero data migration needed —
applied via `prisma migrate deploy` (the established non-interactive workaround for
`prisma migrate dev`'s "non-interactive environment" failure); `prisma generate`
re-run; `prisma validate` clean.

## 23. Final Architectural Test

Demonstrated directly, not just asserted: `d2c-conversation-config-active-safety
.integration.spec.ts`'s last test configures TWO real organisations with two genuinely
different `WELCOME` messages and two different `ORDER_SNACKS` labels, then calls
`getAdminView`/`getPreview` — the exact same service methods both the admin UI and the
real conversation preview use — for each, concurrently, and confirms neither tenant's
response ever contains the other's text. Separately, the live Meta verification (§15)
proves the SAME `ConversationService` class served Boby Bites' customized experience
end to end over real WhatsApp traffic, with zero Boby-Bites-specific code anywhere in
`ConversationService`, `D2CConversationConfigService`, or the rendering functions — every
line of customization lived in configuration rows, never in a conditional branch keyed
on an organisation id or name.

## 24. Final Assessment

The existing conversation engine (Sprints 33/34/35/41/42/43.5) needed no redesign — the
audit's main finding was that `handleInboundMessage` was already the correct single
entry point for every channel, and the only real gap was that tenant identity and
wording were hardcoded rather than resolved. This sprint closed exactly that gap: a
typed, three-table configuration model (never a JSON blob), a stable capability
registry (internal id fixed, label/order/enabled configurable), a curated 14-key
message catalogue with safe allowlisted substitution, a single resolver reused
identically by the real conversation, the admin preview, and the Conversation Tester,
and a dedicated admin UI — all proven not just by unit tests but by real-PostgreSQL
concurrency/isolation/active-conversation-safety tests and a genuine live run against
Meta's WhatsApp API that renamed a capability, disabled one, customized a message, reset
it, and confirmed routing integrity, tenant isolation, and SalesOrder safety every step
of the way. 255 suites / 2348 unit tests and 8 suites / 33 integration tests passing, 0
regressions.

**NO COMMIT / NO PUSH** — per this sprint's explicit, standing instruction.
