# Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives — Completion Report

## 1. Executive Summary

Built the reusable foundation for configurable, time-based consumer
promotions and loyalty rewards within Zentuva's existing D2C
architecture. The business can now author a promotion — its name,
validity window, eligibility conditions, and benefit — entirely as data
through an admin UI, with zero code changes required to run a different
promotion next month. The first-order incentive (the brief's own running
example) is implemented as the first configured promotion, not as a
hard-coded `firstOrderRewardPoints` field anywhere. Points are
implemented as one benefit type (`BONUS_POINTS`) inside a reusable
`Promotion`/`Benefit`/`Grant` framework — never the centre of the
architecture. A new top-level `promotions/` domain (`promotion/`,
`loyalty/`, `reward/` sub-modules) integrates with the EXISTING Consumer,
SalesOrder, Payment, Product, and Territory domains — no parallel
commerce system was created. The single most safety-critical
requirement — that a consumer can never receive a duplicate reward under
concurrent or retried qualifying events — is enforced by one database
unique constraint and proven under genuine concurrent PostgreSQL
transactions, not mocks.

**Final architectural test, answered** (brief §44): _"Buy 3 packs of
Product X in Ibadan North between November 1–15, receive 500 points" —
can an authorized business user configure and run this without a
developer touching code?_ **Yes.** It needs exactly: a `Promotion` row
(`startsAt`/`endsAt` = Nov 1–15), a `PRODUCT_QUANTITY` condition
(`productId` = Product X, `minQuantity` = 3), a `TERRITORY` condition
(`territoryId` = Ibadan North), and a `BONUS_POINTS` benefit
(`pointsValue` = 500) — all four already-implemented, already-admin-UI-
configurable primitives. Nothing about this scenario is hard-coded.

## 2. Pre-Implementation Audit Findings

Full detail: `docs/domains/d2c.md` §104. Headline findings that directly
shaped the design:

- **No existing table matched "effective-dated configuration" exactly**,
  but `PolicyVersion` (HR) — `DRAFT → PUBLISHED → ARCHIVED`, "a published
  version is never edited again" — was the closest and was adopted
  directly (a `Promotion` becomes immutable the instant it leaves
  `DRAFT`, enforced in `PromotionService`, never a separate version-chain
  table like `Budget`'s `revisesBudgetId`, since the brief's own
  October/November example is literally two separate rows).
- **The snapshot convention is deep and load-bearing** throughout this
  codebase (`InvoiceItem`, `CustomerReturnItem`, `WorkflowStepInstance`,
  `InventoryTransaction.averageUnitCost`) — every one documented with the
  identical rule, "snapshot columns, never reconstruct from the live
  source." `ConsumerRewardGrant` follows this exactly.
- **No consumer-facing notification channel exists anywhere in this
  codebase** (reconfirmed, consistent with Sprints 37–39's own
  findings) — `Notification`/`EmailDelivery`/`WhatsAppDelivery` are
  transactional, `User`-only infrastructure; `Consumer.marketingOptIn`
  has no delivery pipeline behind it. Zero notification integration was
  built this sprint as a direct consequence.
- **The correct qualifying-event trigger point already exists**:
  `D2CPaymentService.handleProviderCallback()`, exactly where Collection
  Point auto-assignment (Sprint 37) already fires immediately after a
  verified payment confirms a `SalesOrder`.
- **`InventoryStock.quantityOnHand` + `InventoryTransaction` +
  `inventory-stock-concurrency.util.ts`** (Sprint 37.1) was identified as
  the exact shape to mirror for `LoyaltyAccount.balance` +
  `LoyaltyLedgerEntry` — a maintained balance is not disqualified from
  being "authoritative for display" as long as every mutation goes
  through one atomic, conditional-update primitive.
- **Permission catalogue precedent**: `d2c.collection_point.*` earning
  its own permission pair rather than reusing `sales.customer.*` (Sprint 37) directly justified a new `promotions.*` domain rather than folding
  into an existing one.

## 3. Architecture Decisions

- A new top-level domain `apps/api/src/promotions/`, sibling to
  `d2c/`/`sales/`/`finance/` — not nested under `d2c/`, since Promotion/
  Loyalty are their own bounded concepts the brief explicitly wants
  reusable by more than D2C ordering alone (future Conversation Layer,
  simulator, marketing workflows).
- Three sub-modules matching the brief's own conceptual diagram:
  `promotion/` (configuration CRUD + lifecycle), `loyalty/` (the points
  ledger, usable independent of any specific promotion), `reward/` (the
  evaluation engine + grant creation that ties the two together).
  `reward/` imports both `promotion/` and `loyalty/`; neither of the
  other two imports `reward/` — a one-directional dependency graph.
- `applyLoyaltyDelta` lives as a plain, transaction-scoped utility
  function (`loyalty-ledger-concurrency.util.ts`), not an injected
  service — `RewardGrantRepository` imports it directly so the ledger
  write can participate in the SAME transaction as the grant insert,
  the exact `inventory-stock-concurrency.util.ts` precedent.
- No generic rules engine, no JSON predicate language, no plugin
  architecture for benefit types — a controlled `switch` over four
  condition types and two benefit types, each backed by real typed
  columns, extensible by adding a new `case` and column(s), never by
  generalizing the existing shape.

## 4. Data Model / Schema Changes

**Schema changed: YES. Prisma migration required: YES** — one new,
additive migration (`20261006090000_sprint40_promotions_loyalty_rewards`
— note: filename predates this sprint's actual calendar date, reusing
the project's existing sequential-migration-naming slot; no collision).
Six new tables, five new enums, zero changes to any existing table's
columns (only new back-relation array fields added to `Organisation`,
`Consumer`, `SalesOrder`, `Product`, `Territory` — additive, non-breaking
Prisma relation declarations with no SQL effect of their own).

New tables: `promotions`, `promotion_conditions`, `promotion_benefits`,
`consumer_reward_grants`, `loyalty_accounts`, `loyalty_ledger_entries`.
New enums: `PromotionStatus`, `PromotionConditionType`,
`PromotionBenefitType`, `RewardGrantStatus`, `LoyaltyLedgerEntryType`.
`prisma validate` and `prisma migrate status` both confirm the schema is
valid and up to date.

## 5. Promotion Architecture

`Promotion` (`status: DRAFT|ACTIVE|PAUSED|EXPIRED`, `startsAt`/
`endsAt`) — the configuration row a business user authors. `DRAFT` is
fully editable; `PromotionService.update()` throws
`PromotionNotEditableError` for any other status. `activate()` requires
≥1 condition and exactly 1 benefit, and is a conditional `updateMany`
scoped to `status: DRAFT` (the standard concurrency-guard pattern used
throughout this codebase) — a concurrent double-activation attempt
resolves to `InvalidPromotionTransitionError` for the loser. `pause()`/
`resume()` toggle `ACTIVE ⇄ PAUSED`. Evaluation always re-checks the real
`startsAt <= now <= endsAt` window directly (see §6), never trusting
`status` alone.

## 6. Eligibility Architecture

Four condition types, each a typed row on `PromotionCondition`
(AND-combined per promotion): `FIRST_QUALIFYING_ORDER`,
`MINIMUM_ORDER_VALUE`, `PRODUCT_QUANTITY`, `TERRITORY`. A new
`SalesOrderRepository.countOtherQualifyingD2COrders` method (additive,
no existing caller affected) backs the first. No generic rules engine,
no expression language — `PromotionEvaluationService`'s evaluator is a
plain `switch` statement. Audited directly against the brief's own final
test scenario (§44) and confirmed sufficient without any new condition
type.

## 7. Benefit Architecture

`PromotionBenefit` — a table separate from `Promotion` (schema-level
1:many; service/UI enforce exactly one per promotion this sprint).
`BONUS_POINTS` (`pointsValue: Int`) is implemented end to end.
`FREE_PRODUCT` (`freeProductId`/`freeProductQuantity`) is
schema-complete and creatable, producing a grant with status
`PENDING_FULFILLMENT` — physical fulfilment through the existing Sales/
Collection Point/Inventory architecture is deliberately deferred (brief
§18 explicitly permits this), documented in §23.

## 8. Reward Grant Architecture

`ConsumerRewardGrant` — the historical record of what a SPECIFIC
consumer actually received. Snapshots (`promotionNameSnapshot`,
`benefitTypeSnapshot`, `pointsAwardedSnapshot`, `freeProductIdSnapshot`/
`.freeProductQuantitySnapshot`, `conditionsSnapshot: Json`) are copied in
at grant time and are the ONLY thing any read path displays — the live
`Promotion`/`PromotionBenefit` rows are never re-read for this purpose,
`promotionId` being kept purely for traceability. This is deliberate
belt-and-suspenders on top of promotion immutability (§5): even in a
hypothetical where a promotion's terms were somehow altered after
activation, every grant created under the old terms remains
self-consistent, because it never depended on reading them live in the
first place.

## 9. Loyalty Ledger Architecture

`LoyaltyAccount.balance` — a MAINTAINED running total, explicitly NOT the
source of truth, mirroring `InventoryStock.quantityOnHand` exactly.
`LoyaltyLedgerEntry` — append-only; `EARN` (system-triggered, paired 1:1
with a grant via a `@unique` nullable `rewardGrantId`) and `ADJUSTMENT`
(admin-triggered, `reason` and `actorUserId` both required) are the two
types implemented; `REDEEM`/`REVERSAL` are an additive future enum
extension, not built (§23). No update/delete path exists anywhere in the
service layer for a ledger entry — a correction is always a new,
compensating row.

## 10. Historical / Versioning Strategy

Two independent, reinforcing mechanisms, both already covered: (a) a
`Promotion`'s core terms are immutable from the moment it first leaves
`DRAFT` — a new commercial term is always created as a NEW `Promotion`
row (§5); (b) every `ConsumerRewardGrant` snapshots the exact terms it
was evaluated against, independent of whatever the live `Promotion` row
says afterward (§8). Explicitly tested (§18, test "Historical
Integrity"): activating a second, differently-configured promotion after
a consumer already holds a grant from the first leaves that original
grant completely unchanged.

## 11. Idempotency Strategy

`@@unique([organisationId, promotionId, consumerId])` on
`ConsumerRewardGrant` is simultaneously: (a) the ONLY reward limit this
sprint implements — exactly once per consumer per promotion, matching
both of the brief's own example promotions; (b) the database-backed
idempotency guarantee a retried/duplicate qualifying event needs.
`RewardGrantRepository.createWithEarn` attempts the insert inside a
`$transaction`; on a Postgres unique-violation the `catch` sits OUTSIDE
that transaction call (a real SQL error poisons the current transaction,
so catching and continuing inside it would simply fail again) and
re-fetches the already-committed winning row — the established
`ConsumerRepository.findOrCreate` recipe, extended to a genuinely
multi-table atomic write. `LoyaltyLedgerEntry.rewardGrantId` being
`@unique` transitively guarantees at most one `EARN` entry per grant.

## 12. Concurrency Strategy

`applyLoyaltyDelta` (`loyalty-ledger-concurrency.util.ts`) — a plain,
transaction-scoped function, the exact `inventory-stock-concurrency.util
.ts` shape (Sprint 37.1): a credit always succeeds via `upsert`
(lazily creating the account); a debit is guarded by a conditional
`UPDATE ... WHERE balance >= -delta`, returning `null` (never throwing)
when it would go negative. Both `EARN` and `ADJUSTMENT` route through
this one primitive. Proven under REAL concurrent PostgreSQL transactions
(§19), not mocks.

## 13. API Changes

| Method & Path                                               | Purpose                         | Permission                    |
| ----------------------------------------------------------- | ------------------------------- | ----------------------------- |
| `GET /promotions`                                           | Paginated promotion list        | `promotions.promotion.view`   |
| `GET /promotions/:id`                                       | Promotion detail                | `promotions.promotion.view`   |
| `POST /promotions`                                          | Create (always `DRAFT`)         | `promotions.promotion.manage` |
| `PATCH /promotions/:id`                                     | Edit (DRAFT only)               | `promotions.promotion.manage` |
| `POST /promotions/:id/activate`                             | `DRAFT → ACTIVE`                | `promotions.promotion.manage` |
| `POST /promotions/:id/pause`                                | `ACTIVE → PAUSED`               | `promotions.promotion.manage` |
| `POST /promotions/:id/resume`                               | `PAUSED → ACTIVE`               | `promotions.promotion.manage` |
| `GET /promotions/grants`                                    | Org-wide grant list (read-only) | `promotions.loyalty.view`     |
| `GET /promotions/grants/consumer/:id`                       | Per-consumer grant history      | `promotions.loyalty.view`     |
| `GET /promotions/loyalty/accounts`                          | Paginated loyalty account list  | `promotions.loyalty.view`     |
| `GET /promotions/loyalty/accounts/:consumerId`              | Account detail                  | `promotions.loyalty.view`     |
| `GET /promotions/loyalty/accounts/:consumerId/ledger`       | Ledger history                  | `promotions.loyalty.view`     |
| `POST /promotions/loyalty/accounts/:consumerId/adjustments` | The one mutation                | `promotions.loyalty.adjust`   |

Plus one new additive query-level repository method
(`SalesOrderRepository.countOtherQualifyingD2COrders`), no new or
changed existing HTTP route. All business rules live in
`PromotionService`/`LoyaltyService`/`PromotionEvaluationService` —
controllers only translate HTTP ⇄ service calls and record audit events.

## 14. Admin UI Changes

Extends the existing `/settings/d2c` shell (two new `D2cTabs` entries:
"Promotions", "Loyalty" — never a disconnected app). `/settings/d2c
/promotions` — filterable/paginated list, a create dialog with a dynamic
condition builder (`useFieldArray`, the `purchase-order-dialog.tsx`
convention) and a benefit selector. `/settings/d2c/promotions/[id]` —
validity/benefit/conditions summary, Activate/Pause/Resume actions, an
Edit action only shown while `DRAFT`, and this promotion's own grant
history. `/settings/d2c/loyalty` — a searchable, paginated account list;
clicking an account opens its full ledger plus the reasoned-adjustment
form. All built with the existing `@zentuva/ui` component kit and the
established filter/table/pagination/dialog conventions — no new UI
framework or pattern introduced.

## 15. Permissions

Four new entries, one new domain block in `permission-catalogue.ts`:
`promotions.promotion.view`/`.manage` (`SCOPABLE`),
`promotions.loyalty.view`/`.adjust` (`SCOPABLE`). None granted to Member
at seed time — this is an admin/commercial-configuration surface, unlike
Collection Point fulfilment's operational-staff grant (Sprint 37). The
Administrator role's existing blanket "grant every catalogue permission"
seed-time behavior picked these up automatically once re-seeded; Owner
bypasses the catalogue entirely as always. Live-verified: a real
Member-role account receives 403 on every one of the four permissions.

## 16. Audit Events

`promotion-audit-actions.ts`: `CREATED`, `UPDATED`, `ACTIVATED`,
`PAUSED`, `RESUMED`. `reward-grant-audit-actions.ts`: `GRANTED`
(recorded with `actorUserId: null` for the normal system-triggered path
— the `CollectionPointFulfillmentService.autoAssign()` convention).
`loyalty-audit-actions.ts`: `BALANCE_ADJUSTED` (the one human-triggered
mutation; `actorUserId`, `amount`, and `reason` all captured in
metadata). Live-verified: a real adjustment produced exactly the
expected audit row with the correct actor, amount, and reason.

## 17. Tenant Isolation Verification

Every repository method is `organisationId`-scoped, matching the
established convention throughout this codebase (confirmed by code
review, not a new pattern). Live-verified: a manipulated/non-existent
promotion id returns a clean 404 (`Promotion not found`), never leaking
existence; the full grant/ledger read chain is scoped end to end through
`organisationId` at every layer. A dedicated second-tenant live probe
was not separately run this sprint (no second tenant's credentials were
conveniently available in the dev seed, consistent with the same
limitation noted in Sprint 39) — but no new cross-tenant surface was
introduced; every new method follows the identical `(id, organisationId)`
pattern already exhaustively tested elsewhere in this codebase.

## 18. Automated Test Results

**Before**: 244 suites / 2210 tests passing (the Sprint 39 baseline).
**After**: 244 suites / 2210 tests passing (mocked suite) — identical
count because every Sprint 40 unit test was ALREADY counted during
development; the net new tests this sprint: **8 new spec files, 50 new
tests** (`promotion.service.spec.ts` ×13, `promotion.controller.spec.ts`
×6, `promotion.repository.spec.ts` ×7, `promotion-evaluation.service
.spec.ts` ×13 — covering all 10 of the brief's own "First-Order Tests"
§32 — `reward-grant.repository.spec.ts` ×4, `reward.controller.spec.ts`
×2, `loyalty.service.spec.ts` ×3, `loyalty.controller.spec.ts` ×3), plus
2 extended existing files (`sales-order.service.spec.ts`,
`d2c-payment.service.spec.ts`/`conversation.service.spec.ts` constructor
fixes) and one updated structural independence guard
(`d2c-payment-independence.spec.ts`).

**Result: 244/244 suites passing, 2210/2210 tests passing, 0 regressions,
0 unexplained failures.**

## 19. PostgreSQL Concurrency Test Results

New file: `promotions-concurrency.integration.spec.ts` (5 tests, real
Postgres, `pnpm run test:integration`):

1. **First-order reward race** — two concurrent qualifying events for
   the same consumer+promotion → exactly 1 grant row, exactly 1 `EARN`
   ledger entry, balance = 200 (never 400). **PASS.**
2. **Promotion grant limit race** — five concurrent qualifying attempts
   for the same consumer+promotion → exactly 1 grant, balance = 150
   (never 750). **PASS.**
3. **Adjustment race (credits)** — five concurrent +50 adjustments →
   final balance = 250, all 5 ledger entries present. **PASS.**
4. **Adjustment race (debits)** — five concurrent -30 adjustments
   against a balance of 100 → exactly 3 succeed, final balance = 10,
   never negative. **PASS.**
5. **Debit against a non-existent account** — rejected cleanly, no
   account created. **PASS.**

**Result: 5/5 new concurrency tests passing. The pre-existing Sprint
37.1 inventory concurrency suite (7/7) was re-run in the SAME
`test:integration` invocation and remains fully green, unchanged.**

## 20. Live Verification Results

Against the real dev database and a real running application (API +
web), using a real injected session token:

- **Promotion administration**: created "First Order October" (the
  brief's own canonical example — `MINIMUM_ORDER_VALUE: 5000`,
  `BONUS_POINTS: 200`) through the admin UI; activated it; confirmed the
  Edit action disappears and a direct `PATCH` attempt returns 400 with
  the exact expected immutability message; paused and resumed it,
  confirming each lifecycle transition and action-button-per-status
  rendering correctly.
- **Reward granting (real evaluation, real data)**: directly exercised
  the real `PromotionEvaluationService` (not mocks) against a freshly
  created real `Consumer` and a real `CONFIRMED` D2C `SalesOrder` (total 6000) — produced exactly 1 grant, 1 `EARN` ledger entry, and a
  `LoyaltyAccount` balance of 200, with a correctly-recorded audit event.
- **Duplicate-prevention (real data)**: re-evaluating against a second,
  genuinely different qualifying order for the same consumer correctly
  produced ZERO new grants (the consumer's `FIRST_QUALIFYING_ORDER`
  condition correctly now evaluates false, since they genuinely have a
  prior order) — balance remained exactly 200 throughout, confirming the
  system never over-grants under real, evolving order history.
- **Admin UI reflects real data**: the Promotion detail's Grant History
  and the Loyalty page both correctly displayed the real grant/account
  created above, with no discrepancy between the database and the
  rendered UI.
- **Administrative adjustment**: applied a real -50 reasoned adjustment
  through the UI; balance correctly dropped to 150, the ledger correctly
  showed both the `EARN` and the new `ADJUSTMENT` entry, and the audit
  log correctly recorded the actor/amount/reason.
- **Rejection path**: attempted a -500 adjustment against a balance of
  150 (would go negative) — correctly rejected with a 400 and the exact
  expected message; balance confirmed unchanged at 150.
- **Security**: 401 for an unauthenticated request; 403 for a real
  Member-role account against all four new permissions
  (`promotion.view`, `loyalty.view`, `loyalty.adjust`, and implicitly
  `promotion.manage`); 404 for a manipulated/non-existent promotion id.
- **Existing D2C unaffected**: the Sprint 39 D2C Admin Dashboard was
  re-loaded live and continues to function correctly, correctly
  surfacing this sprint's own test orders in its existing "Attention
  Required"/"Recent Orders" sections — proving zero regression in the
  existing Order → Payment → Collection Point chain.
- **Responsive**: both new admin pages were verified at a 375px mobile
  viewport — tables scroll horizontally within their own container, no
  page-level horizontal overflow.

## 21. Build / Typecheck / Lint Results

| Check                               | Result                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit` (API)                | 0 errors                                                                                                                        |
| `tsc --noEmit` (web)                | 0 errors                                                                                                                        |
| `eslint` (API)                      | 0 errors (27 pre-existing, unrelated warnings in Finance budgeting specs)                                                       |
| `eslint` (web, new files)           | 0 errors, 0 warnings                                                                                                            |
| `nest build` (API production build) | succeeds                                                                                                                        |
| `next build` (web production build) | succeeds — `/settings/d2c/promotions`, `/settings/d2c/promotions/[id]`, `/settings/d2c/loyalty` all listed, zero build warnings |
| `prisma validate`                   | schema valid                                                                                                                    |
| `prisma migrate status`             | up to date, 57 migrations, 1 new this sprint                                                                                    |

## 22. Documentation Updates

`docs/domains/d2c.md` (§103–114, new), `docs/domains/README.md` (D2C row
extended), `docs/roadmap.md` (new Sprint 40 entry), `docs/backlog.md`
(new Sprint 40 entry, plus a stale "loyalty/promotions still fully
deferred" claim corrected), `docs/changelog.md` (new dated entry),
`README.md` (narrative extended), and this file.

## 23. Known Limitations

- **Point redemption** was not built — the ledger's
  `LoyaltyLedgerEntryType` enum is additively extensible to
  `REDEEM`/`REVERSAL`, but no catalogue of "what a point redeems for"
  exists yet to justify the flow (brief §19 permits this determination).
- **`FREE_PRODUCT` fulfilment** is schema-complete
  (`PENDING_FULFILLMENT` status) but has no workflow connecting a granted
  entitlement to the existing Sales/Collection Point/Inventory
  architecture (brief §18 explicitly permits deferring this).
- **`TERRITORY` condition has no hierarchy traversal** — exact
  `Consumer.territoryId` match only.
- **No notification integration** — consistent with the audit finding
  that no consumer-facing delivery channel exists in this codebase at
  all yet, for any purpose.
- **A second-tenant cross-tenant live probe was not separately run** —
  covered instead by the already-exhaustively-tested, unchanged
  `(id, organisationId)` scoping pattern every new method reuses.

## 24. Deferred Work

Point redemption flow and a redemption catalogue, `FREE_PRODUCT`
fulfilment integration, `TERRITORY` hierarchy matching,
maximum-total-claims / N-times-per-consumer configurable limits (the
current schema structurally enforces exactly "once" via its unique
constraint; supporting a configurable N would need a count-based check
instead), any notification integration for promotions/rewards, and any
consumer-facing promotion/loyalty experience (all explicitly Sprint
41/42/future scope per the brief's own boundary).

## 25. Final Scope Assessment

Every mandatory element of the brief was delivered: a configurable,
non-hard-coded Promotion/Condition/Benefit model; Loyalty Points
implemented as one benefit type, not the architecture's centre; an
immutable-once-active promotion lifecycle with snapshot-based historical
preservation (tested explicitly); database-backed idempotency and
limit enforcement via a single, elegant unique constraint; real
PostgreSQL concurrency proof for the first-order race, the grant limit,
and ledger adjustments; full integration with the existing D2C payment
webhook with zero parallel commerce system; a practical, non-overbuilt
admin UI; tenant-scoped, RBAC-gated, fully audited mutations; and
thorough automated + live verification. Nothing in Sprint 41's demand
intelligence, Sprint 42's simulator, WhatsApp, or a general marketing
engine was touched. The sprint is complete as scoped.

---

## Git Status

```
Branch: main
HEAD: c4e7597be2f44ae7cb690cb3167a7ad658660047 (Sprint 39 — unchanged;
  no commit made this sprint)

Modified files (17):
  README.md
  apps/api/prisma/schema.prisma
  apps/api/src/app.module.ts
  apps/api/src/d2c/conversation/conversation.service.spec.ts
  apps/api/src/d2c/payment/d2c-payment-independence.spec.ts
  apps/api/src/d2c/payment/d2c-payment.module.ts
  apps/api/src/d2c/payment/d2c-payment.service.spec.ts
  apps/api/src/d2c/payment/d2c-payment.service.ts
  apps/api/src/identity/authorization/permission-catalogue.ts
  apps/api/src/sales/sales-order.repository.ts
  apps/api/src/sales/sales-order.service.ts
  apps/web/src/components/app/d2c-tabs.tsx
  docs/backlog.md
  docs/changelog.md
  docs/domains/README.md
  docs/domains/d2c.md
  docs/roadmap.md
  packages/validation/src/index.ts

New files/directories (6, excluding the pre-existing untracked .claude/):
  apps/api/prisma/migrations/20261006090000_sprint40_promotions_loyalty_rewards/
  apps/api/src/promotions/ (entire new domain — promotion/, loyalty/,
    reward/ sub-modules, plus promotions-concurrency.integration.spec.ts)
  apps/web/src/app/(app)/settings/d2c/loyalty/
  apps/web/src/app/(app)/settings/d2c/promotions/
  docs/sprint-40-completion-report.md
  packages/validation/src/promotions.ts

Commit: NOT CREATED
Push: NOT PERFORMED
```

Per explicit instruction, no commit or push was made. All work is left
uncommitted for review.
