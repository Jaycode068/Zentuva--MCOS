# Sprint 34 Completion Report — D2C Consumer Ordering

## 1. Executive Summary

Built D2C Consumer Ordering entirely as an extension of Zentuva's existing
Sales Order domain, never a parallel order system. A registered Consumer,
through the existing Sprint 33 Conversation Layer, can now: browse the
tenant's own D2C-orderable products, build a multi-item cart, review an
order summary, and confirm it — producing a real, ordinary `SalesOrder` +
`SalesOrderItem`s, with server-authoritative pricing and idempotent,
concurrency-safe creation.

```
Conversation Layer (Sprint 33, extended)
        ↓
D2COrderingService  (new, apps/api/src/d2c/ordering/)
        ↓
SalesOrderService.createForConsumer  (existing service, new entry point)
        ↓
SalesOrder + SalesOrderItem  (existing model, Sprint 4.8)
```

No `ConsumerOrder`/`D2COrder` model, no second order-numbering system, no
second product catalogue, no second inventory/reservation mechanism, and
no second idempotency architecture were created — every one of these
would have been a parallel system the brief explicitly forbade, and none
was needed.

Two real, non-trivial gaps were found during the mandatory pre-
implementation audit (not invented — genuinely missing): the Product
Catalogue had **no pricing field at all**, and `SalesOrder.customerId` was
a required FK that structurally could not represent a Consumer without
either converting it into a `Customer` or fabricating a placeholder one.
Both were resolved with the smallest additive schema changes the brief
itself anticipated (§2 "Order Source/Channel," and its own explicit
allowance to loosen a "fundamentally required" relationship rather than
fake it) — detailed in §2 below.

One real bug was found and fixed during this sprint's own live
verification (not by unit tests): when a tenant's D2C catalogue was empty,
the conversation displayed main-menu buttons without actually leaving its
`BROWSING` state, so the next click was misrouted as a product selection.
Fixed, covered by a new regression test, and re-verified live.

## 2. Architecture Decisions

**Consumer → SalesOrder relationship.** `SalesOrder.customerId`/
`.salesAgentId` became nullable; a new nullable `consumerId` (FK to
`Consumer`, `Restrict`) was added. `customerId`/`consumerId` are mutually
exclusive, enforced by a DB-level `CHECK` constraint (hand-added to the
migration SQL — Prisma's schema DSL has no multi-column `CHECK`) plus
service-level construction. This is the smallest change that lets a real
`SalesOrder` represent a D2C order without silently converting a
`Consumer` into a `Customer`, or fabricating a placeholder `Customer` row
purely to satisfy a foreign key. Three existing B2B-only code paths that
read `order.customerId` unconditionally (`InvoiceService.create`,
`CustomerReturnService.request`, `DispatchService.create`) each got an
explicit guard — all three require a fulfilment state a D2C order never
reaches this sprint, so this is currently unreachable in practice, but the
guards document exactly where a future payment/fulfilment sprint needs to
decide D2C's story for invoicing/returns/dispatch.

**D2C source/channel.** `enum SalesOrderSource { B2B, D2C }`,
`SalesOrder.source @default(B2B)`. Every existing and future
`POST /api/sales/orders` order is `B2B`, completely unaffected;
`D2COrderingService` is the only caller that ever passes `D2C`. Alters no
core Sales Order semantics — purely a reporting/admin-UI distinction,
live-verified as a badge in the existing Sales Order list/detail views.

**Pricing.** The Product Catalogue had no price field at all (documented
as deliberately out of scope in `docs/domains/catalogue.md`; B2B
`unitPrice` is typed in per-order by the sales agent). Added
`Product.sellingPrice Float?` — nullable, opt-in, exposed through the
_existing_ `POST`/`PATCH /api/products` endpoints and Product dialog, not
a pricing engine or price list. A product is D2C-orderable iff
`status === ACTIVE && type === FINISHED_PRODUCT && sellingPrice !== null`.
The conversation client can never supply a price — the inbound contract,
the cart methods, and `SalesOrderService.createForConsumer()`'s own input
type all have no price field anywhere; the price is always the live
`Product.sellingPrice`, read at order-creation time.

**Order status.** A D2C order is created `DRAFT` — the existing default
every Sales Order already starts at. No new status was added to
`SalesOrderStatus`. "Awaiting Payment" is display-only wording the
Conversation Layer applies when formatting its own confirmation message;
the persisted status stays the real `DRAFT`. Sprint 35 is expected to
introduce real payment states.

**Idempotency.** `SalesOrder` gained a nullable `idempotencyKey`
(`@@unique([organisationId, idempotencyKey])`), the same shape
`SalesFulfilment`/`CustomerReturn` already use, generalised to order
creation itself. `SalesOrderService.createForConsumer()` follows the
existing idempotency-before-precheck convention
(`CustomerReturnService.request()`'s own pattern): lookup first, then
validate, then create inside a try/catch that recovers from a `P2002` race
by re-fetching the winner — the same recipe `ConsumerRepository`/
`ConversationRepository` already established. The Conversation Layer
mints the key once, at "review order," and persists it in
`context.checkoutIdempotencyKey` before any concurrent confirmation
attempts can occur.

## 3. Files Changed

**API/domain — schema & migration**

- `apps/api/prisma/schema.prisma` — `Product.sellingPrice`; `SalesOrder.consumerId`/`.source`/`.idempotencyKey`, `customerId`/`salesAgentId` widened to nullable; `SalesOrderSource` enum; `Consumer.salesOrders` back-relation.
- `apps/api/prisma/migrations/20260928140000_sprint34_d2c_consumer_ordering/migration.sql` — includes the hand-added `CHECK` constraint.

**API/domain — Sales (extended, not duplicated)**

- `apps/api/src/sales/sales-order.repository.ts` — nullable `customer`, new `consumer` relation, `findByIdempotencyKey`.
- `apps/api/src/sales/sales-order.service.ts` — `createForConsumer()`, `buildItemsFromCataloguePricing()`, P2002 recovery helper; existing `create()`/`update()` untouched in behavior.
- `apps/api/src/sales/sales.module.ts` — now also exports `SalesOrderService`.
- `apps/api/src/sales/sales-fulfilment.repository.ts`, `apps/api/src/finance/invoice.service.ts`, `apps/api/src/sales/customer-return.service.ts`, `apps/api/src/distribution/dispatch.service.ts` — nullable-`customerId` guards (B2B-only paths, currently unreachable for D2C).
- `apps/api/src/sales/sales-order.controller.ts` — response now includes `consumer`/`source`.

**API/domain — Catalogue (extended, not duplicated)**

- `apps/api/src/catalogue/product/product.service.ts`, `product.controller.ts` — `sellingPrice` create/update/response pass-through.
- `packages/validation/src/catalogue.ts` — `sellingPrice` on `createProductSchema`/`updateProductSchema`.

**API/domain — new D2C Ordering domain**

- `apps/api/src/d2c/ordering/d2c-ordering.types.ts`, `d2c-ordering.service.ts`, `d2c-ordering.module.ts` — the channel-neutral application service; no controller (no new HTTP surface).
- `apps/api/src/d2c/conversation/conversation.service.ts`, `.module.ts`, `conversation-audit-actions.ts` — the Order Snacks conversation flow.

**Web**

- `apps/web/src/app/(app)/settings/products/product-dialog.tsx`, `api.ts` — D2C Selling Price field.
- `apps/web/src/app/(app)/settings/sales/api.ts` — `getSalesOrderPartyName()` helper, `consumer`/`source` fields.
- `apps/web/src/app/(app)/settings/sales/page.tsx`, `sales-order-detail-dialog.tsx` — Source badge, null-safe party name.
- `apps/web/src/app/(app)/settings/distribution/dispatch-dialog.tsx`, `apps/web/src/app/(app)/settings/returns/create-customer-return-dialog.tsx` — null-safe party name (defensive; unreachable for D2C this sprint).
- `apps/web/src/app/(field)/field/page.tsx`, `field/orders/page.tsx`, `field/orders/[id]/page.tsx` — null-safe party name (re-exported types from the same shared api.ts).

**Tests**

- `apps/api/src/sales/sales-order.service.spec.ts` — `createForConsumer` suite (7 tests).
- `apps/api/src/catalogue/product/product.service.spec.ts` — `sellingPrice` pass-through (4 tests).
- `apps/api/src/d2c/ordering/d2c-ordering.service.spec.ts` (new, 18 tests), `d2c-ordering-independence.spec.ts` (new, 5 tests).
- `apps/api/src/d2c/conversation/conversation.service.spec.ts` — full "Order Snacks flow" suite (10 new tests) plus a real in-memory `SalesOrderService`/`ProductRepository` harness.
- `apps/api/src/d2c/conversation/conversation-independence.spec.ts` — updated for the new `D2COrderingModule` import and a new D2C-order-creation guard.
- `apps/api/src/sales/direct-sales-independence.spec.ts`, `sales-fulfilment.service.spec.ts`, `sales-order.controller.spec.ts` — fixture updates for the new nullable/added `SalesOrder` fields.

**Documentation**

- `docs/domains/d2c.md` §27–39 (new), §1 updated.
- `docs/sprint-34-completion-report.md` (this file).

## 4. Database Changes

- **Migration created:** yes — `20260928140000_sprint34_d2c_consumer_ordering`.
- **Schema changes:** `Product.sellingPrice Float?` (new); `SalesOrder.customerId`/`.salesAgentId` widened `String` → `String?`; `SalesOrder.consumerId String?` (new, FK), `.source SalesOrderSource @default(B2B)` (new), `.idempotencyKey String?` (new).
- **New enums:** `SalesOrderSource { B2B, D2C }`.
- **New indexes/constraints:** `@@unique([organisationId, idempotencyKey])` on `SalesOrder`; `@@index([organisationId, consumerId])`; a hand-added `CHECK` constraint (`sales_orders_customer_xor_consumer_check`) enforcing `customerId`/`consumerId` mutual exclusivity.
- Applied via `prisma migrate deploy` (the established non-interactive workaround for this environment); confirmed via `prisma migrate status` → 52 migrations, database up to date.

## 5. Tests

```
Test suites: 223 passed, 223 total   (Sprint 33 baseline: 221)
Tests:       1950 passed, 1950 total (Sprint 33 baseline: 1912)
Passed:      1950
Failed:      0
Regression status: none — the entire pre-existing suite remains green,
  including every B2B Sales Order, fulfilment, invoice, dispatch, customer
  return, finance, distribution, HR, recruitment, workflow, access-control,
  and Sprint 32/33 D2C test.
```

## 6. Quality Checks

```
Prisma:      validate — valid; migrate status — up to date (52 migrations)
TypeScript:  apps/api tsc --noEmit — clean; apps/web tsc --noEmit — clean
Lint:        0 errors across all Sprint 34 files (27 pre-existing warnings
             in unrelated finance/budgeting spec files, unchanged by this
             sprint)
API build:   nest build — clean
Web build:   next build — clean, all routes compiled including the
             updated Sales/Products pages
```

## 7. Live Verification

All performed against the real running dev server and PostgreSQL database.

1. **Full registration → order flow (existing consumer path)**: registered
   a fresh consumer via the Conversation Layer, selected "Order Snacks,"
   browsed the real catalogue (only the two products an admin had priced
   appeared, out of 20+ active products — confirming the D2C-orderable
   filter), selected a product, entered a quantity, added a second
   product, reviewed the multi-item summary, confirmed — a real
   `SalesOrder` (`SO-000015`, `source: D2C`, `consumer: {CON-000015,
...}`, `customerId: null`, `status: DRAFT`, correct subtotal/total/line
   items) appeared via `GET /api/sales/orders`.
2. **Price/total tampering**: sent `CONFIRM_ORDER` with extraneous
   `price`/`total` fields injected into the HTTP body — the created order
   was priced entirely from the live catalogue (`Amount: NGN 4000`,
   matching the real cart), proving the injected fields had no schema slot
   to land in.
3. **Idempotency/concurrency**: primed a checkout to the review step
   (minting the idempotency key), then fired 5 genuinely concurrent
   `CONFIRM_ORDER` HTTP requests — all 5 returned the identical
   `SO-000016`; exactly one `SalesOrder` existed afterward.
4. **Cross-tenant isolation**: registered a second, genuinely separate
   organisation ("Rival Snacks," created live via `/auth/register`),
   confirmed its own empty catalogue correctly short-circuits to "no
   products available," priced a product under that tenant, then
   submitted the FIRST tenant's own product id as a SKU selection under
   the second tenant — rejected with "That product is no longer
   available. Please choose another product." at the quantity step.
5. **Admin visibility**: opened `/settings/sales` in an authenticated
   browser session — all three D2C test orders appear naturally in the
   existing list alongside ordinary B2B orders, each showing a `D2C`
   source badge and the Consumer's name in the Customer column; opening
   one shows "Consumer: Browser Test Buyer" and a `[D2C]` badge in the
   existing detail dialog — no new admin screen was built.
6. **Conversation Tester UI (browser, desktop)**: drove the complete
   Browse → Select → Quantity → Cart → Review → Confirm flow by clicking
   through the real rendered buttons/lists, ending in "Order created
   successfully. / Order: SO-000017 / Amount: NGN 4500 / Status: Awaiting
   Payment" rendered in the chat log exactly as the API returned it.
7. **Mobile layout**: the Conversation Tester's responsive layout was
   confirmed correct at 375×812 (interactive click verification at mobile
   width was not completed after the browser automation tool began
   timing out on click actions late in this session — the page itself
   remained responsive per repeated screenshots, and the desktop
   interactive flow together with the mobile layout check are the
   verification actually completed).
8. **Bug found and fixed live**: an empty-catalogue tenant's "Order
   Snacks" click showed main-menu buttons without leaving the conversation
   `BROWSING` state; clicking "My Account" next was misrouted into the
   product-selection handler ("How many would you like?"). Fixed by
   genuinely transitioning to `MAIN_MENU`; re-verified live against the
   same tenant/consumer showing correct account details afterward.

## 8. Scope Verification

Sprint 34 explicitly did **NOT** implement:

- Payment of any kind (Sprint 35).
- Collection Point / fulfilment for D2C orders — `InvoiceService`/
  `DispatchService`/`CustomerReturnService` gained explicit guards
  documenting this boundary rather than silently handling it.
- Inventory deduction or reservation for D2C orders — confirmed
  structurally unreachable (`D2COrderingService`/
  `SalesOrderService.createForConsumer` have zero Inventory imports).
- Loyalty/rewards or marketing/promotions.
- The Sprint 42 consumer-facing simulator — the Conversation Tester
  remains the same small internal harness from Sprint 33, only its
  underlying flow grew.

## 9. Documentation

- `docs/domains/d2c.md` §27–39 (new): D2C Ordering Architecture, the
  Consumer→SalesOrder relationship decision, source/channel, pricing
  (server-authoritative), idempotency, order status, the conversation
  state machine (including the bug found live), main menu, order lookup,
  security/live-verification summary, inventory boundary, deferred scope,
  and testing summary. §1 updated to reference the new section.
- `docs/sprint-34-completion-report.md` (this file).
- `docs/roadmap.md` — new Sprint 34 checklist entry.
- `docs/backlog.md` — Sprint 34 added to the completed-sprints list, plus
  a summary paragraph and an update to the "still not started" list.
- `docs/changelog.md` — new `[Sprint 34 D2C Consumer Ordering]` entry.
- `README.md` — the Sprint 32/33 narrative paragraph extended to cover
  Sprint 34.

## 10. Git State

```
Commit: NOT MADE
Push:   NOT MADE
Working tree: 38 modified files, 3 new untracked paths
  (apps/api/prisma/migrations/20260928140000_sprint34_d2c_consumer_ordering/,
   apps/api/src/d2c/ordering/, docs/sprint-34-completion-report.md),
  plus the pre-existing untracked .claude/ (local tool config, unrelated)
HEAD: 415c808 "Sprint 33: Consumer Conversation Experience Foundation"
Branch: main
```
