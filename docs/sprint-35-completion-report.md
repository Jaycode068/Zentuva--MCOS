# Sprint 35 Completion Report — OPay D2C Payment Integration

## 1. Implementation Summary

Built the first real payment gateway integration for Zentuva D2C: a
registered Consumer, through the existing Sprint 33/34 Conversation
Layer, can now pay for a confirmed D2C order via OPay's Cashier (sandbox/
test mode) and have that payment reflected back into Zentuva's existing
Finance/Sales domains — never a parallel payment system.

```
Conversation Layer (Sprint 33/34)
        v
D2CPaymentService  (new, apps/api/src/d2c/payment/)
        v
PaymentService (existing, extended)  +  SalesOrderService.confirm (existing, widened)
        v
Payment (existing model, extended)   +  SalesOrder DRAFT -> CONFIRMED
        ^
        | PaymentProvider port (new, apps/api/src/payments/)
        v
OpayPaymentProvider  ->  OPay Cashier API (sandbox)
```

No `OpayPayment`/`D2CPayment` model, no second payment-status system, no
second idempotency mechanism, and no manual journal-entry posting were
created — every one of these would have been a parallel system the brief
explicitly forbade. Full architectural detail lives in
`docs/domains/d2c.md` §40–52 ("Sprint 35 — OPay D2C Payment Integration");
this report focuses on what was built, tested, and live-verified.

## 2. Architecture Audit

Before writing code, the existing Finance/Payment, Sales, Consumer,
Conversation, notification, audit, access-control, config, and test
infrastructure were read end-to-end (not assumed). Three real gaps were
found, each resolved with the smallest additive change rather than a new
mechanism:

- **`Payment.customerId` was required**, and a `Consumer` is not a
  `Customer` (the exact tension Sprint 34 already resolved for
  `SalesOrder`). Resolved by directly reapplying that same pattern:
  `customerId` widened to nullable, a new nullable `consumerId` added,
  mutually exclusive via a hand-added DB `CHECK` constraint.
- **No Finance/GL trigger applies to an uninvoiced D2C order.** A D2C
  `SalesOrder` is never invoiced (Sprint 34's own documented limitation),
  so there is no existing invoice-settlement or journal-posting hook to
  reuse. Documented as a deliberate, audited boundary (`docs/domains/
d2c.md` §48) rather than fabricated — a verified payment reuses the
  existing `SalesOrderService.confirm()` transition and nothing else.
- **A provider callback carries no tenant hint.** Solved structurally,
  not with new lookup logic: `merchantReference` is derived from the
  already-globally-unique `SalesOrder.orderCode`, and `Payment
.merchantReference` itself carries a GLOBAL `@@unique` constraint
  (deliberately not organisation-scoped).

## 3. OPay Architecture Diagram

```
apps/api/src/payments/                         apps/api/src/d2c/payment/
  ports/payment-provider.port.ts   <---uses---  d2c-payment.service.ts
  infrastructure/
    opay-payment-provider.ts        (OPay wire format lives ONLY here)
    payment-provider.module.ts
  payment-webhook.controller.ts     (public, unauthenticated)
  payments.module.ts

  D2CPaymentService
    -> PaymentService.createPendingForConsumer / .attachProviderDetails / .applyProviderCallback
    -> SalesOrderService.getById / .confirm
    -> ConsumerService.getById
    -> OrganisationService.getById  (currency, display name)
    -> AuditService.record

  ConversationService.handleAwaitingPayment()
    -> D2CPaymentService.initiatePayment()  (PAY_NOW / "check status")

  apps/web/src/app/payment/[reference]/     (OPay returnUrl/cancelUrl target)
    -> GET /api/payments/opay/:reference/status  (public, unguessable reference)
```

## 4. Database Changes

**Migration**: yes —
`apps/api/prisma/migrations/20260929090000_sprint35_opay_payment_integration/`.

- **Models changed**: `Payment` — `customerId` widened to optional; new
  optional `consumerId`, `salesOrderId`, `provider`, `providerReference`,
  `merchantReference`, `checkoutUrl` fields; new relations `consumer`
  (`Consumer`), `salesOrder` (`SalesOrder`). `Consumer` gained a
  `payments` back-relation; `SalesOrder` gained a `payments`
  back-relation.
- **Enums**: `PaymentMethod` gained `ONLINE`; `PaymentStatus` gained
  `PENDING`/`FAILED`/`CLOSED` (existing `RECORDED`/`VOIDED` untouched);
  new `PaymentProvider` enum with one value, `OPAY`.
- **Indexes**: `@@index([organisationId, consumerId])`,
  `@@index([organisationId, salesOrderId])`.
- **Constraints**: `@@unique([merchantReference])` (global, not
  organisation-scoped — see §42 of the domain doc for why); a hand-added
  raw-SQL `CHECK` constraint, `payments_customer_xor_consumer_check`,
  enforcing `customerId`/`consumerId` mutual exclusivity (Prisma's schema
  DSL cannot express a multi-column `CHECK`).
- Applied via `prisma migrate deploy`; `prisma validate` and
  `prisma migrate status` both confirmed clean (53 migrations total, "up
  to date") as part of this report's own quality checks.

## 5. Environment Configuration

New variables (names only — values are never stated here per the
brief's own security rules, and were already present in the local `.env`
before this sprint started):

- `OPAY_ENVIRONMENT` (sandbox/production, defaults `sandbox`)
- `OPAY_MERCHANT_ID`
- `OPAY_PUBLIC_KEY`
- `OPAY_SECRET_KEY`
- `OPAY_API_BASE_URL` (defaults to OPay's sandbox host)
- `OPAY_WEBHOOK_URL`
- `WEB_BASE_URL` (used to build the `returnUrl`/`cancelUrl` sent to OPay)

All added to `apps/api/src/config/configuration.ts` and
`apps/api/src/config/env.validation.ts` (Zod schema; the three credential
fields are optional at the schema level, with `OpayConfigurationError`
providing the actual hard failure at application boot if they're
missing). `apps/api/.env.example` documents the same variable names with
commented-out placeholders — no real value was ever written to a
committed file, a test, a log line, an error message, or this report.

**Webhook / local tunnel**: OPay's sandbox will only deliver a webhook to
a real, publicly reachable HTTPS URL — `http://localhost:4000/...` is
never reachable from OPay's servers. For local sandbox testing this
sprint, a temporary public tunnel (`cloudflared tunnel --url
http://localhost:4000`) was used to expose the local API, with
`OPAY_WEBHOOK_URL` pointed at the tunnel's `*.trycloudflare.com` URL for
the duration of testing, then the API restarted to pick it up. **The
tunnel URL itself was never committed to any file** — it lived only in
the local, gitignored `.env` for the test session and is not reproduced
here. Any engineer repeating this locally should expect the tunnel URL to
be different each time a new tunnel is started and should revert
`OPAY_WEBHOOK_URL` to its default afterward.

(`localtunnel`, tried first, proved unusable in this environment — its
client process crashed with `connection refused ... check your firewall
settings` after the initial connection, because it requires opening new
outbound TCP sockets on arbitrary high ports that this sandbox's network
egress does not allow. `cloudflared`'s quick tunnel instead multiplexes
everything over a single outbound HTTPS/QUIC connection, which passed
connectivity pre-checks and remained stable for the entire test session.)

## 6. Payment State Mapping

See `docs/domains/d2c.md` §45 for the full table. Summary: OPay's
`INITIAL`/`PENDING` -> no transition yet; `SUCCESS` -> `PaymentStatus
.RECORDED`; `FAIL` -> `.FAILED`; `CLOSE` -> `.CLOSED`; anything
unrecognized -> logged, left as-is, never silently treated as `SUCCESS`.

## 7. Webhook Security

- **Signature**: HMAC-SHA512 over `JSON.stringify(payload)` keyed with
  the OPay secret key, compared via `crypto.timingSafeEqual` (constant-
  time). Verified against a genuinely correct signature computed with
  the real secret key (see §11) and against a deliberately wrong one
  (rejected with a generic `400`, no reason leaked).
- **Reference / amount / currency / provider validation**: all four
  checked before any state mutation; a mismatch on any of them is a safe
  no-op (amount mismatches are additionally recorded as an audit action,
  `d2c_payment.callback_amount_mismatch`).
- **Tenant**: implicit and safe by construction — `merchantReference` is
  globally unique, so looking it up directly can never resolve to the
  wrong tenant's payment.
- **Idempotency**: a conditional `updateMany` scoped to `status:
'PENDING'` — a callback arriving after the payment already resolved
  matches zero rows. Verified live with 6 duplicate deliveries of the
  same signed callback (1 sequential + 5 concurrent) against an
  already-`SUCCESS` payment: `SalesOrderService.confirm()` was invoked
  exactly once, zero errors.

## 8. Finance Integration

On a verified `SUCCESS` callback: `PaymentService.applyProviderCallback()`
transitions the existing `Payment` row `PENDING -> RECORDED` (method
`ONLINE`, provider `OPAY`), then `D2CPaymentService` calls the existing
`SalesOrderService.confirm()`, transitioning the `SalesOrder`
`DRAFT -> CONFIRMED` — the exact same transition an internal user
triggers for a B2B order, widened only to accept a `null` actor for this
system-triggered case. No manual journal entry is posted by this sprint's
code; per the audit in §2, no existing GL trigger applies to an
uninvoiced D2C order, so none was fabricated. This boundary is
deliberate and documented, not an oversight.

## 9. Automated Tests

| Suites | Tests | Passed | Failed | Regressions |
| ------ | ----- | ------ | ------ | ----------- |
| 227    | 2017  | 2017   | 0      | 0           |

Sprint 34 baseline: 223 suites / 1950 tests. New this sprint: 4 suites /
67 tests (`opay-payment-provider.spec.ts`,
`payment-webhook.controller.spec.ts`, `d2c-payment.service.spec.ts`,
`d2c-payment-independence.spec.ts`), plus extensions to
`payment.repository.spec.ts` and `conversation.service.spec.ts`. Full
coverage list in `docs/domains/d2c.md` §52.

## 10. Quality Checks

| Check                                | Result                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `prisma validate`                    | Pass — "The schema at prisma/schema.prisma is valid" |
| `prisma migrate status`              | Pass — 53 migrations found, database up to date      |
| `pnpm exec jest` (API)               | Pass — 227/227 suites, 2017/2017 tests               |
| `pnpm exec eslint src --quiet` (API) | Pass — 0 errors, 0 warnings on changed files         |
| `pnpm exec nest build` (API)         | Pass                                                 |
| `pnpm exec tsc --noEmit` (web)       | Pass                                                 |
| `pnpm run build` (web)               | Pass                                                 |

## 11. Live Sandbox Verification

Reported item by item, honestly — anything not actually verified is
stated as such rather than assumed.

- **Create payment / real `cashierUrl`**: ✅ Verified repeatedly. Six
  distinct real orders were created through the live Conversation API
  against the real OPay sandbox (`https://testapi.opaycheckout.com`),
  each returning a genuine `cashierUrl` on
  `sandboxcashier.opaycheckout.com` with a real `orderToken`.
- **Sandbox checkout UI**: ✅ Verified. Each `cashierUrl` was opened in a
  real browser; the Cashier correctly displayed the server-computed
  merchant name (from `Organisation.displayName`) and order amount
  (₦1,500.00 / ₦3,000.00, matching the live cart total exactly, including
  after the organisation's currency was changed live from `USD` to
  `NGN`). A real BankCard flow was driven to the PIN-entry step using
  OPay's own published sandbox test card
  (`4508 7500 1574 1019`); a real OPayWallet flow was driven using OPay's
  documented test wallet number (`01066668888`), reaching OPay's own
  `PENDING`/`POLLING` state.
- **Idempotent reuse**: ✅ Verified. Calling "Pay Now" twice on the same
  unpaid order returned the byte-for-byte identical `checkoutUrl`/
  `orderToken` both times, and the `Payment` table still contained
  exactly one row for that order — no duplicate OPay call was made.
- **Callback received from OPay's own sandbox servers**: ❌ **Not
  verified.** OPay's documentation describes its sandbox test wallet
  numbers as producing "automatic callbacks after one minute." This was
  attempted twice, through a real, independently-verified-reachable
  public tunnel (`cloudflared`, confirmed with repeated successful `200`
  responses from an external network throughout each attempt), waiting
  several minutes each time. No inbound webhook request from OPay was
  ever observed in the API's logs in either attempt. This is reported as
  a genuine gap, not glossed over — it may be a sandbox-specific delay
  longer than documented, a merchant-side configuration OPay expects that
  wasn't discovered, or a sandbox limitation; it was not diagnosable
  further within this sprint's time.
- **Callback signature/reference/amount/status verified, in code**: ✅
  Verified, but via a self-constructed callback rather than an
  OPay-originated one (disclosed explicitly): a payload shaped exactly
  as `OpayPaymentProvider.verifyCallback()` expects
  (`{reference, orderNo, status, amount:{total, currency}}`) was signed
  with `HMAC-SHA512` using the REAL `OPAY_SECRET_KEY` already configured
  in `.env`, and POSTed directly to the running
  `POST /api/payments/opay/webhook`. This exercised the actual production
  signature-verification code path, with the actual production secret,
  end to end — it is not a mock, and it proves the handler's own logic is
  correct — but it is not proof that OPay's own sandbox produces
  byte-for-byte the same JSON serialization this test constructed, since
  no real OPay-originated callback was ever received to compare against.
- **Payment / SalesOrder state updated**: ✅ Verified (via the
  self-constructed callback above). `Payment.status` moved
  `PENDING -> RECORDED`; `SalesOrder.status` moved `DRAFT -> CONFIRMED`
  via the real `SalesOrderService.confirm()` call, observed both through
  the public status endpoint and the authenticated Sales Order list API.
- **Finance integration**: ✅ Verified — confirmed no unexpected GL/
  Invoice side effect occurred (per §8's documented boundary) and that
  `SalesOrderService.confirm()` fired correctly as the one real state
  change.
- **Duplicate callback idempotency**: ✅ Verified live — 6 deliveries of
  the identical signed callback (1 sequential, then 5 truly concurrent
  `Promise.all` requests) against an already-resolved payment produced
  exactly one `SalesOrderService.confirm()` invocation and zero errors.
- **Amount-tampering rejection**: ✅ Verified live — a correctly-signed
  callback carrying the right reference but a deliberately wrong amount
  left the payment `PENDING`, unchanged.
- **Invalid-signature rejection**: ✅ Verified live — a deliberately
  wrong `sha512` produced a `400` with a generic message; the real
  rejection reason (visible only in server logs) was never returned to
  the caller.
- **Unauthenticated webhook access**: ✅ Verified — the webhook route
  accepts requests with no `Authorization` header at all, by design
  (there is no Zentuva session for OPay to present); this is the
  intended, documented shape, not an oversight.
- **Return URL**: ✅ Verified live in a real browser, for both a
  `SUCCESS` and a `PENDING` payment — and a real bug was found and fixed
  in the process: the page was written against Next.js 15's `use(params)`
  convention, but this codebase runs Next.js 14.2.16, where `params` is a
  plain synchronous object; the page threw an unhandled runtime error on
  every load until fixed (see `docs/domains/d2c.md` §50). After the fix,
  the page correctly displayed live, freshly-queried Zentuva state in
  both cases — never treating mere arrival at the URL as proof of
  payment.
- **Secret-key hygiene**: ✅ Verified — the API's dev-server logs were
  searched for the secret key string after every OPay call and callback
  test in this sprint; zero matches.

**No live sandbox testing was performed against OPay's production
environment or with production credentials at any point.**

## 12. Scope Verification

Explicitly NOT implemented this sprint, confirmed by inspection of the
final diff: payout/RSA (recipient/settlement account) functionality,
Collection Point integration, D2C fulfilment, inventory
deduction/reservation, loyalty/rewards, marketing/promotions tie-in, a
production OPay configuration or credential set, and a payment-retry flow
for a `FAILED`/`CLOSED` order (the Conversation Layer reports the
terminal state and directs the consumer to support; minting a fresh
payment attempt against the same order is deferred).

## 13. Documentation

- `docs/domains/d2c.md` — new §40–52 ("Sprint 35 — OPay D2C Payment
  Integration"): architecture, payment model, reference design, money
  conversion, currency, state mapping, provider abstraction, webhook
  security, Finance integration boundary, Conversation extension, return
  URL, scope, testing.
- `docs/sprint-35-completion-report.md` — this document.
- `docs/roadmap.md` — Sprint 35 entry added.
- `docs/backlog.md` — deferred-scope list updated (payment no longer
  listed as future D2C scope; payout/RSA/fulfilment/etc. remain).
- `docs/changelog.md` — `[Sprint 35 OPay D2C Payment Integration]` entry
  added.
- `README.md` — running narrative extended with this sprint's summary.

## 14. Git State

- **Branch**: `main`
- **HEAD**: `910785a` (Sprint 34: D2C Consumer Ordering) — unchanged by
  this sprint.
- **Commit**: **NOT MADE.**
- **Push**: **NOT MADE.**
- **Working tree**: all Sprint 35 changes (schema, migration, new
  `payments/`/`d2c/payment/` modules, Finance/Sales/Conversation
  extensions, the web return-URL page, and this documentation) remain
  uncommitted on disk, per this sprint's explicit instruction.
