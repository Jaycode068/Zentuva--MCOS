# Phase 1 — Customer Account Management: Completion Report

**Status:** Complete. Live-verified against real seeded data in the running dev
environment. **Not committed or pushed** — working tree only, per the brief's binding
instruction.

**Scope:** Implements Phase 1 of the roadmap proposed in
[`docs/customer-account-inventory-audit.md`](customer-account-inventory-audit.md) — a
unified Customer Account view, a reconciling Customer Statement, warning-only credit
limits, and multi-invoice payment allocation. Phase 2 (customer-location inventory)
and Phase 3 (Collection Point settlement) are explicitly out of scope and untouched.

---

## 1. Implemented Capabilities

- **Unified Customer Account page** (`/settings/retail/customers/[id]`) with six
  tabs: Overview, Transaction History, Invoices, Payments, Statement, and
  permission-gated Credit Settings.
- **Account Overview**: commercial profile, outlets, period-scoped financial summary
  (invoiced/paid this period, current outstanding, overdue, outstanding/overdue
  invoice counts, pending-order count and value kept strictly separate from
  receivables), and credit exposure with a visible warning banner.
- **Transaction History**: a chronological, filterable, paginated merge of Sales
  Orders, Invoices, Payments, Credit Notes, and Returns for one customer.
- **Outstanding Invoices** and **Payment History** tabs, each reusing the existing
  authoritative Invoice/Payment repositories.
- **Customer Statement**: opening balance, chronological debit/credit lines, running
  balance, closing balance, CSV export — closing balance is guaranteed (by
  construction, not by luck) to equal the existing `AccountsReceivableService`'s own
  calculation for the same cutoff.
- **Configurable, warning-only credit limit** per customer, with a documented 80%
  "approaching limit" threshold, audited on every change.
- **Multi-invoice payment allocation** — a single payment can now be split across
  several of a customer's invoices in one atomic request, fully backward compatible
  with the original single-invoice shape.

## 2. Architecture and Service Reuse

No new accounting, balance-calculation, or customer-record engine was introduced.

- `CustomerAccountReportService`/`CustomerStatementReportService`
  (`apps/api/src/reporting/reports/`) compose **existing** authoritative services —
  `AccountsReceivableService.getCustomerBalance()` / the new
  `getCustomerBalanceAsOf()`, `InvoiceRepository`, `PaymentRepository`,
  `CreditNoteRepository` — exactly the composition pattern
  `ExecutiveDashboardService` (Sprint 46) already established. They live in the
  existing `ReportingModule`, not a new module.
- `Customer`/`Outlet`/`SalesOrder`/`CustomerReturn` are read via a narrow, direct,
  read-only `PrismaService` query — the same "documented exception" pattern
  `SalesPerformanceReportService` already uses for reading `SalesOrder` without
  importing `SalesModule`. No new module dependency was added to `ReportingModule`.
- `FinanceModule` now additionally exports `InvoiceRepository`/`PaymentRepository`/
  `CreditNoteRepository` (previously internal-only) so the new report services can
  read invoice/payment/credit-note detail directly — purely additive, the same kind
  of widening Sprint 45 already did for `AccountsReceivableService` itself.
- The credit-limit write path stays inside the existing `retail/customer/` domain
  (`CustomerRepository`/`CustomerService`/`CustomerController`) — it is a profile
  field, not a new subsystem.
- Multi-invoice payment allocation extends the **existing** `PaymentRepository
.create()`/`.void()` transaction — same journal-posting call, same
  `PaymentAllocation` join table that has existed since Sprint 6 (it previously
  always wrote exactly one row; it now writes one row per allocation).

## 3. API and UI Routes

### New API routes (`apps/api/src/reporting/reporting.controller.ts`)

| Route                                                                                                      | Purpose              |
| ---------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /reporting/reports/customer-account?customerId=`                                                      | Account Overview     |
| `GET /reporting/reports/customer-account/transactions?customerId=&type=&status=&from=&to=&page=&pageSize=` | Transaction History  |
| `GET /reporting/reports/customer-account/invoices?customerId=`                                             | Outstanding Invoices |
| `GET /reporting/reports/customer-account/payments?customerId=`                                             | Payment History      |
| `GET /reporting/reports/customer-statement?customerId=&preset=...`                                         | Customer Statement   |
| `GET /reporting/reports/customer-statement/export?customerId=&preset=...`                                  | Statement CSV export |

### New/changed API route (`apps/api/src/retail/customer/customer.controller.ts`)

| Route                                | Purpose                                   |
| ------------------------------------ | ----------------------------------------- |
| `PATCH /retail/customers/:id/credit` | Set/clear a customer's credit limit (new) |

### Changed API route

`POST /finance/payments` now accepts **either** `invoiceId` (unchanged, legacy
shape) **or** a new `allocations: [{invoiceId, amount}]` array — mutually
exclusive, enforced by `createPaymentSchema`'s own refinement.

### New UI route

`apps/web/src/app/(app)/settings/retail/customers/[id]/page.tsx` — reachable via a
new "View Account" action on each row of the existing Customers table at
`/settings/retail`.

### Small, additive UI change

`apps/web/src/app/(app)/settings/finance/invoices/page.tsx` now supports
`?open=<invoiceId>` deep-linking (wrapped in a `<Suspense>` boundary per Next.js's
static-generation requirement for `useSearchParams`), so the Customer Account page's
Outstanding Invoices tab can link directly to an invoice's existing detail dialog.
The Payments list page has no per-row detail dialog in this codebase today (a flat,
read-only ledger) — its row links go to the general list page, not a deep link,
since there is nothing to deep-link to.

## 4. Credit-Exposure Calculation and Warning Thresholds

Computed in `CustomerAccountReportService.buildCreditExposure()`:

- `availableCredit = creditLimit - totalOutstanding` (`null` when no limit is
  configured — never shown as `0` or unlimited-looking).
- Status: `NO_LIMIT` (no limit configured) · `WITHIN_LIMIT` (`totalOutstanding <
80% of creditLimit`) · `APPROACHING_LIMIT` (`80% <= totalOutstanding <
creditLimit`) · `AT_OR_OVER_LIMIT` (`totalOutstanding >= creditLimit`).
- The 80% threshold is `CustomerAccountReportService.APPROACHING_LIMIT_THRESHOLD_RATIO`
  — a single documented constant, not a per-organisation setting (brief §5C: "use a
  documented initial default" when full configurability isn't justified yet).
- `totalOutstanding` is always `AccountsReceivableService.getCustomerBalance()`'s own
  figure — never recomputed.
- **Warning-only, verified**: no Sales Order, Invoice, or Payment creation path reads
  `Customer.creditLimit` or checks credit status. The warning banner is purely a
  read-time display on the Customer Account page.

## 5. Statement Calculation and Reconciliation Rules

- Opening balance = `AccountsReceivableService.getCustomerBalanceAsOf(organisationId,
customerId, periodFrom)` — a **new** method that re-derives the balance from dated
  `Invoice`/`PaymentAllocation`/`CreditNote` rows (not the always-current
  `Invoice.amountPaid`/`amountCredited` aggregates `getCustomerBalance()` uses),
  excluding `VOID` invoices, `VOIDED` payments, and non-`ISSUED` credit notes
  entirely.
- Closing balance = the same method called with `periodTo`.
- The displayed running-balance walk (opening + Σdebits − Σcredits per line, in
  chronological order) is a **separate, independent** computation from the two
  authoritative balance calls — `CustomerStatementReportService` returns both under
  `reconciliation: { lineBasedClosingBalance, authoritativeClosingBalance }` so a
  test (or a future UI assertion) can verify they agree, which they do by
  construction given well-formed data.
- Period boundaries are `[from, to)` — the same convention
  `reporting-period.util.ts` already established, organisation-timezone-resolved.
- **Documented, accepted limitation** (not silently papered over): a payment or
  credit note later voided is excluded from the balance entirely regardless of which
  side of the cutoff the void happened on, because this schema has no event log to
  answer "what was its status as of a past date." A statement generated today for a
  past period reflects today's void state, not a true point-in-time snapshot. This
  is recorded in the report's own `limitation` field in `REPORT_REGISTRY` and in the
  service's doc comment.
- Live-verified: for ABC Supermarket (a real seeded customer), the Statement's
  closing balance (₦1,407,000.00) matched the Overview tab's Current Outstanding, the
  Outstanding Invoices tab's sum, and the CSV export byte-for-byte, both before and
  after a real multi-invoice payment was recorded and then voided.

## 6. Payment-Allocation Behaviour

- `createPaymentSchema` now accepts `allocations: [{invoiceId, amount}]` as an
  alternative to the legacy single `invoiceId` — never both on the same request.
- **Engineering decision, explicitly scoped**: allocations must sum to **exactly**
  the payment amount. This preserves the pre-existing invariant exactly (the
  original single-invoice path always allocated 100% of the payment to one invoice;
  this phase only widens that to multiple invoices, it does not introduce
  partial/unallocated-advance payments). A genuine "customer advance with no
  invoice" capability would require a new suspense/liability system account that
  does not exist today — per the brief's own escape hatch ("implement only the safe
  subset... document the blocker"), this is explicitly deferred, not built.
- Validation (both in `PaymentService.create()` as a fast-fail pre-check and
  re-validated inside `PaymentRepository.create()`'s own transaction): every
  allocation's invoice exists, belongs to the same organisation, belongs to the
  **same customer** as every other allocation in the request, is in a payable
  status, and is not allocated beyond its own remaining outstanding balance.
  Allocation failures roll back the entire payment — no partial application.
- `PaymentRepository.void()` was widened from a single-`allocations[0]`-only
  assumption to loop over every allocation, reversing each invoice's `amountPaid`
  and recomputing its status independently.
- The journal posting is unchanged in shape: one balanced `DR Cash/Bank / CR
Accounts Receivable` entry for the full payment amount — multi-invoice allocation
  only changes how many `Invoice.amountPaid` rows get updated inside that same
  transaction, never how the GL entry itself is structured.
- `toPaymentResponse()` now exposes the full `allocations` array plus a generically
  computed `unallocatedAmount` (always `0` today, computed correctly regardless, so
  a future advance-payment capability would surface without changing this response
  shape) — satisfying the brief's "do not label a payment as allocated merely
  because it was recorded."
- **Concurrency**: a real-PostgreSQL integration test
  (`payment-allocation-concurrency.integration.spec.ts`) fires two genuinely
  concurrent payment-creation requests against the same invoice, together exceeding
  its outstanding balance. It passed consistently across 5 repeated local runs — no
  over-allocation observed. Its own doc comment records an honest caveat: the
  underlying write pattern (`tx.invoice.update()` keyed by id, not `SELECT ... FOR
UPDATE`) is unchanged from this codebase's pre-existing single-invoice path;
  closing a true adversarial lost-update race completely would require a
  cross-cutting row-locking change across every domain that mutates `Invoice`,
  which is out of this phase's scope.

## 7. Permissions and Audit Changes

**One new permission**: `finance.customer_credit.manage` (`NONE` scope) — gates
setting/clearing a customer's credit limit. Granted to Administrator (via the
existing blanket grant) and Head of Finance (added to that role's explicit grant
list, matching its "Full Finance access" description). **Not** granted to Member.

No other new permissions. Viewing the configured credit limit and exposure reuses
`finance.invoice.view` + `finance.payment.view` (both required — the "full finance
visibility" gate); viewing the customer profile reuses `sales.customer.view`
(the base gate for the whole Customer Account page); Transaction History sections
reuse `sales.order.view`, `finance.credit_note.view`, and
`sales.customer_return.manage` independently per source type.

Every section of the Customer Account Overview and Transaction History is
independently omitted (`null`, or the whole source type absent) when the caller
lacks its own existing permission — never a 403 for the whole page, matching the
`ExecutiveDashboardService` precedent exactly. Verified via unit tests in
`reporting.service.spec.ts`'s new "Customer Account (Phase 1)" describe block.

**Audit**: `customer.credit_limit_updated` (new action, `customer-audit-actions.ts`)
records `metadata: { creditLimit: { old, new } }` via the existing `AuditService` —
live-verified: a real credit-limit change produced a real audit-log row with the
correct actor, entity, and `{old: null, new: 1000000}` diff.

## 8. Schema and Migration Changes

One migration:
`apps/api/prisma/migrations/20261011120000_phase1_customer_credit_limit/migration.sql`

```sql
ALTER TABLE "customers" ADD COLUMN "creditLimit" DOUBLE PRECISION;
ALTER TABLE "customers" ADD CONSTRAINT "customers_creditLimit_non_negative"
  CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
```

- `creditLimit Float?` — `null` means unconfigured; `0` is a distinct, deliberately
  configured zero-credit account (both representable and tested).
- Defense-in-depth: non-negativity is enforced at the database level (`CHECK`
  constraint) **and** in `updateCustomerCreditSchema` (Zod) — belt-and-suspenders,
  not redundant noise, since the API is not the only thing that could ever write to
  this column.
- Applied and verified against the real dev database (`prisma migrate deploy` +
  `prisma migrate status` → "Database schema is up to date!"). No existing row was
  rewritten; every existing `Customer` remains valid with `creditLimit: null`.
- No other schema change. Multi-invoice payment allocation required **zero** schema
  changes — `PaymentAllocation` has supported multiple rows per `Payment` since
  Sprint 6; only the service layer previously restricted it to one.

## 9. Test, Build, Typecheck, and Lint Results

All commands below were actually executed in this session; none are assumed.

| Check                                                                                    | Result                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| API unit tests (`pnpm --filter @zentuva/api test`)                                       | **269 suites / 2,487 tests passing**, 0 failing                                |
| API integration tests (`pnpm exec jest --config jest.integration.config.js --runInBand`) | **11 suites / 48 tests passing**, 0 failing (includes 2 new Phase 1 suites)    |
| Root typecheck (`pnpm type-check`, all 9 workspace packages)                             | **0 errors**                                                                   |
| API lint (`pnpm --filter @zentuva/api lint`)                                             | **0 errors**, 27 pre-existing warnings (none in Phase 1 files)                 |
| Web lint (`pnpm --filter @zentuva/web lint`)                                             | **0 warnings, 0 errors**                                                       |
| API build (`pnpm --filter @zentuva/api build`)                                           | **Succeeds**                                                                   |
| Web build (`pnpm --filter @zentuva/web build`)                                           | **Succeeds** (133 routes, including the new `/settings/retail/customers/[id]`) |
| `prisma migrate status`                                                                  | **"Database schema is up to date!"**                                           |

New test files (all written this phase):

- `apps/api/src/reporting/reports/customer-account-report.service.spec.ts` (15 tests — credit-exposure thresholds, period-vs-balance separation, per-source permission omission, transaction merge/filter/pagination)
- `apps/api/src/reporting/reports/customer-statement-report.service.spec.ts` (5 tests — reconciliation identity, same-day sort, read-only guarantee)
- `apps/api/src/reporting/reports/customer-account-reconciliation.integration.spec.ts` (6 tests, real PostgreSQL — statement/overview/invoice-list reconciliation against the real seeded "Boby Bites" organisation, plus cross-tenant isolation)
- `apps/api/src/finance/payment-allocation-concurrency.integration.spec.ts` (1 test, real PostgreSQL — genuine concurrent payment creation)
- New `describe` blocks added to `payment.service.spec.ts`, `payment.repository.spec.ts`, `payment.controller.spec.ts` (multi-invoice allocation, cross-customer rejection, sum-mismatch rejection, multi-invoice void) and `customer.service.spec.ts`/`customer.controller.spec.ts` (credit-limit set/clear/audit)

### Live verification (real dev servers, real seeded data, real browser session)

Performed against the actual running application (API on `:4000`, web on `:3000`),
logged in as the seeded Owner account, against the real "ABC Supermarket" customer
(`CUS-000013`):

1. Overview tab: all figures (₦1,407,000.00 outstanding/overdue, 2 outstanding
   invoices, 2 pending orders, ₦44,000.00 unfulfilled order value) matched the
   Invoices tab's own sum and the AR aggregate exactly.
2. Set a ₦1,000,000 credit limit via Credit Settings → confirmed "Saved." →
   Overview immediately showed the red "At or over limit" warning banner with the
   correct `-₦407,000.00` available-credit figure.
3. Transaction History tab correctly merged and sorted all 5 source types,
   including real `CustomerReturn` rows (`RET-000001`/`RET-000002`).
4. Statement tab (This Year): opening ₦0.00 → 9 chronological lines → closing
   ₦1,407,000.00, matching the Overview exactly. CSV export fetched directly and
   confirmed byte-for-byte identical to the on-screen table.
5. Multi-invoice payment, via the real HTTP API against real invoices: ₦50,000
   allocated to `INV-000005` and ₦50,000 to `INV-000002` in one request. Both
   invoices' `amountPaid` incremented independently and correctly; the Overview's
   outstanding figure updated to ₦1,307,000.00 and the credit-exposure figures
   recalculated correctly in the same response.
6. Voided that same payment: **both** invoices reversed back to their exact
   pre-payment balances (confirms the `void()` widening from
   `allocations[0]`-only to a full loop actually works against real data, not just
   the mocked repository test).
7. Confirmed the audit-log entry for the credit-limit change via the real
   `/access/audit-log` endpoint — correct actor, entity, and `{old, new}` diff.

A stray, unrelated `next dev` process from an earlier session (holding port 3000
with a stale/broken build — pre-existing, not caused by this work) was restarted
cleanly via the standard dev-server tooling so this verification could run; no other
environment changes were made.

## 10. Known Limitations and Deferred Requirements

- **Partial/unallocated customer-advance payments** are not supported — allocations
  must sum to exactly the payment amount (§6 above). Documented as a Phase 2/3-type
  follow-on requiring a new suspense account.
- **Reallocating or unallocating an already-recorded payment** (as opposed to
  allocating correctly at creation time) is not implemented — only full void/reversal
  exists, which already correctly reverses every allocation.
- **Statement point-in-time accuracy** for a voided transaction is a known,
  documented limitation (§5 above) — not a bug, an accepted characteristic of a
  non-event-sourced schema.
- **A true adversarial lost-update race** under genuinely simultaneous concurrent
  payment creation was not provably eliminated (§6) — it is empirically safe across
  repeated real-Postgres test runs, consistent with this codebase's existing
  single-invoice behaviour, but not mathematically guaranteed without a cross-cutting
  row-locking change this phase deliberately did not make.
- **Mobile (Field Sales) UI** was not extended — the mobile customer card on
  `/field/customers` still opens the existing edit dialog on tap, unchanged; "View
  Account" was only added to the desktop admin table. The Field app's own customer
  detail page (`(field)/field/customers/[id]`) was left untouched.
- **No credit-limit warning was added to the Sales Order creation dialog** or any
  other order/invoice/payment creation flow. The brief's language here was
  conditional ("where it is operationally useful and safe") rather than mandatory;
  given the scope already delivered, this was deliberately deferred rather than
  rushed. It would be a small, well-scoped follow-on: fetch
  `GET /reporting/reports/customer-account?customerId=` (or a lighter dedicated
  endpoint) when a customer is selected and render a non-blocking banner, reusing the
  same credit-exposure calculation already built.
- **Domain documentation** (`docs/domains/finance.md`, `docs/domains/customers.md`)
  was not updated with Phase 1's new capabilities — only this completion report and
  the audit document (§11 below) were updated, given the scope already delivered
  this session.
- Phase 2 (customer-location inventory) and Phase 3 (Collection Point settlement)
  remain entirely unimplemented, as instructed.

## 11. Files Modified and Created

### Created

- `apps/api/prisma/migrations/20261011120000_phase1_customer_credit_limit/migration.sql`
- `apps/api/src/reporting/reports/customer-account-report.service.ts`
- `apps/api/src/reporting/reports/customer-account-report.service.spec.ts`
- `apps/api/src/reporting/reports/customer-statement-report.service.ts`
- `apps/api/src/reporting/reports/customer-statement-report.service.spec.ts`
- `apps/api/src/reporting/reports/customer-account-reconciliation.integration.spec.ts`
- `apps/api/src/finance/payment-allocation-concurrency.integration.spec.ts`
- `apps/web/src/app/(app)/settings/retail/customers/[id]/page.tsx`
- `docs/sprint-customer-account-phase-1-completion-report.md` (this file)

### Modified

- `apps/api/prisma/schema.prisma` (`Customer.creditLimit`)
- `apps/api/prisma/seed.ts` (grant `finance.customer_credit.manage` to Head of Finance)
- `apps/api/src/finance/accounts-receivable.service.ts` / `.spec.ts` (`getCustomerBalanceAsOf`)
- `apps/api/src/finance/finance.module.ts` (widened exports)
- `apps/api/src/finance/payment.controller.ts` / `.spec.ts`
- `apps/api/src/finance/payment.repository.ts` / `.spec.ts`
- `apps/api/src/finance/payment.service.ts` / `.spec.ts`
- `apps/api/src/identity/authorization/permission-catalogue.ts` (new permission)
- `apps/api/src/reporting/reporting-report-registry.ts` (catalogue entries)
- `apps/api/src/reporting/reporting-tenant-isolation.integration.spec.ts` (constructor arg)
- `apps/api/src/reporting/reporting.controller.ts` / `.module.ts` / `.service.ts` / `.service.spec.ts`
- `apps/api/src/retail/customer/customer-audit-actions.ts` / `customer.controller.ts` / `.spec.ts` / `customer.repository.ts` / `customer.service.ts` / `.spec.ts`
- `apps/api/src/retail/network/network-relationship.service.spec.ts` (test fixture field)
- `apps/api/src/retail/outlet/outlet.service.spec.ts` (test fixture field)
- `apps/api/src/sales/direct-sales-independence.spec.ts` / `sales-order.service.spec.ts` (test fixture field)
- `apps/web/src/app/(app)/reports/api.ts` (Customer Account API client functions)
- `apps/web/src/app/(app)/settings/finance/invoices/page.tsx` (`?open=` deep-link + Suspense wrapper)
- `apps/web/src/app/(app)/settings/retail/api.ts` (`Customer.creditLimit`, `updateCustomerCredit`)
- `apps/web/src/app/(app)/settings/retail/page.tsx` ("View Account" row action)
- `packages/validation/src/finance.ts` (`createPaymentSchema` widened)
- `packages/validation/src/retail.ts` (`updateCustomerCreditSchema`)

## 12. Confirmation

**No commit or push was performed.** `git status` at the end of this session shows
every file above as modified/untracked working-tree changes only, plus the
pre-existing untracked `.claude/` directory and `docs/customer-account-inventory-audit.md`
(untouched content, carried from the prior audit sprint). This matches the brief's
explicit, repeated instruction: implement Phase 1 only, do not commit or push.

## 13. Documentation Closure (addendum)

The two documentation items flagged as deferred in §10 above —
`docs/domains/finance.md` and `docs/domains/customers.md` not yet reflecting Phase
1 — were closed in a follow-up, documentation-only session. §21 was added to
`finance.md` (authoritative-receivables reuse, Statement calculation with its
historical-voiding limitation precisely described, multi-invoice allocation
mechanics and constraints, and the warning-only credit-exposure calculation); §9/§10
were added/updated in `customers.md` (the Customer Account page, credit limits, and
cross-references to `finance.md` §21). No finding or result reported above was
altered by that pass — this addendum only records that the two documentation gaps
are now closed.
