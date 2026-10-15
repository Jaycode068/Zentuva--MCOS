# Phase 2C Financial Integrity Review & Test-Isolation Audit

**Review type:** Strictly read-only forensic investigation (no application data, schema, or code was modified by this review itself).
**Subject:** The Phase 2C journal-entry deletion incident disclosed in [`docs/sprint-customer-location-inventory-phase-2c-completion-report.md`](./sprint-customer-location-inventory-phase-2c-completion-report.md) §8 ("Incident Disclosure"), and the reconstruction of 18 `JournalEntry` records that followed.
**Review date:** 2026-10-13.
**Database inspected:** a single PostgreSQL instance at `localhost:5432`, database `zentuva` (connection identity and privilege level independently confirmed before any query — see §E). No separate test database exists in this environment.

---

## A. Executive Summary

**What is established, with independent evidence:**

- The connecting database role (`zentuva`) is a PostgreSQL superuser, and there is exactly one database (`zentuva`) used by the dev API, every integration test, and ad-hoc scripts — no test/production separation exists at the infrastructure level.
- The `AuditLog` table is structurally immune to cascade deletion from `JournalEntry` (no foreign key; `metadata` is a plain JSON column). It independently corroborates **3 of the 18** reconstructed entries (fulfilments for SO-000006 ×2 and SO-000010), and for those 3 the current `journalNumber` and total amount match the pre-incident audit record exactly. The `journalEntryId` (database primary key) and `createdAt` timestamp necessarily differ, since the reconstruction created new rows.
- For the remaining **15 of 18** entries, no durable, independent, pre-incident record of the original journal entry's amount, id, or timestamp exists anywhere in the system. Their "original" values are known only from narrative claims made in the prior implementation session and in the completion report — not from any artifact this review could independently inspect.
- The fixed `cleanupTestData()` function in [`apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts`](../apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts) now scopes every deletion to specific, pre-resolved test-fixture ids rather than a bare `sourceType` filter, which directly closes the specific query pattern that caused the original incident.
- No regression test exists anywhere in the codebase that asserts "test cleanup cannot delete non-test financial records." No CI configuration exists at all (no `.github/workflows`, no other CI system found). All integration tests, including this one, run directly against the single live-identical database using the same superuser credentials as the application itself, with no schema isolation and no transaction-rollback isolation.

**What is not established:**

- Whether the 15 unconfirmed entries' amounts, dates, and references are faithful reconstructions of records that genuinely existed before the incident — this cannot be independently verified from any artifact in this system. "Internally consistent" (debits equal credits, amounts match the still-intact `SalesFulfilmentItem.costAmount` rows) is not the same as "proven to match a pre-deletion original," because `SalesFulfilmentItem.costAmount` was never deleted and was therefore also the exact input used to reconstruct the figures — it cannot serve as an independent check on itself.
- Whether the original buggy cleanup code matched the description in the completion report, since that code was never committed to git and left no artifact this review could inspect independently (see §B, §G).
- Whether the comment's claim in the test file — "verified byte-identical to the original reconciliation baseline" — is accurate. This review's own findings (different primary keys, different `createdAt` timestamps for all 18, and only 3 of 18 corroborated at all) directly contradict a literal reading of "byte-identical," and that claim should be corrected regardless of this review's other conclusions.

**Does the evidence support continued operational use without further action?** No, not without the remediation in §I. The monetary totals for 3 of 18 entries are independently confirmed and the GL is internally balanced for all 18, but the underlying vulnerability class (an unscoped or under-scoped destructive query run against the single shared live database, using a superuser credential, with no independent safety control) has not been structurally closed — only this one function's specific query was fixed. See §J for the Go/No-Go decision.

---

## B. Incident Timeline

**Facts independently established from source and database records in this review:**

- The 18 affected `JournalEntry` rows all have `sourceType = 'SALES_FULFILMENT'`, one row per `SalesFulfilment`, confirmed via `JournalEntry.organisationId_sourceType_sourceId` unique lookups against all 18 current fulfilments.
- The current (fixed) `cleanupTestData()` function, read directly from the test file in this review session, resolves exact fulfilment ids first (scoped to the test's own disposable `InventoryLocation` ids) and then scopes every subsequent `deleteMany` — on `SalesFulfilmentItem`, `JournalEntryLine`, `JournalEntry`, and `SalesFulfilment` — to those specific ids. It never issues a bare `sourceType`-only filter.
- A code comment immediately above that function (lines 105–114 of the spec file) states that a prior version of this cleanup, scoped "only by `sourceType: 'SALES_FULFILMENT'` (without ALSO restricting `sourceId`)," deleted all 18 real entries because they share that same `sourceType` value, and that they were "reconstructed afterward... replayed through the real `postSystemJournalEntry`."
- `git stash list` is empty and `git reflog` shows no intermediate commits between the start of this phase's work and the single squashed commit `23f2e59` ("Phase 2C: Customer Outlet Inventory Integration, Collection Point Cutover & D2C Accounting (partial)"). The buggy cleanup code was therefore never committed and left no artifact in git history.
- All 18 current `JournalEntry` rows share a `createdAt` timestamp clustered within roughly 1.2 seconds of each other, during a single run on 2026-10-12, consistent with a single reconstruction script execution — not with 18 independent original postings.

**What this review cannot independently verify:**

- The exact original form of the buggy query (its precise filter clause, which script or test file contained it, and whether it ran via an automated test, a manual command, or an ad-hoc script) rests entirely on the prior session's own narrative and the completion report. No log file, stash, commit, or other durable artifact of the original buggy code was found. Per the task's explicit instruction, this review does **not** infer the exact original cause merely from the current (fixed) code or from the fact that a regression test passes — because no dedicated regression test for this failure mode exists at all (see §F).
- Why the destructive query targeted the live/shared database rather than an isolated one is explained by the absence of any test/production database separation (independently confirmed, §E) — but whether the engineer who ran it was aware of that absence, or believed a separate database was in use, cannot be determined from any artifact available to this review.
- The precise sequence of "why safety controls failed" cannot be fully reconstructed beyond the one fact that is structurally verifiable: there were no safety controls to fail — no isolated schema, no restricted credential, no fail-closed identity check existed before or exists now (§E).
- Whether the deletion was a single cascading operation or several discrete statements, and whether it ran inside one transaction, cannot be determined; no database transaction log or equivalent artifact was available to this review.

**Classification:** The incident's _consequence_ (18 `JournalEntry` rows deleted, `sourceType = 'SALES_FULFILMENT'`, reconstructed on 2026-10-12) is corroborated by database state. The incident's _mechanism_ (the exact original buggy query) is a report-derived claim from the same session that fixed it, not independently verified by this review.

---

## C. Eighteen-Entry Reconciliation

Methodology: for every current `SalesFulfilment` with `sourceType = 'SALES_FULFILMENT'`, the current `JournalEntry` was retrieved by the same unique key (`organisationId_sourceType_sourceId`) used by the posting function itself. Independent corroboration was sought from `AuditLog` rows with `action = 'sales.fulfilment-cogs-posted'` (entityType `SalesFulfilment`), which record the _original_ `journalEntryId`, `journalNumber`, and `totalAmount` at the moment the original entry was posted, and which cannot have been affected by the deletion (no FK relationship to `JournalEntry`).

**Result: exactly 3 of 18 fulfilments have an AuditLog row for this action.** The other 15 have none — their `fulfilmentDate` timestamps cluster in sub-second bursts (e.g., five rows within 480ms on 2026-08-25T21:18:32–33), consistent with batch seed-data creation that bypasses the HTTP controller (only the controller path calls `auditService.record()` for this action — confirmed by reading `apps/api/src/sales/sales-order.controller.ts` lines 260–297 in this review session), not with 18 independent real postings through the application.

### C.1 — The 3 independently corroborated entries

| Order     | Fulfilment id               | Original journalNumber (AuditLog) | Original journalEntryId (AuditLog) | Original totalAmount (AuditLog) | Current journalNumber | Current journalEntryId      | Current totalAmount | Amount match    |
| --------- | --------------------------- | --------------------------------- | ---------------------------------- | ------------------------------- | --------------------- | --------------------------- | ------------------- | --------------- |
| SO-000006 | `cmt98eh3e000i5lde1qolm37o` | JE-000025                         | `cmt98eh6y000p5ldeuh5k16f1`        | 85,200                          | JE-000025             | `cmv5nhkq6000wkuqgaaghc7y5` | 85,200              | **Exact match** |
| SO-000006 | `cmt98fn6y00115ldepwtwf2y5` | JE-000026                         | `cmt98fn9l00185ldec96zxb4v`        | 42,600                          | JE-000026             | `cmv5nhkrj0012kuqgz0hiwsbg` | 42,600              | **Exact match** |
| SO-000010 | `cmt98kkni00245lde6xl7hkq6` | JE-000028                         | `cmt98kkqa00295ldeqp6qhdsa`        | 4,260                           | JE-000028             | `cmv5nhktf0018kuqgqqk8ep4k` | 4,260               | **Exact match** |

For these 3: **the monetary total and `journalNumber` are confirmed identical to the original.** The `journalEntryId` (database primary key, a `cuid`) and the `createdAt` timestamp (all three now read `2026-10-12T19:34:04.5xx–04.7xx`, the reconstruction run) are **confirmed different** from the original. This recovery is **not byte-identical** — it is identical on the two fields independently checked (amount, journal number) and necessarily different on primary key and creation timestamp, which is expected for any reconstruction that creates new rows. The exact match on `journalNumber` across all 3 (rather than a renumbered gap) appears to be a side effect of a gap-filling number generator; this review did not read `generateJournalNumber()`'s source and does not certify this as intentional or guaranteed behavior — it is reported as an observation, not a verified mechanism.

Line-level detail (account ids, debit/credit splits) was **not** independently corroborated for any of the 3, because the AuditLog metadata captured only `journalEntryId`, `journalNumber`, and `totalAmount` — not the individual journal lines. The current lines for all 18 entries consistently use the same two accounts (one COGS/expense account, one Finished-Goods-Inventory account), a single debit/credit pair each, consistent with the double-entry posting function's known structure — but this is an internal-consistency observation, not independent proof that the _original_ lines used the same accounts or split.

### C.2 — The 15 uncorroborated entries

| Order     | Fulfilment id               | Current journalNumber | Current journalEntryId      | Current totalAmount (= current SalesFulfilmentItem-derived COGS) |
| --------- | --------------------------- | --------------------- | --------------------------- | ---------------------------------------------------------------- |
| SO-000001 | `cmt9631bt00en7bjpdkq6bp02` | JE-000012             | `cmv5nhkk10002kuqg91sqdj6r` | 21,300                                                           |
| SO-000009 | `cmt9631fn00f27bjpt47vcmg2` | JE-000013             | `cmv5nhklf0008kuqgtfval1t6` | 8,520                                                            |
| SO-000011 | `cmt9631j900ff7bjpbcvsti40` | JE-000014             | `cmv5nhkmf000ekuqgrb9wefz1` | 213,000                                                          |
| SO-000012 | `cmt9631m100fs7bjp5m67iph2` | JE-000015             | `cmv5nhkng000kkuqgbm8cokr5` | 213,000                                                          |
| SO-000013 | `cmt9631ov00g57bjpdwozohvf` | JE-000016             | `cmv5nhkoj000qkuqgtian64xh` | 213,000                                                          |
| SO-000025 | `cmuo4d4kh001us8uhmv8mhfwm` | JE-000049             | `cmv5nhkvs001ekuqgrq71lmnl` | 1,278                                                            |
| SO-000027 | `cmuo5vwsa005qs8uhhztkrvdf` | JE-000050             | `cmv5nhkxx001kkuqgadtzfub5` | 426                                                              |
| SO-000029 | `cmuo5za12009is8uhp8y78gsr` | JE-000051             | `cmv5nhkzv001qkuqge8cd9eiu` | 6,390                                                            |
| SO-000028 | `cmuo5za60009vs8uhujtk14pe` | JE-000052             | `cmv5nhl1p001wkuqgxrvptv46` | 6,390                                                            |
| SO-000031 | `cmuohtwqq005vjo63daskjrof` | JE-000053             | `cmv5nhl3s0022kuqgcpncxhue` | 6,390                                                            |
| SO-000030 | `cmuohungz006djo63zxiroj6j` | JE-000054             | `cmv5nhl5s0028kuqglfvi6075` | 6,390                                                            |
| SO-000032 | `cmuqm1kk1002fm5uvapq3xjbt` | JE-000055             | `cmv5nhl8e002ekuqgtyn83vys` | 852                                                              |
| SO-000033 | `cmuqm3pfb004hm5uvtjdm0oj3` | JE-000056             | `cmv5nhlba002kkuqgngj3rebm` | 1,278                                                            |
| SO-000035 | `cmuxzukvy00024c6x1a96xvco` | JE-000057             | `cmv5nhlfc002qkuqgpiir4ave` | 852                                                              |
| SO-000036 | `cmuynip7t001zzvq6x67ngkrr` | JE-000058             | `cmv5nhlhi002wkuqg56oj4ko4` | 852                                                              |

**For these 15, "current totalAmount" is reported, not a verified "original" — there is no independent record of what the original amount was.** The figure shown equals the sum of the surviving `SalesFulfilmentItem.costAmount` rows for each fulfilment. Those item rows were never deleted and were also the source data used to regenerate the journal entry, so this number cannot serve as an independent cross-check — it will match by construction regardless of whether the reconstruction was faithful to a true original. **This review does not certify these 15 reconstructed amounts as verified recoveries.** They are internally consistent (debits equal credits; the figure is traceable to a still-existing, plausible source document) but not independently corroborated.

**Differences that must not be normalized away:** for all 18 entries without exception, `journalEntryId` (primary key) and `createdAt` differ from any true original by construction — a new row was created in each case on 2026-10-12. For the 3 corroborated entries this is a confirmed, reportable difference, not a defect; for the 15 uncorroborated entries, the absence of a comparison baseline means even this limited distinction cannot be drawn with certainty — it is simply the only state available.

---

## D. Related-Record Integrity

Read-only checks performed against the single identified database, after confirming connection identity and role privilege (§E):

- **Inventory transactions:** every one of the 18 fulfilments has at least one surviving `InventoryTransaction` row with `referenceType = 'SalesFulfilment'` and `referenceId` equal to the fulfilment id, with `transactionType = 'ISSUE'` at the warehouse location, and quantities consistent with the fulfilment's items. These rows were **not** affected by the incident — confirming the deletion was scoped to `JournalEntry`/`JournalEntryLine` only, not inventory movement records, consistent with the incident narrative's claim that only the GL side was affected.
- **Invoices and payment allocations:** of the 17 distinct `SalesOrder` records underlying the 18 fulfilments, 5 have associated `Invoice` rows (one order had two fulfilments), and those invoices have 6 associated `PaymentAllocation` rows. All resolved correctly via their foreign keys with no orphaned references detected. These are separate journal postings (invoice/payment-side, not COGS-side) and were outside the scope of the incident; this check confirms they remain internally consistent, not that they independently corroborate the 18 COGS entries' amounts.
- **Idempotency keys:** all 18 `SalesFulfilment` rows have a non-null, unique `idempotencyKey` — no collisions. This shows the _fulfilment_ records are not duplicated, but says nothing about whether the _journal entry_ attached to each is a faithful reconstruction.
- **Accounting period status:** of the 4 periods on record, July 2026 is `CLOSED`; August, September, and October 2026 are `OPEN`. All 18 fulfilment dates fall in August, September, or October 2026 — meaning the reconstruction succeeded only because none of the affected postings fell in a closed period at the time it ran. **This is a time-sensitive fact**: had any original entry been dated in a period that was closed by the time of reconstruction, `postSystemJournalEntry`'s period-status gate (not independently re-verified line-by-line in this review beyond confirming the gate exists in the function used) would have blocked that specific recovery, and no entry in this set tests that path.
- **Other AuditLog actions:** exactly 3 `AuditLog` rows exist with `entityType = 'SalesFulfilment'` in this organisation, all for `sales.fulfilment-cogs-posted` — the same 3 fulfilments identified in §C.1. No other independent audit trail (e.g., an `ORDER_FULFILLED` audit row keyed by fulfilment, or any inventory-valuation audit action) was found for the remaining 15.

**This review does not treat balanced debits/credits, or internally consistent idempotency/FK structure, as proof of complete recovery** — per the task's explicit instruction. These checks establish that _surrounding_ records were not corrupted by the deletion or the reconstruction, not that the reconstructed _journal amounts themselves_ are correct beyond the 3 corroborated cases.

**Not checked in this review** (would require either privileged access beyond what was used, or query scope beyond the 18-entry/related-record set defined above): downstream financial reports or dashboards that may have cached or previously displayed the original `journalEntryId`/`journalNumber`/`createdAt` values before the incident (for example exported reports, PDFs, or external statements generated before 2026-10-12). If any such artifact exists outside the database, it was not located or inspected by this review and would require separate, specifically scoped review.

---

## E. Test-Isolation Assessment

**Database identity and connection target (established before any query in this review, per the task's mandatory pre-query protocol):**

- `apps/api/.env` `DATABASE_URL` resolves to `postgresql://zentuva:[REDACTED]@localhost:5432/zentuva`.
- `jest.config.js` and `jest.integration.config.js` were grepped for any `DATABASE_URL` override — neither sets one. No `.env.test` file exists.
- **Conclusion: there is exactly one database, used interchangeably by the running dev API, every unit test, every integration test, and every ad-hoc script in this environment.** No isolated, disposable, or schema-separated test database exists anywhere in this project's current configuration.
- The connecting role `zentuva` was confirmed (via `pg_roles`) to have `rolsuper = true`, `rolcreatedb = true`, `rolcreaterole = true`, `rolbypassrls = true` — full superuser privilege, with no permission-based restriction against any table, including every financial table.

**The specific fix evaluated:**

- `cleanupTestData()` in `apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts` (read fresh in this review session) now resolves the test's own disposable fulfilment ids first (via `locationId: { in: [warehouseLocationId, outletLocationId] } }`, where those location ids were themselves created by this same test's `beforeAll`), then scopes every `deleteMany` — on `SalesFulfilmentItem`, `JournalEntryLine`, `JournalEntry`, and `SalesFulfilment` — to those exact ids. It never repeats the original bare-`sourceType` filter pattern described in the incident narrative.
- A survey of every other `*.integration.spec.ts` file in the repository (14 files total) found that none of them use an unscoped, bare-type-only `deleteMany` against `JournalEntry`/`JournalEntryLine` or any other shared table. `payment-allocation-concurrency.integration.spec.ts`, the one other file that deletes `JournalEntry` rows, scopes its deletion by both `sourceType` and an explicit `sourceId: { in: ... }` list resolved from its own fixtures — the same pattern now used by the fixed Phase 2C test. **This specific failure mode (unscoped deletion of a shared financial table by type alone) does not currently recur elsewhere in the test suite**, to the extent this review's survey covered all existing integration spec files.

**What remains structurally unaddressed (the 12-point assessment):**

1. **Database-connection selection**: no mechanism exists to select a different database for tests versus the running application — both use the same `DATABASE_URL`.
2. **Env-var precedence**: not applicable — there is no second env var or override path to reason about; only one exists.
3. **Cleanup scoping**: fixed _for this one function_, as described above — but scoping correctness depends entirely on each individual test author remembering to resolve and pass exact ids, with no shared helper or linting rule enforcing it.
4. **Cascade risk into financial tables**: remains structurally possible for any _future_ test file that writes a similarly-shaped but under-scoped cleanup query — nothing prevents it at the database, framework, or tooling level.
5. **Identity verification before destructive operations**: none exists. No test or cleanup utility checks which database it is connected to, or asks for confirmation, before issuing a `deleteMany`.
6. **Credential separation**: none. The test suite, the ad-hoc scripts used in this very review, and the running API all authenticate as the same superuser role.
7. **Permission restriction**: none. The role can create, alter, or drop anything in the database.
8. **Isolated schemas / disposable databases / transaction rollback**: none of the three exists. Tests commit real `DELETE`/`INSERT` statements directly against the shared database; nothing is wrapped in a rolled-back transaction.
9. **CI vs. local parity**: not assessable as a comparison, because no CI configuration was found in this repository (no `.github/workflows` directory, no `.gitlab-ci.yml`, no equivalent). `apps/api/package.json` defines `test` (unit, default Jest config) and `test:integration` (`jest.integration.config.js`, run with `--runInBand`) as local scripts only; there is no evidence either is wired into an automated pipeline.
10. **Does the fix prevent the exact failure mode?** Yes, for the one function and the one file reviewed — a bare `sourceType`-only filter can no longer run from this specific cleanup path.
11. **Could a future misconfiguration bypass this protection?** Yes. Nothing prevents a different test file, or a future edit to this same file, from reintroducing an unscoped `deleteMany` against `JournalEntry` or any other financial table — the safeguard is the specific query text in one function, not an enforced structural control (no database-level restriction, no shared "test-safe delete" helper, no fail-closed identity gate).
12. **Preferred layered controls, per the task's stated preference, and their current status:** isolated/disposable test database — **absent**; separate restricted credentials — **absent**; fail-closed identity check before destructive test operations — **absent**; cleanup restricted to test-owned data by construction (e.g., a shared helper that cannot be called without explicit ids) — **absent as a shared/enforced mechanism**, though present as one-off discipline in the fixed function; explicit safeguards with clear failure behavior on ambiguous identity — **absent**.

---

## F. Regression-Test Assessment

- The test file containing the fix (`sales-fulfilment-outlet-integration.integration.spec.ts`) has 5 `it(...)` test cases, all exercising business behavior: COGS posting correctness, idempotency-key retry safety, no-outlet fallback behavior, rollback on ownership conflict, and concurrency/oversell protection. **None of the 5 tests asserts anything about cleanup safety.** None checks that running `cleanupTestData()` leaves pre-existing, non-test financial records (such as the 18 real entries this file itself once deleted) untouched.
- No test anywhere in the repository was found that specifically verifies "test cleanup refuses to run, or cannot succeed, against a non-test/non-isolated target."
- Consequently: **the current regression protection is the corrected query text inside one function, with no test asserting the safety property that query text is meant to guarantee.** A future edit to that same function that reintroduces a bare `sourceType` filter would not be caught by any automated check — it would pass all 5 existing `it(...)` blocks (which only assert on data the test itself created) and would only be caught by a human noticing the diff.
- Per the task's explicit instruction, this review does not write or execute any such test. The gap is recommended for remediation in §I, not fixed here.
- Separately, since all integration tests (including this one) run against the single live-identical database described in §E, with no sandboxing: **any future destructive regression test that specifically tries to prove the safety property (e.g., "seed a fake pre-existing record, run cleanup, assert it's untouched") must not be run against this database** — doing so would itself be a risk of the same class this review is investigating, and is explicitly out of scope for this review to attempt.

---

## G. Evidence and Limitations

**Independently verified by this review (re-derived from source/database, not merely restated from the completion report):**

- Database identity, connection target, and role privilege level (§E).
- The exact current content of `cleanupTestData()` and its surrounding comment, read fresh from the file in this session.
- The existence, count, and full content of `AuditLog` rows for `sales.fulfilment-cogs-posted` and `sales-order.fulfilled` (3 each).
- The current state of all 18 `JournalEntry`/`JournalEntryLine` rows, their `createdAt` clustering, and their internal debit/credit balance.
- The absence of CI configuration and of a `.env.test`/test-database override.
- The survival, count, and linkage of related `InventoryTransaction`, `Invoice`, and `PaymentAllocation` records.
- The absence of any committed git artifact of the original buggy cleanup code.

**Taken from the completion report or the prior session's own narrative, and not independently verifiable by this review:**

- The exact original form of the buggy query (its precise filter clause and which file/command it ran from).
- The original `createdAt` timestamps, descriptions, and (for 15 of 18 entries) the original amounts and journal numbers.
- The claim that reconstruction was "verified byte-identical to the original reconciliation baseline" (code comment, lines 105–114 of the spec file) — contradicted on primary key and timestamp for the 3 entries this review _could_ check, and unverifiable either way for the other 15.
- The claim that the GL was "re-confirmed balanced" after reconstruction — this review independently confirmed debits equal credits for all 18 _current_ entries, which is consistent with that claim, but did not have access to a pre-incident trial balance to confirm the _organisation-wide_ GL was unaffected beyond these 18 entries.

**Assumptions this review explicitly avoided making:** that the current database state is the original state (§C); that passing the 5 existing tests proves the cleanup vulnerability is closed (§F); that matching the still-intact `SalesFulfilmentItem.costAmount` figures constitutes independent corroboration (§C.2); that a database's name or `.env` label of "the" database implies it is safe for destructive testing (no such database was used, and none was found to exist separately in any case).

---

## H. Risk Register

Severity definitions (fixed, as specified for this review): **Critical** = potential financial misstatement, uncontrolled mutation capability, or unverified integrity. **High** = significant risk affecting financial reporting or permitting a repeat incident. **Medium** = material control weakness with limited or indirect impact. **Low** = documentation/maintainability issue with no demonstrated material risk.

| #   | Finding                                                                                                                                                                                                                                                                           | Severity     | Basis                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No isolated test database exists; all tests and ad-hoc scripts run against the same database as the live application, using a superuser credential with unrestricted write/delete privilege on every table.                                                                       | **Critical** | Independently confirmed in §E. This is the structural precondition that made the original incident possible and remains fully present today — a different under-scoped query in any future test could reproduce the same class of loss against real financial data. |
| 2   | No regression test verifies that test cleanup cannot mutate non-test financial records; the only safeguard is corrected query text in one function.                                                                                                                               | **High**     | §F. A future edit to that function, or a new test elsewhere following the old pattern, would not be caught by any automated check.                                                                                                                                  |
| 3   | 15 of 18 reconstructed journal entries have no independent, durable, pre-incident corroboration of their original amount, journal number, or identifiers.                                                                                                                         | **High**     | §C.2. Their current figures are internally consistent but not independently verified; this review cannot certify their accuracy as recoveries of a true original.                                                                                                   |
| 4   | A code comment in the fixed test file asserts the reconstruction was "verified byte-identical to the original reconciliation baseline" — a claim this review found to be inaccurate for the fields it could check (primary key, timestamp) and unverifiable for 15 of 18 entries. | **Medium**   | §C.1, §G. This is a documentation-accuracy risk that could mislead a future reader into over-trusting the recovery; it does not by itself indicate a financial misstatement.                                                                                        |
| 5   | No CI pipeline exists to run the integration test suite (including the fixed cleanup) automatically on any change.                                                                                                                                                                | **Medium**   | §E, point 9. Reduces confidence that the fix — or any future change to the same file — will be exercised consistently before merge.                                                                                                                                 |
| 6   | The reconstruction's success depended on all 18 affected dates falling in accounting periods still `OPEN` at the time of recovery; this is time-sensitive and not a repeatable guarantee for a future incident of the same kind.                                                  | **Medium**   | §D. If a similar incident recurred against entries in a now-closed period, the same recovery path would not be available without separate, period-reopening authorization.                                                                                          |
| 7   | No shared or enforced helper exists to make "cleanup scoped to test-owned ids only" the default; correctness depends on each test author repeating the pattern correctly.                                                                                                         | **Medium**   | §E, points 3–4, 12.                                                                                                                                                                                                                                                 |

---

## I. Recommended Remediation Plan

_(Sequenced as required. No remediation was performed in this review.)_

1. **Immediate containment / evidence preservation**: Export and durably archive (outside the live database) the current full state of the 18 `JournalEntry`/`JournalEntryLine` rows, the 3 corroborating `AuditLog` rows, and this report, before any further write activity touches these records — so that even the current (partially-unverified) state cannot later be lost or altered without a preserved snapshot.
2. **Financial recovery verification / separately authorized remediation**: Obtain or produce an independent baseline for the 15 uncorroborated entries if one exists outside this system (e.g., a prior export, a bank/supplier reconciliation, or management's own transaction records) and compare against it under separately authorized review. If no such baseline can be found, document that fact explicitly in the organisation's own books/notes, since this review cannot create one retroactively.
3. **Test-isolation and cleanup-safety improvements**: Stand up a genuinely isolated, disposable test database (separate instance, schema, or at minimum a distinctly named database with its own non-superuser credential restricted to that database only) and migrate all integration tests to use it exclusively. Introduce a shared "scoped delete" helper or equivalent convention that makes an unscoped financial-table deletion structurally difficult to write by accident.
4. **Regression testing in a disposable environment**: Once the isolated database from step 3 exists, add a dedicated test proving that cleanup cannot affect records outside the current test run's own ids — executed only against that disposable database, never against the live business database, even as a negative-test fixture.
5. **Independent approval to resume affected operations**: Obtain sign-off from someone independent of the engineer(s) who performed the original implementation and reconstruction, specifically on: (a) whether the 15 uncorroborated entries are acceptable as-is or require further reconciliation, and (b) whether the corrected comment language and remediation steps above are sufficient before any further Phase 2C or D2C work proceeds.

---

## J. Go/No-Go Decision

**CONDITIONAL GO.**

Rationale: The three entries for which independent, structurally un-cascadable corroboration exists (SO-000006 ×2, SO-000010) show an exact match on monetary total and journal number — a genuine positive signal, not merely a passing test or a balanced GL. Related inventory, invoice, and payment-allocation records were independently confirmed intact and consistent. The specific query pattern that caused the original incident has been closed in the one function responsible, and no other test file in the repository currently repeats that pattern.

However, this is not an unconditional GO because: (1) 15 of the 18 reconstructed entries have no independent corroboration and cannot be certified as accurate recoveries — only as internally consistent; (2) the structural vulnerability that made the incident possible at all — a single shared database, superuser test credentials, no isolation, no fail-closed identity check — remains fully present, so the same class of incident could recur in a different test tomorrow; and (3) no automated regression test or CI pipeline exists to guard against a recurrence, in this file or any other. This conclusion is not issued merely because the GL balances or because existing tests pass — both are true and are explicitly insufficient grounds on their own, per the review's own instructions.

Operation may continue for existing, already-posted records, but Phase 2C/D2C work should not proceed to new features until at minimum remediation steps 3–4 in §I are addressed, and step 2's independent verification of the 15 uncorroborated entries should be pursued as soon as practicable rather than deferred indefinitely.

---

_This report was produced by a strictly read-only investigation. No journal entry, journal line, payment allocation, invoice, credit note, inventory transaction, financial period, account balance, or audit record was created, modified, or deleted by this review. No migration, seeder, cleanup script, or database-mutating command was run. All disposable read-only inspection scripts used during this review were removed from the working tree before this report was finalized._
