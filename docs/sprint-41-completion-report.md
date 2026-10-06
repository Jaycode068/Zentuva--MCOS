# Sprint 41 — WhatsApp D2C Ordering & Commerce Conversation — Completion Report

## 1. Sprint Objective

Connect the real WhatsApp channel (Sprint 40.5, live-verified) to the D2C ordering
capabilities already built across Sprints 32–40, so a real consumer can register,
browse, select products, build a cart, confirm an order, and receive a payment link —
all through WhatsApp, and all resulting in the EXACT SAME `SalesOrder`/`Payment` records
the existing B2B/D2C architecture already produces. Explicit mandate: do not build a
parallel WhatsApp commerce system; extend existing domains only where the audit proves a
genuine gap.

## 2. Architecture Audited

Before any code was written, the following were audited (full detail:
`docs/domains/d2c.md` §115; raw audit findings preserved in this session's own working
notes):

- **Consumer/Identity**: unchanged since Sprint 32 — no gap found.
- **Conversation Layer**: `ConversationService` already had a COMPLETE Order Snacks
  state machine since Sprint 34 (`beginOrdering`/`handleOrdering`/`renderBrowsing`/
  `handleBrowsing`/`handleAwaitingQuantity`/`showCartMenu`/`handleCartMenu`/
  `presentRemoveOptions`/`handleAwaitingRemove`/`beginCheckout`/`handleAwaitingConfirm`/
  `handleAwaitingPayment`) — already calling `D2COrderingService`/`D2CPaymentService`,
  already producing a real `SalesOrder`/`Payment`. The ONLY missing piece was a real
  channel reaching it — which Sprint 40.5's generic Channel Adapter (built for
  registration, but never special-cased to it) already structurally provides.
- **WhatsApp (Sprint 40.5)**: `WhatsAppInboundAdapterService.handleWebhookPayload` calls
  `ConversationService.handleInboundMessage` for ANY conversation state, not just
  registration — confirmed by reading its dispatch logic, not assumed.
- **Product Catalogue**: `D2COrderingService.getAvailableProducts` already the single
  source of D2C-orderable products (`ACTIVE && FINISHED_PRODUCT && sellingPrice != null`)
  — reused unchanged. `Product.imageUrl` existed in the schema since Sprint 4.1 but was
  never surfaced into `D2CProductOption` — a genuine, small gap (brief §18).
  `D2COrderingService.getAvailableProducts` was also found to recompute products
  mid-conversation at selection time, confirming the existing "re-derive, never trust a
  stale client id" convention was already available to reuse.
  `D2COrderingService.listConsumerOrders` did NOT exist — single-order lookup
  (`getConsumerOrder`) was the only consumer-scoped read; a genuine gap for "My Orders".
- **Sales**: `SalesOrderService.createForConsumer` already fully idempotent
  (`@@unique([organisationId, idempotencyKey])`, P2002 race recovery) — the exact
  primitive a WhatsApp "Confirm Order" needs, unchanged.
  `SalesOrderService.listPaginated` already supported a `consumerId` filter (added
  Sprint 39 for D2C Admin) — directly reusable for "My Orders," never a new query path.
- **Payment**: `D2CPaymentService.initiatePayment` already idempotent/reentrant (same
  merchant reference reused every call; an existing `PENDING` payment with a
  `checkoutUrl` is returned as-is) — unchanged, reused as-is.
- **Rewards**: `LoyaltyService.getAccount`/`.listLedger` (Sprint 40) already fully
  consumer-scoped reads — a genuine gap was only the Conversation Layer WIRING (no
  `LoyaltyModule` import, no menu branch), never the underlying read logic.
- **D2C Admin (Sprint 39)**: `D2CAdminService.listOrders` filters only by
  `source: D2C` — completely channel-agnostic. No special-casing needed or added for
  WhatsApp-originated orders.

## 3. Files/Modules Changed

New:

- `apps/api/src/d2c/ordering/d2c-ordering-concurrency.integration.spec.ts`

Modified:

- `apps/api/src/d2c/conversation/conversation.types.ts` — `imageUrl?` on `TEXT`.
- `apps/api/src/d2c/conversation/conversation.service.ts` — `MY_ORDERS`/`MY_REWARDS`
  menu branches, product recap in `handleBrowsing`, `LoyaltyService` injected.
- `apps/api/src/d2c/conversation/conversation.module.ts` — imports `LoyaltyModule`.
- `apps/api/src/d2c/conversation/conversation.service.spec.ts` — harness + new tests.
- `apps/api/src/d2c/conversation/conversation-independence.spec.ts` — exact-imports
  guard extended to allow `LoyaltyModule` (and explicitly still forbid
  `PromotionModule`/`RewardModule`).
- `apps/api/src/d2c/ordering/d2c-ordering.types.ts` — `imageUrl` on `D2CProductOption`.
- `apps/api/src/d2c/ordering/d2c-ordering.service.ts` — `imageUrl` populated,
  `listConsumerOrders` added.
- `apps/api/src/d2c/ordering/d2c-ordering.service.spec.ts` — new tests.
- `apps/api/src/d2c/whatsapp/whatsapp-inbound-adapter.service.ts` — global option
  numbering, image-message support with text fallback.
- `apps/api/src/d2c/whatsapp/whatsapp-inbound-adapter.service.spec.ts` — new tests.
- `docs/domains/d2c.md`, `docs/domains/whatsapp.md`, `docs/backlog.md`,
  `docs/changelog.md`, `docs/roadmap.md`, `docs/domains/README.md`.

**No new table, no new Prisma migration, no new product/order/payment/consumer entity.**

## 4. Conversation Flow

Unchanged state machine, now genuinely reachable over real WhatsApp:
`NEW → REGISTRATION → LOCATION_SELECTION → MAIN_MENU → ACTIVE (BROWSING →
AWAITING_QUANTITY → CART_MENU → AWAITING_CONFIRM → AWAITING_PAYMENT) → MAIN_MENU`.
Main menu gained two real options: `MY_ORDERS`, `MY_REWARDS` (brief's own emoji
labels), alongside the existing `ORDER_SNACKS`/`MY_ACCOUNT`/`UPDATE_LOCATION`/`HELP`.

## 5. Product Browsing Flow

`handleBrowsing` now re-derives the selected product from `getAvailableProducts`
(mirroring the existing `AWAITING_TERRITORY` step's own "never trust a stale client id"
convention) BEFORE advancing state — an unpriced/unavailable or unknown SKU is now
rejected immediately, re-presenting the list, one step earlier than before (previously
it reached quantity entry before `addItemToCart`'s own defense-in-depth check caught
it). A valid selection shows a short recap (name, price, optional photo) before asking
for quantity.

## 6. Cart/Order-Draft Behavior

Unchanged — still a plain `CartLine[]` living in `ConsumerConversation.context`, never
a persistent cart table (brief §7's own instruction, already satisfied since Sprint 34).

## 7. Sales Order Integration

Unchanged — `D2COrderingService.confirmOrder` → `SalesOrderService.createForConsumer`.
The ONLY new code here is `listConsumerOrders` (read-only, reuses the existing
`consumerId` filter) for "My Orders."

## 8. Payment Handoff

Unchanged — `D2CPaymentService.initiatePayment` → the real `OpayPaymentProvider`,
unchanged Sprint 35 architecture. Live-verified: a real OPay sandbox `checkoutUrl`
delivered over WhatsApp as a `PAYMENT_REQUIRED` message (rendered as a clickable link in
plain text by the Sprint 40.5 adapter, unchanged rendering logic for this message type).

## 9. WhatsApp Integration

Two targeted fixes to `WhatsAppInboundAdapterService` (Sprint 40.5's own file):

1. **Global option numbering** (the one genuine bug the audit's live testing found): a
   single Conversation Layer response can carry two option-bearing messages at once
   (product `LIST` + "View Cart & Checkout" `BUTTONS`); numbering each independently
   made a numeric reply ambiguous. Fixed with a running offset across the whole batch
   plus a flattened, order-preserving option list for reply matching.
2. **Image messages**: a `TEXT` message with `imageUrl` is sent via `sendImage`
   (caption = text), falling back to `sendText` of the same caption on failure.

## 10. Idempotency Strategy

Two independent, pre-existing layers, both reused unchanged:
`WhatsAppWebhookEventRepository.tryClaim` (Sprint 40.5, keyed by Meta's own message id)
stops a genuinely redelivered webhook before it ever reaches the Conversation Layer;
`@@unique([organisationId, idempotencyKey])` on `SalesOrder` (Sprint 34) stops a
manually-repeated "Confirm" (a distinct message, same `checkoutIdempotencyKey` from
`conversation.context`) from ever creating a second order.

## 11. Concurrency Protection

New real-PostgreSQL proof: `d2c-ordering-concurrency.integration.spec.ts` — 5
genuinely concurrent `SalesOrderService.createForConsumer` calls with the SAME
idempotency key produce exactly 1 `SalesOrder` row (never 5); a different key for the
same consumer/cart correctly creates a genuinely separate order. Run via
`pnpm run test:integration`, alongside the unchanged Sprint 37.1 and Sprint 40 suites.

## 12. Tenant Isolation

Unchanged — every touched method (`getAvailableProducts`, `listConsumerOrders`,
`getAccount`/`listLedger`) already takes and enforces `organisationId`. No shortcut
introduced because the channel is WhatsApp.

## 13. Security Considerations

No new secrets, no new token, no new logging of sensitive values. `WHATSAPP_TOKEN`
continues to flow only through the existing, already-audited `MetaWhatsAppProvider`
path. One genuine incident occurred and is documented transparently in §17.

## 14. Automated Tests

Before (Sprint 40.5 end state): 250 suites / 2249 tests.
After: 250 suites / 2260 tests.
Net new: 11 tests across `conversation.service.spec.ts` (MY_ORDERS/MY_REWARDS, product
recap, the two re-targeted product-rejection tests), `d2c-ordering.service.spec.ts`
(`imageUrl` surfacing, `listConsumerOrders`), and
`whatsapp-inbound-adapter.service.spec.ts` (global numbering, image send + fallback).

**Result: 250/250 suites passing, 2260/2260 tests passing, 0 regressions.**

## 15. Full Regression Results

`pnpm run test:integration` (real PostgreSQL): 3/3 suites, 14/14 tests —
`inventory-stock-concurrency` (Sprint 37.1), `promotions-concurrency` (Sprint 40), and
the new `d2c-ordering-concurrency` (Sprint 41), all green. Explicitly re-verified per
brief §28:

- Sprint 40.5: webhook GET verification, inbound message handling, text/template/image
  outbound, message idempotency — all unchanged and re-exercised live this sprint.
- Sprint 40: promotion/reward/loyalty architecture untouched; `conversation-independence
.spec.ts` explicitly guards that `ConversationModule` still never imports
  `PromotionModule`/`RewardModule`.
- Sprint 39: D2C Admin dashboard/order visibility — confirmed live, `SO-000034` appeared
  with zero code changes.
- Sales: `d2c-ordering-independence.spec.ts` and the full Sales suite pass unchanged;
  B2B order creation untouched (no shared code path was modified in a B2B-visible way).
- Payment: existing OPay webhook/verification untouched.

## 16. Build / Typecheck / Lint Results

- `tsc --noEmit` (`apps/api`) — clean.
- `eslint` on every new/modified file — clean, zero warnings.
- (No `apps/web` changes this sprint — the brief's own scope boundary (§24) explicitly
  discourages a second admin app; the existing `/settings/d2c/whatsapp-test` and
  `/settings/d2c/orders` screens already needed no changes to show this sprint's work.)

## 17. Real WhatsApp Test Results

All performed against the REAL Meta Graph API (`WHATSAPP_PROVIDER_MODE=meta`), using an
allow-listed test recipient on this WhatsApp Business app (still in Meta's development
mode). Full detail: `docs/domains/d2c.md` §118. Summary, matching the brief's own
Tests A–H:

- **A (registration)**: real "Hi" → "Register" → name → territory → location → a real
  new `Consumer` (`CON-000037`), MAIN_MENU shown with the new menu options.
- **B (browse)**: real, un-hardcoded products from the live catalogue.
- **C (selection)**: product recap shown (no image existed for these SKUs — the
  text-only fallback was genuinely exercised, not just unit-tested).
- **D (multi-item + the numbering fix)**: a two-product cart built correctly; replying
  "1" against a combined LIST+BUTTONS batch correctly selected the LIST's product, not
  the BUTTONS option — the exact bug §9 describes, proven fixed against real Meta
  webhook traffic.
- **E (confirm)**: a real `SalesOrder` (`SO-000034`, 2 items, ₦2,100) created.
- **F (payment handoff)**: a real OPay sandbox checkout URL generated and genuinely
  DELIVERED over WhatsApp — confirmed via `MetaWhatsAppProvider`'s own "WhatsApp
  accepted message `wamid...`" log line for the actual send, not just database state.
- **G (admin visibility)**: `SO-000034` confirmed at the top of the real, unmodified
  `/settings/d2c/orders` list.
- **H (duplicate webhook)**: the SAME Meta message id redelivered 3 times produced
  exactly 1 `SalesOrder` and exactly 1 `WhatsAppWebhookEvent` dedup row.
- **Bonus**: "My Orders" and "My Rewards" both exercised live and delivered —
  `SO-000034 — Payment Pending` and a `0`-point balance respectively (correct: no
  promotion had qualified yet, since Sprint 40's own evaluation only fires on confirmed
  payment).

Two genuine, external incidents were found and resolved live, not hidden:

1. A freshly-regenerated `WHATSAPP_TOKEN` was pasted into `.env` by APPENDING rather
   than replacing the previous value, producing one malformed, doubled token string.
   Diagnosed precisely by calling Meta's Graph API directly (bypassing the app entirely)
   and inspecting the raw response — confirmed as a credential-formatting issue, not a
   code defect. Fixed by overwriting the `.env` line with exactly the single correct
   value.
2. A brief, separate transient `403` / Meta code `131005` ("problem with the access
   token or permissions") self-resolved within roughly two minutes of the token being
   generated — confirmed by a direct, bypass-the-app `curl` call succeeding once
   retried, isolating it as a Meta-side propagation delay, not an application defect.

## 18. Database/Admin Verification

Confirmed via direct Prisma queries after every step (not inferred from HTTP 200
responses alone): `ConsumerConversation.state`/`.context` transitions at each step;
`WhatsAppWebhookEvent` row count for the duplicate-webhook test; `SalesOrder`/
`SalesOrderItem` rows for the confirmed order; the real OPay `checkoutUrl` persisted on
the `Payment` row. Confirmed via the real web admin UI: `SO-000034` visible in
`/settings/d2c/orders` with correct status/consumer/total.

## 19. Known Limitations

See `docs/domains/d2c.md` §119 and `docs/domains/whatsapp.md` §9 (updated this sprint):
real WhatsApp interactive button/list messages remain future work (numbered plain text
continues — this sprint only fixed the numbering/matching logic underneath, not the
rendering style); webhook signature verification remains conditionally disabled
(`WHATSAPP_APP_SECRET` still unset); this WhatsApp Business app remains in Meta's
development mode (allow-listed test recipients only); one shared WhatsApp Business
phone number across all tenants (Sprint 40.5's own documented limitation, unchanged).

## 20. Deferred Work

Per the brief's own explicit scope boundary (§30), none of the following were built:
Collection Point fulfilment/inventory deduction, broadcast/marketing messaging, a new
payment provider, complex promotion rules, new loyalty rules, a consumer mobile app, or
any generic chatbot/workflow engine. Real WhatsApp interactive messages (replacing the
numbered-text rendering) remain a natural next step, not started this sprint.

## 21. Confirmation: No Duplicate D2C/WhatsApp Domain Introduced

No `WhatsAppOrder`, `WhatsAppOrderItem`, `WhatsAppProduct`, `WhatsAppConsumer`,
`WhatsAppPayment`, `WhatsAppReward`, parallel product catalogue, or parallel order state
machine was created. Every order created through WhatsApp this sprint is a real,
ordinary `SalesOrder` row (`source: D2C`), created through the exact same
`SalesOrderService.createForConsumer` every other D2C order already uses, visible
through the exact same admin views with zero special-casing. `ConversationModule`'s
import list remains a small, explicit, structurally-guarded allow-list
(`conversation-independence.spec.ts`) — `LoyaltyModule` was added for a read-only
"My Rewards" view; `PromotionModule`/`RewardModule` remain explicitly, executably
forbidden from ever being imported there.

## Git Status

All changes remain uncommitted and unpushed, per the brief's explicit final instruction
("Do not commit or push anything. Leave all changes uncommitted for my review.").
