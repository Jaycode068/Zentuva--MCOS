# Stage 4E.4D.1 — Inventory Adjustment Account Provisioning and Verification

Narrowly scoped. One account created on the development database (explicitly
authorized this stage); no journal, no inventory adjustment, no accounting-period
change, nothing staged/committed/pushed.

## 1. Account provisioning method

A new, standalone, guarded script —
[provision-inventory-adjustment-account.js](apps/api/scripts/provision-inventory-adjustment-account.js) —
rather than the full `prisma/seed.ts` (explicitly disallowed this stage). It reuses the
same `assertDevelopmentDatabaseReady()` identity guard every existing
`guarded-db-*.js` wrapper uses (verifies the configured `DATABASE_URL` is
server-confirmed as the designated development database before touching anything),
then mirrors `seedInventoryAdjustmentAccount`'s exact idempotent logic (find-by-
`systemKey`, skip if present; otherwise create with the same code/name/type/parent),
inlined rather than imported — `prisma/seed.ts` exports nothing today, and adding an
export purely for this one-off felt like more change to that file than the task
warranted. Extended with one additional safeguard the seed function itself doesn't
need (seed.ts only ever runs against a single, already-verified-empty-of-this-key
org): an explicit check that code `6900` isn't already taken by something else for
each organisation, which would otherwise surface only as a raw `P2002` error from a
blind `create`. Per organisation found with such a conflict, the script logs it and
skips that organisation rather than overwriting or reassigning — none was
encountered. Run once: `node scripts/provision-inventory-adjustment-account.js`,
output confirmed in Section 3.

## 2. Account code and system-key verification

Preflight confirmed, before any write: `INVENTORY_ADJUSTMENT` is present in
`SYSTEM_ACCOUNT_KEYS` ([chart-of-account-keys.ts](apps/api/src/finance/accounting/chart-of-account-keys.ts):74),
classified `EXPENSE` in the seed definition. The development organisation's highest
existing account code was `6800` ("Interest Expense") — confirmed by listing its full
34-row Chart of Accounts before writing — so code `6900` does **not** collide (the
`6700`/`6800` collision discovered against the test database in Stage 4E.4D does not
recur here; `6900` was chosen specifically because of that earlier finding). No
organisation already carried the `INVENTORY_ADJUSTMENT` systemKey. Only one
organisation exists in development ("Boby Bites") — no conflict across tenants was
possible to find, and none was found for this one.

Post-creation, read back directly: `code: "6900"`, `type: "EXPENSE"`,
`isSystemAccount: true`, `isActive: true`, `systemKey: "INVENTORY_ADJUSTMENT"`,
parented under `6000 Expenses`. `createdById`/`updatedById` set to the same actor
id every other seeded system account for this organisation already carries, for
consistency (both fields are nullable — not required — but matched rather than left
blank). **Zero opening balance confirmed**: `0` `JournalEntryLine` rows reference the
new account's id.

## 3. Before/after development account counts

|                                                | Before     | After      |
| ---------------------------------------------- | ---------- | ---------- |
| ChartOfAccount                                 | 34         | **35**     |
| InventoryTransaction                           | 35         | 35         |
| InventoryStock                                 | 8          | 8          |
| JournalEntry                                   | 35         | 35         |
| JournalEntryLine                               | 73         | 73         |
| AccountingPeriod                               | 3          | 3          |
| Inventory valuation (Σ qty × cost, unfiltered) | ₦2,380,990 | ₦2,380,990 |

Script output: `[provision] Created INVENTORY_ADJUSTMENT for "Boby Bites": id=cmv9s0ur100017fkjzcan51ff, code=6900.`
The ChartOfAccount count is the **only** change — exactly the authorized, narrowly
scoped write.

## 4. Confirmation of unchanged journals, stock, and accounting periods

Re-queried directly after provisioning: all 35 `InventoryTransaction` rows, all 8
`InventoryStock` rows (same quantities, same costs, same total valuation to the
naira), all 35 `JournalEntry`/73 `JournalEntryLine` rows unchanged. All 3
`AccountingPeriod` rows unchanged in name/dates/status (August 2026 `OPEN`, October
2026 `OPEN`, July 2026 `CLOSED`). No adjustment, journal, or period write of any kind
occurred — confirmed by the count table above matching exactly.

## 5. API and account-resolver verification

`GET /api/health` → `200`, both before and after provisioning (no restart was
triggered — this was a pure data write, no code or schema change, no `prisma
generate`). The **real** `resolveSystemAccountId` function (not a reimplementation)
was called read-only, directly, against the development database — no transaction, no
write — and correctly resolved `INVENTORY_ADJUSTMENT` for the Boby Bites organisation
to the exact id just created (`cmv9s0ur100017fkjzcan51ff`). No development adjustment
was created to test posting, per instruction — the resolver call alone is sufficient
proof it can be found.

## 6. Test results

**Isolated integration verification** (guarded test database,
`inventory-adjustment-idempotency.integration.spec.ts`) — all 19 tests pass,
covering every scenario this stage asked for: positive adjustment (DR Inventory / CR
Inventory Adjustment), negative adjustment (DR Inventory Adjustment / CR Inventory),
finished-goods account selection, customer-owned stock operationally visible but
excluded from company valuation, customer-owned adjustments posting no company
journal, identical retries creating no duplicate transaction or journal, journal
failure (missing account) rolling back the stock change, and 2-decimal rounding.

**Full `test:integration` run**: 13/16 suites pass (107 tests: 91 pass, 16 fail — all
16 in the 3 suites below). **The three previously observed failures, unchanged,
reported individually as instructed — not modified to force green:**

1. `src/reporting/reporting-tenant-isolation.integration.spec.ts` — 8 tests, each
   failing with `This test requires at least one other seeded organisation.`
   (Receivables; Payables; Inventory valuation; Sales performance; Workforce summary;
   Production performance; Procurement summary; Executive dashboard — Sprint 46's
   Final Architectural proof.)
2. `src/d2c/conversation-config/d2c-conversation-config-active-safety.integration.spec.ts` —
   3 tests failing with `This test requires at least 2 seeded organisations.` ("an
   admin config save mid-flight never touches an active conversation's persisted
   state"; "the very next config resolution DOES reflect the admin's change"; "Final
   Architectural Test (brief) — getAdminView/getPreview for two real tenants"), plus a
   suite-level `afterAll` crash (`PrismaClientValidationError`, `undefined` in an `in:
[...]` filter) that is a direct downstream consequence of the same `beforeAll`
   failure (the second org id never got assigned).
3. `src/d2c/conversation-config/d2c-conversation-config-concurrency.integration.spec.ts` —
   5 tests, same `requires at least 2 seeded organisations` reason ("two concurrent
   updates to the SAME message key"; "two concurrent updates to DIFFERENT message
   keys"; "a concurrent update and reset-to-default"; "concurrent capability saves for
   Tenant A and Tenant B"; "a read for Tenant A during a concurrent write storm for
   Tenant B"), plus the same downstream `afterAll` crash shape.

Root cause, re-confirmed: the isolated test database has exactly one real seeded
organisation (Boby Bites); these three files' own `beforeAll` hooks require a second,
pre-existing one and — unlike every other integration file in this codebase,
including every file this and the prior stage touched — never create their own
disposable second tenant. **Zero diff** on all three files this stage or the prior
one (confirmed again). Two sibling files
(`customer-account-reconciliation.integration.spec.ts`,
`inventory-location-ownership-foundation.integration.spec.ts`) hit the identical
single-org condition but handle it gracefully (`console.warn` + skip) rather than
throwing — the robust pattern the three failing files don't use. Not modified; out of
this stage's scope.

**Unit**: `src/inventory/` + `src/finance/` — 90 suites / 748 tests, all passing.
Full default suite — 273 suites / 2630 tests, all passing. **Type-check**: clean.
**Lint**: clean on every file under this project's lint config (the new script, like
every existing `scripts/*.js` wrapper, is outside the TS-project-based lint config's
reach — confirmed identical behavior on `guarded-db-seed.js`, not a gap this script
introduced).

## 7. Remaining risks

- The three pre-existing, unrelated integration-test failures (Section 6) remain
  unresolved — they require either seeding a second organisation generally (a larger,
  separately-scoped decision) or giving each of those three files its own disposable
  second tenant (a small fix, but to files this stage was not asked to touch).
- `INVENTORY_ADJUSTMENT` is now provisioned for the one existing development tenant
  only. Any future tenant still depends on `seedChartOfAccounts`'s own
  `BOBY_BITES_CHART_OF_ACCOUNTS` list (already includes it, from Stage 4E.4D) or an
  equivalent onboarding step — the "no generic runtime auto-provisioning exists"
  limitation already flagged in Stage 4E.4C.1 is unchanged by this stage.
- Code `6900` is now taken in **both** the development and test Chart of Accounts for
  this tenant; any future new system account must pick a different code in that
  tenant specifically (not a universal constraint — a different tenant's chart could
  still have `6900` free).

## 8. Final Stage 4E.4D deployment status

**Complete.** The accounting implementation (Stage 4E.4D) and the account
provisioning it depended on (this stage) are both now live on development:
`INVENTORY_ADJUSTMENT` exists, resolves correctly, and the dev API is healthy. The
fail-closed gap Stage 4E.4D's own completion report flagged — 7 of 8 dev
`InventoryStock` rows would have failed any new value-bearing adjustment with
`MissingSystemAccountError` — is now closed. No manual adjustment was created to
confirm this live, per instruction; it follows directly from Section 5's
resolver proof plus the already-tested, unchanged repository/service code path.
Backup checksum re-verified `OK`; safety copy untouched.

---

Stage 4E.4D.1 is complete. Stopping here for review, per instruction.
