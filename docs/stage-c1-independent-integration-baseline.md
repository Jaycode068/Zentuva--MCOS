# Stage C1 — Independent integration-testing baseline

15 October 2026 · repository HEAD `23f2e59f08d483a84be8b634cf313986020f927d`

**Verdict: database isolation verified; the existing suite is not yet a trustworthy,
repeatable UAT foundation.** Two unchanged runs each produced **13 passing / 3 failing
suites; 91 passing / 16 failing tests**. All reported failures originate in missing
two-tenant setup; two suites also fail teardown. A passing suite leaks six orders
per run. No harness repair, new tenant provisioning, or full UAT was performed.

## 1. Verified environment identities

| Purpose                                  | Container                          | Host → container port     | Database / connected role                                                             | Compose project          | Data volume                           |
| ---------------------------------------- | ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| Development                              | `zentuva-dev-postgres-1`           | `localhost:5432` → `5432` | `zentuva` / `zentuva`                                                                 | `zentuva-dev`            | `zentuva-dev_postgres_dev_data`       |
| Isolated integration test                | `zentuva-dev-test-postgres-test-1` | `localhost:5433` → `5432` | `zentuva_test` / `zentuva_test`                                                       | `zentuva-dev-test`       | `zentuva-dev-test_postgres_test_data` |
| Existing restore verification, untouched | `zentuva-restore-verify`           | host `5435` → `5432`      | Documented `zentuva_restore_verify` / `restore_verify_admin`; not connected during C1 | No Compose project label | `zentuva_restore_verify_data`         |

Docker publishes these PostgreSQL ports on `0.0.0.0`; the assessment connected
only through localhost. Both connected servers report PostgreSQL 16.14, with
different server addresses (`172.19.0.2` development; `172.23.0.2` test).
Compose files, project labels, containers, volumes, and live SQL identities agree.
Development and test each contain one Boby Bites organisation, with different IDs.

The live test role has no superuser, CREATEDB, CREATEROLE, or BYPASSRLS privileges,
and no role memberships. It does not exist in development's role catalog. The
test instance also contains bootstrap admin and restricted runtime-app roles;
neither was used for the integration runs. Development's `zentuva` role remains
a superuser; C1 used it only inside explicit read-only snapshot transactions.

**Guard verification:** Jest global setup checks the actual test database/role
and privilege flags before files execute. Per-file setup overwrites `DATABASE_URL`
with explicit `TEST_DATABASE_URL`, without falling back to development. The
44 existing test/development guard unit tests pass; the real development identity
was also rejected by the test guard's decision function. C1's external invocation
additionally pinned localhost, port 5433, database and role. The repository guard
itself does not pin host/port: its guarantee is live database/role identity, not
cryptographic identification of a specific container. Directly bypassing Jest's
integration configuration is outside this verified entry point.

Global teardown is empty; each suite owns its cleanup. Test migration/seed wrappers
verify identity before spawning commands. They were reviewed but **not executed**.
No reset, reseed, migration, database/volume deletion, restore, or Docker mutation ran.

Evidence: [database snapshots and logs](assessment-evidence/stage-c1/), especially
`development-{before,after}.json`, `test-before.json`, `test-after-run-{1,2}.json`,
`guard-unit.json`, and `development-identity-rejection.txt`.

## 2. Repository and migration baseline

HEAD is the partial Phase 2C implementation. Prior commits include customer-account
Phase 1, inventory ownership/location Phase 2A, stock tracking/transfers Phase 2B,
and two ownership compatibility fixes. The current module/schema/code tree also
contains the earlier domain implementations through executive reporting.

At entry, **24 tracked files were modified**, plus untracked implementation,
infrastructure, test, and documentation files. The exact list and tracked patch
are preserved as `git-status-before.txt` and `git-diff-before.patch` in the evidence
directory. No existing work was overwritten, staged, committed, or pushed.

Present uncommitted stages include:

- Isolated test database infrastructure, Jest safety hooks, restricted roles,
  development identity guards and guarded database wrappers.
- Stage 4E inventory-adjustment idempotency and accounting, new adjustment account,
  tests, seed-period handling, company-ownership valuation filtering, and payables
  reconciliation/reporting work.
- Phase 2C cleanup correction and financial-integrity documentation; Stage 5A/5B
  D2C readiness/blocker reports. Stage 5B is an investigation/plan, not proof its
  proposed changes shipped.

**Migration verification:** 66 local SQL migrations; development and test each have
the same 66 completed applied migrations, no rolled-back/incomplete entries, and
matching SHA-256 checksums. Latest is untracked
`20261015070000_inventory_transaction_adjustment_idempotency`. Its nullable
`InventoryTransaction.idempotencyKey` and composite unique index are present in
the working Prisma schema; the matching live test index was inspected. No migration
was applied during C1. Matching history is not a comprehensive schema-drift proof
for every field, trigger, or constraint.

## 3. Integration-suite inventory

All filenames below are under `apps/api/src/`; each ends in `.integration.spec.ts`.
The count is the number of test cases reported by Jest on **each** run.
“Shared” means the existing isolated-test seed, never development data.

| Spec path without suffix                                        | Cases / result | Tenant and fixture dependencies                                                                                                                                                | Cleanup / repeatability                                                                                                                                          |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reporting/reporting-tenant-isolation`                          | 8 fail         | Named shared Boby Bites plus another pre-existing tenant; reports/HR/production/finance references                                                                             | No owned fixtures; disconnects; blocked by missing tenant                                                                                                        |
| `d2c/conversation-config/d2c-conversation-config-active-safety` | 3 fail         | First two shared tenants; fixed conversation ID; mocked access/audit, real config service/repositories                                                                         | Unsafe undefined-ID cleanup after setup failure; overwrites/deletes shared config if setup succeeds                                                              |
| `d2c/conversation-config/d2c-conversation-config-concurrency`   | 5 fail         | First two shared tenants; real config repositories                                                                                                                             | Deletes all message/capability config for selected tenants; undefined-array teardown failure                                                                     |
| `inventory/inventory-adjustment-idempotency`                    | 19 pass        | Named shared Boby Bites, FG/adjustment accounts and current open period; own products/customer/outlet/locations; three additional disposable tenants across outer/nested setup | Fixtures generally owned; nested cleanup deletes all shared tenant `INVENTORY_ADJUSTMENT` journals, not just owned IDs; unsafe with existing adjustment journals |
| `inventory/inventory-transfer`                                  | 22 pass        | Named shared tenant/outlet; own products/locations and disposable second tenant                                                                                                | Clears owned stock/transactions/transfers and tenant; shared outlet can collide with other suites' location association                                          |
| `sales/sales-fulfilment-outlet-integration`                     | 5 pass         | Named shared tenant/customer/outlet and accounting; own product/locations/orders/fulfilments                                                                                   | **Leaks six order headers per run**; children removed before order-selection predicate                                                                           |
| `d2c/fulfillment/collection-point-fulfillment-concurrency`      | 4 pass         | One arbitrary shared tenant; own consumer/customer/outlet/order/fulfilment rows                                                                                                | Tracked-ID cleanup; tests repository status/reassignment races, not full pickup/stock/ledger composition                                                         |
| `promotions/promotions-concurrency`                             | 5 pass         | One arbitrary shared tenant; own consumers/promotions/orders/rewards/loyalty                                                                                                   | Tracked-ID/dependency cleanup; no observed residual rows                                                                                                         |
| `d2c/messaging/consumer-whatsapp-delivery-concurrency`          | 4 pass         | One shared tenant plus own second tenant in cross-tenant test; own consumer/order/delivery rows                                                                                | Tracked-ID cleanup; retry claims, not real Meta sends                                                                                                            |
| `testing/db-isolation-safety`                                   | 5 pass         | Own disposable organisation, period, account and journals; no seed dependency                                                                                                  | Clears own tenant records; verifies guard/restricted privileges, including a denied CREATE DATABASE attempt                                                      |
| `inventory/inventory-stock-concurrency`                         | 7 pass         | One arbitrary shared tenant; own two products/location/stock                                                                                                                   | Product/location cleanup; no observed residual rows                                                                                                              |
| `reporting/reports/customer-account-reconciliation`             | 6 pass         | Named shared tenant plus seeded invoice/customer; second tenant optional                                                                                                       | Read-only in these runs; **two cross-tenant cases return early and appear passed**                                                                               |
| `finance/payment-allocation-concurrency`                        | 1 pass         | Named shared tenant with payment accounts/current open period; own customer/invoice/payments/allocations/journals                                                              | Owned cleanup; assertion weakness means green does not prove allocation conservation                                                                             |
| `d2c/ordering/d2c-ordering-concurrency`                         | 2 pass         | One arbitrary shared tenant; own consumers/products/orders                                                                                                                     | Tracked-ID cleanup; real SalesOrder service/repositories, no external payment                                                                                    |
| `d2c/whatsapp/whatsapp-webhook-event-concurrency`               | 3 pass         | No tenant/seed dependency; unique external-message keys                                                                                                                        | Removes tracked webhook IDs; no observed residual rows                                                                                                           |
| `inventory/inventory-location-ownership-foundation`             | 8 pass         | Named shared tenant, locations/stock/outlets; second tenant/outlet optional                                                                                                    | Inline cleanup; **one cross-tenant case returns early and appears passed**; historical migration assumptions depend on seed shape                                |

The suite relies heavily on shared seeded records and clock-dependent accounting
periods. Existing `findFirst`/`take: 2` selection is not deterministic fixture
ownership. Some setup failures can leave identifiers unset before broad cleanup.
Passing twice today does not establish safe parallel execution or crash recovery.

## 4. Two-tenant fixture requirements — design only

Create **two new, disposable, suite-owned organisations A and B**, exclusively
after verifying the isolated test connection. Do not use or rename Boby Bites,
invoke the general seed, or patch existing tenant settings. Return explicit
fixture handles to tests instead of searching by business name or arbitrary order.

| Area                 | Required independent data in A and B                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/access      | Different users/emails, hashed test passwords, tenant roles and role-permission assignments; regular users for scope/denial checks and explicit admin users. Global permission catalogue may be read/reused because schema ownership is global; never edit its shared rows. Add employee/manager/department data for scope and workforce cases.                                     |
| Catalogue/commercial | Distinct raw-material and priced finished-product SKUs, suppliers, customers, territories, outlets, and order/invoice references. Same display labels can intentionally test isolation, but globally unique codes must remain different.                                                                                                                                            |
| Inventory            | Separate warehouse and dedicated outlet locations; owned stock with known quantity/cost; explicit ORGANISATION/D2C_COLLECTION_POINT and CUSTOMER/WHOLESALE scenarios on separate compatible rows/locations.                                                                                                                                                                         |
| Accounting           | Separate charts/account IDs with required system keys (inventory, FG, WIP, COGS, AR, AP, GRNI, cash/bank, revenue, inventory adjustment as required), explicit open/closed periods, cash-account references, and known invoice/payment/receipt examples. Supply explicit business dates within fixture periods; cover real-clock code paths without relying on an old shared month. |
| D2C                  | Separate consumers/test phones, conversations, profiles, welcome/help text, capability settings, collection-point operators and eligibility, and test payment references. Use local/fake provider objects; no shared WhatsApp default-tenant configuration or external credentials.                                                                                                 |
| Reporting            | Positive, non-empty orders, invoices, supplier obligations, workforce and production/procurement rows in both tenants. Assert known totals and foreign-ID exclusion, not just two empty result sets.                                                                                                                                                                                |

Use a run UUID plus suite/test identity for all unique references. Register IDs as
each creation succeeds; clean up in FK order with tenant **and owned-ID** filters.
Never derive parent IDs after deleting their children. Missing IDs must cause cleanup
to skip that operation, never widen a predicate. Disconnect in `finally`. Failed
setup and deliberate mid-test failure must be covered. Preserve an owned-ID manifest
for approved recovery after process interruption. Verify baseline row fingerprints
before/after both serial and later parallel runs. No new tenants were created to
implement this design in C1; existing specs created and removed their own fixtures.

## 5. Executed baseline and repeatability

The unmodified package command was used, with its existing `--runInBand` setting:
`pnpm run test:integration --json --outputFile=<evidence result path>` from `apps/api`.
An assessment-only launcher pinned the verified test URL and checked the known
unsafe cleanup preconditions before each invocation. Test code/assertions/config
were unchanged; nothing was excluded.

Preflight verified: one tenant, zero conversations, zero message/capability configs,
and zero inventory-adjustment journals. Consequently the config suites failed
before writes, the undefined-ID conversation cleanup had no rows to delete, and
the broad adjustment cleanup had no pre-existing journals to remove. **These
conditions made this bounded baseline possible; they do not make the harness safe
for a populated two-tenant database.** Do not reuse the ordinary suite command on
such a database before fixing its cleanup.

| Run | Lagos time                | Suites           | Tests             | Exit | Jest time |
| --- | ------------------------- | ---------------- | ----------------- | ---- | --------- |
| 1   | 15 Oct, 18:51:51–18:52:07 | 13 pass / 3 fail | 91 pass / 16 fail | 1    | 11.711 s  |
| 2   | 15 Oct, 18:54:06–18:54:20 | 13 pass / 3 fail | 91 pass / 16 fail | 1    | 11.342 s  |

Execution JSON files contain exact UTC timestamps. The same 16 named cases failed
both times at `beforeAll`: eight reporting cases at line 168; three active-safety
cases at line 56; five config-concurrency cases at line 29. The complete names,
failure text, source locations and stacks are in [the failure ledger](assessment-evidence/stage-c1/failing-tests.md),
[run 1 JSON](assessment-evidence/stage-c1/run-1.json), and [run 2 JSON](assessment-evidence/stage-c1/run-2.json).
**These are setup failures, not 16 demonstrated application defects.**

Both config suites additionally throw `PrismaClientValidationError` in `afterAll`:
`in: [undefined, undefined]`. The active-safety suite reaches a preceding
`consumerConversation.deleteMany({where: {id: undefined}})`; Prisma's undefined
omission makes this an unfiltered deletion. There were no conversations in this
verified test database, so no existing conversations were removed.

Jest reports zero skipped tests, but **three of the 91 reported passes did not
execute their cross-tenant assertions**: two customer-account cases and the
inventory-location cross-tenant FK case. Warnings/early returns are recorded in
both raw logs. Do not count those passes as tenant-isolation evidence.

**Contamination:** `sales_orders` counts were **40 → 46 → 52**. Twelve new
`SO-TEST-*` headers, six from each run, have no remaining order items. Their IDs
and code timestamps are recorded in `repeatability-evidence.json`. Excluding
exactly these twelve rows reproduces the original 40-row SHA-256 fingerprint.
The other 157 public-table fingerprints match the pre-run test snapshot.
All 158 public-table fingerprints match before/after in development.

Thus existing shared rows were preserved, but **a clean repeat was not achieved**.
Run 2 was a repeat on the same contaminated database, not a reset/clean-room run.
No leaked row was manually removed, and no additional runs are needed to establish
the defect. A true clean repeat remains pending harness repair and approval.

## 6. Confirmed harness defects and minimum proposed repairs

| ID  | Evidence / consequence                                                                                                                                       | Minimum repair for review; not implemented                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Three suites require pre-existing second tenants and arbitrary/named seed selection                                                                          | Inject owned A/B fixture contexts; provision required reference data without general reseeding                                                           |
| H2  | Config suites overwrite/delete selected tenants' settings; partial setup yields undefined-ID and undefined-array cleanup                                     | Own the tenants/configs/conversation, validate IDs before cleanup, and always disconnect in `finally`                                                    |
| H3  | Adjustment nested `afterEach` at `inventory-adjustment-idempotency.integration.spec.ts:860` deletes every matching journal for the shared tenant/source type | Delete only journal IDs or source IDs produced by the current fixture; never tenant/source-type alone                                                    |
| H4  | Fulfilment cleanup deletes order items at line 152, then selects orders by those now-absent items at line 153                                                | Track created order IDs or resolve them before child deletion; clear those owned headers last                                                            |
| H5  | Three early-return cases appear passed without testing isolation                                                                                             | Require both fixture tenants/outlets; missing prerequisites must fail explicitly                                                                         |
| H6  | Payment-concurrency case accepts both successful payments if invoice's cached `amountPaid` remains within total; line 145 can compare a value to itself      | Assert accepted payment/allocation totals, invoice amountPaid, and journal totals reconcile; do not infer conservation from cached invoice balance alone |

Also replace reused outlet associations and clock-sensitive shared-period assumptions
with owned fixtures. Historical migration-default assertions should run against a
purpose-built migration fixture, not assert that every location in an evolving
business tenant is still a warehouse. Fixture cleanup needs failure-path tests
before enabling parallel workers.

## 7. Application defects versus assessment limits

**No new application defect was demonstrated by the failing integration cases.**
Their business assertions never ran. Passing repository-concurrency tests do not
prove complete HTTP/UI journeys, authentication, provider callbacks, or whole-system
transaction recovery. In particular H6 leaves payment-allocation correctness
under adversarial concurrency unresolved.

The read-only trace below confirms an existing D2C financial completeness gap,
already documented as an open business/accounting boundary. It is not a fixture
failure. It also exposes a **code-level recovery risk requiring a targeted test**:
payment status is committed before order confirmation; if confirmation throws,
a replay is ignored because `wasApplied` is false. No failure was injected here,
so this is not claimed as a reproduced runtime defect.

Stage 5B's WhatsApp signature/template/routing and collection-point configuration
findings remain inputs for subsequent targeted assessment, not newly executed C1
provider tests or a current production-configuration verdict.

## 8. Read-only D2C financial trace

| Step                    | Actual implementation and financial result                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consumer order          | `D2COrderingService.confirmOrder` → `SalesOrderService.createForConsumer`: real D2C order for a Consumer, live server pricing, idempotency; no stock reservation/deduction, invoice, or journal                                                                                                        |
| Pay Now / OPay          | `D2CPaymentService.initiatePayment` → `PaymentRepository.createPendingForConsumer` (line 419): ONLINE/OPAY PENDING payment linked directly to consumer/order; provider request converts naira to kobo; attaches checkout/provider details. No cash/AR/revenue journal                                  |
| Callback validation     | `PaymentWebhookController.webhook` (line 62) verifies provider callback; adapter recomputes HMAC-SHA512 of serialized payload and converts kobo to naira. Handler checks payment reference, provider, amount and currency before applying final status. No live OPay request was made in C1            |
| Successful confirmation | `PaymentRepository.applyProviderCallback` (line 487) conditionally changes PENDING → RECORDED; service then confirms SalesOrder, audits, best-effort assigns a collection point and evaluates promotions. **No GL entry, invoice allocation, cash account, gateway-clearing balance, or AR reduction** |
| Prepare / ready         | Collection-point status/availability operations do not reserve or consume stock; no journal                                                                                                                                                                                                            |
| Collect                 | `CollectionPointFulfillmentService.confirmCollection` (line 306) claims COLLECTED and calls existing fulfilment with deterministic idempotency key; failure attempts to restore READY_FOR_COLLECTION                                                                                                   |
| Inventory / COGS        | `SalesFulfilmentRepository.create` posts inside its stock transaction: **DR COGS / CR Finished Goods Inventory**, source `SALES_FULFILMENT`, using current cost snapshots. No journal if total cost is zero. This is a cost entry, not consumer revenue                                                |
| Revenue                 | Existing invoice flow rejects orders without a B2B customer (`InvoiceService.create`, lines 91–100). No D2C consumer invoice/revenue posting is added by the payment or collection path. **Revenue recognition remains absent**                                                                        |
| Gateway settlement      | No OPay settlement/payout/fee reconciliation workflow, receivable/clearing-to-bank posting, or provider-refund operation was found in the traced paths and repository-wide settlement/refund searches. A RECORDED payment is not proof funds reached the bank                                          |

The ordinary B2B payment path separately posts DR Cash/Bank / CR AR
(`PaymentRepository.create`, line 308); D2C calls the distinct consumer methods
and does not inherit that posting. Do not mistake their shared Payment table for
a shared accounting path. Payment overview aggregation can include RECORDED D2C
payments while ledger-derived cash/revenue remains unchanged by those payments.

For illustration from the code: a ₦1,000 consumer sale with ₦600 stock cost
records the ₦1,000 Payment and, at collection, DR COGS ₦600 / CR FG Inventory ₦600.
The traced chain produces no corresponding ₦1,000 cash/clearing or revenue entry.
Deciding payment-time liability/revenue, collection-time recognition, fees,
settlement and refunds requires an approved policy; C1 implements none of them.

## 9. Recommended next stage

**C2: repair and verify the test harness before broad UAT.** Review H1–H6 and the
A/B fixture design, implement only approved test-layer changes, then prove failed
setup cleanup, preservation of unrelated test rows, non-empty cross-tenant
assertions, and two consecutive runs with unchanged baseline fingerprints and no
new orphan rows. Retain failure evidence; do not weaken application assertions.

After that gate, conduct role-based browser/API UAT across procure-to-pay,
manufacture-to-stock, order-to-cash/returns, D2C paid-to-pickup exception recovery,
workflow/delivery, HR and reporting, with ledger/stock/audit evidence. Resolve D2C
financial acceptance policy before treating consumer commerce as financially ready.

## 10. Risks/actions requiring review and approval

- H1–H6 repairs and implementation of disposable A/B fixtures; no repairs approved
  or performed implicitly by this report.
- Narrow removal of the twelve C1-owned orphan order headers, using the recorded
  IDs and verified test guard, as part of an approved cleanup. They remain in test.
- D2C revenue/deposit/settlement/refund policy and any subsequent business-logic work.
- Any development collection-point cutover, credential/config change, privilege
  hardening, or real provider verification must be a separately scoped stage.
- The existing backup and safety copy remain untouched. Backup
  `/Users/user/Zentuva--MCOS-backups/zentuva-dev-20261014-230612.dump` has SHA-256
  `9e9ad2cccd6d55e35bc63c3fd9d97156f874cab2b19f950c47d821be9e202260`.
  Safety copy: `/Users/user/Zentuva--MCOS-SAFE-COPY-20261014-080827`.

Assessment additions are this report and its evidence directory only. No application
or harness source was edited. No deployment or full UAT started. Stop here for review.
