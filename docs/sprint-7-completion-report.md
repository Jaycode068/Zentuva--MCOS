# Sprint 7 Completion Report — General Ledger & Accounting Foundation

## 1. Objective

Establish the accounting engine underneath Zentuva's existing Finance domain — a
tenant-defined Chart of Accounts, Accounting Periods, double-entry Journal Entries,
and a General Ledger/Trial Balance/Account Activity reporting surface — then wire
Sprint 6's three financial events (invoice issued, payment recorded, credit note
issued) to post journal entries automatically. Explicitly the accounting **engine**,
not accounting **software**: no Chart of Accounts → financial-statement closing, no
Accounts Payable, no tax engine, no accounting integration for any domain other than
Finance this sprint.

**Business problem:** Sprint 6 gave Finance a record-entry layer with no accounting
behind it — an issued invoice or a recorded payment had no double-entry consequence
anywhere in the system. This sprint closes that gap for Finance's own three events,
while establishing a posting boundary future Procurement/Production/Inventory
integrations can reuse without depending on the Finance module.

## 2. Architecture Decisions

| Decision                     | Choice                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money precision              | `Float` + `roundCurrency()`, matching every prior sprint                                                                                                                                   | The brief claimed "the same Decimal conventions already established in Sprint 6" — but Sprint 6 (and every prior sprint) uses plain `Float`; `Decimal` has never been used anywhere in this codebase. Followed the actual codebase convention, not the brief's mistaken assumption                                        |
| Model naming                 | `ChartOfAccount`, not `Account`                                                                                                                                                            | `Account` would collide with the pre-existing, unrelated self-service `AccountModule`/`AccountController` (`apps/api/src/identity/account/`)                                                                                                                                                                              |
| Where the code lives         | `apps/api/src/finance/accounting/`, registered on the _existing_ `FinanceModule` — no new NestJS module                                                                                    | `FinanceModule` already bundles several sub-concepts as one module; HTTP routes stay under `/api/finance/*`, matching the existing `/settings/finance` frontend nav                                                                                                                                                       |
| Atomic posting boundary      | Plain, dependency-injection-free functions (`journal-posting.ts`) taking a Prisma `Prisma.TransactionClient` as their first argument, called from inside the caller's _own_ `$transaction` | A NestJS-injected service would open a separate transaction via its own `PrismaService`, breaking atomicity. Mirrors the existing `deriveInvoiceStatusAfterApplication` pattern (plain functions shared across repository files). Future domains can import these functions directly without depending on `FinanceModule` |
| System account lookup        | `ChartOfAccount.systemKey` + `@@unique([organisationId, systemKey])`                                                                                                                       | The brief's own suggested mechanism — no account id is ever hardcoded; multiple `NULL`s are allowed in a Postgres unique index, so only real system accounts constrain each other                                                                                                                                         |
| Payment method → account     | `CASH` → `CASH` system account; everything else → `BANK`                                                                                                                                   | The brief explicitly warns against "unnecessary payment-method complexity"                                                                                                                                                                                                                                                |
| Period resolution            | The journal's `date` alone resolves its `accountingPeriodId` — no independent client-supplied period selection                                                                             | A client-supplied period that could disagree with the client-supplied date is a bug waiting to happen                                                                                                                                                                                                                     |
| Manual journal lifecycle     | Two explicit steps: `POST /journal-entries` creates `DRAFT` (already balance-validated), `POST .../:id/post` is the separate atomic action                                                 | Matches the brief's literal `DRAFT → POSTED` lifecycle; no edit-draft endpoint exists since there's no described draft-editing workflow                                                                                                                                                                                   |
| System-generated entries     | Created directly as `POSTED`, no `DRAFT` interval                                                                                                                                          | A system posting is the direct consequence of an already-committed business event — there's no one reviewing it first                                                                                                                                                                                                     |
| Duplicate-posting prevention | `@@unique([organisationId, sourceType, sourceId])` on `JournalEntry`                                                                                                                       | Independent of, and in addition to, `Payment`/`CreditNote`'s own `idempotencyKey` — the brief explicitly demanded a deterministic uniqueness constraint, tested with duplicate invocation                                                                                                                                 |
| `VOID` semantics             | A bare status flip, excludes the entry from every balance query going forward — no automatic reversing entry                                                                               | The brief explicitly says not to build full reversal functionality unless simple and necessary; a true correction is a new manual journal                                                                                                                                                                                 |
| Trial Balance presentation   | `netBalance = totalDebit − totalCredit` per account, split by sign into Debit/Credit columns                                                                                               | Since the whole ledger balances by double-entry construction, splitting and summing always produces two equal totals — no per-account-type sign logic needed                                                                                                                                                              |
| Running balance              | Computed in application code from an ordered query result                                                                                                                                  | Matches the brief's explicit "the backend should calculate them deterministically from the ordered ledger entries"                                                                                                                                                                                                        |
| Seed periods                 | "July 2026" (posted into, then closed) + "August 2026" (`OPEN`)                                                                                                                            | Sprint 6's existing seed fixtures span both months; this demonstrates a real closed period with real posted history _and_ gives every seeded fixture a postable period                                                                                                                                                    |

## 3. Database Changes

Migration `20260824143344_add_accounting_foundation` — purely additive: 3 new enums
(`AccountType`, `AccountingPeriodStatus`, `JournalEntryStatus`), 4 new models
(`ChartOfAccount`, `AccountingPeriod`, `JournalEntry`, `JournalEntryLine`), back-
relations on `Organisation`. Full schema detail in
[`docs/domains/accounting.md`](domains/accounting.md) §3.

## 4. API

19 new endpoints under `/api/finance/*` — full table in
[`docs/domains/accounting.md`](domains/accounting.md) §10. Highlights: Chart of
Accounts CRUD + activate/deactivate + account activity; Accounting Period create/close;
Journal Entry create/post/void; General Ledger/Trial Balance queries.

## 5. Backend Implementation

New directory `apps/api/src/finance/accounting/` (14 files):
`chart-of-account-keys.ts` (`SYSTEM_ACCOUNT_KEYS`), `chart-of-account.{repository,
service,controller}.ts`, `accounting-period.{repository,service,controller}.ts`,
`journal-posting.ts` (the atomic-transaction plain-function boundary), `journal-entry.
{repository,service,controller}.ts`, `ledger.{service,controller}.ts`,
`accounting-audit-actions.ts`. Registered on the existing `FinanceModule`.

Modified: `invoice.repository.ts` (new transactional `issue()` method, replacing the
generic `updateStatus` call for that transition), `invoice.service.ts` (catches
`MissingSystemAccountError`/`NoOpenPeriodError`/`UnbalancedPostingError`),
`payment.repository.ts`/`payment.service.ts`, `credit-note.repository.ts`/
`credit-note.service.ts` (same shape). `packages/validation/src/accounting.ts` (new)
— `createChartOfAccountSchema`, `updateChartOfAccountSchema`,
`createAccountingPeriodSchema`, `journalEntryLineInputSchema` (exactly-one-of-debit-
credit refine), `createJournalEntrySchema` (balance refine, min-2-lines).

## 6. Frontend Implementation

`apps/web/src/components/app/finance-tabs.tsx` extended to 10 tabs (now horizontally
scrollable at narrow widths). New `apps/web/src/app/(app)/settings/finance/`
subdirectories: `accounts/` (tree view + create/edit dialog), `journal-entries/`
(create-then-post dialog with live totals + detail/void view), `ledger/` (filterable,
running-balance table), `trial-balance/` (period selector, balanced confirmation),
`accounting-periods/` (list + create dialog + close action). `api.ts`/`labels.ts`
extended with every new type/function/label map.

## 7. Accounting Rules / Finance Integration

Double-entry validation is server-authoritative at every layer (Zod refine → service
re-validation → `journal-posting.ts`'s own defensive check) — never trusted from the
client. `Invoice.issue()` posts `DR Accounts Receivable / CR Sales Revenue`;
`PaymentRepository.create()` posts `DR Cash-or-Bank / CR Accounts Receivable`;
`CreditNoteRepository.issue()` posts `DR Sales Returns / CR Accounts Receivable` — all
three inside the same `$transaction` as the Finance write that triggers them, so a
failed posting (no open period, no configured system account) rolls the whole
operation back. Full rules in [`docs/domains/accounting.md`](domains/accounting.md)
§3–4.

## 8. Tests

- `chart-of-account.service.spec.ts` (14 tests): create/update, parent-hierarchy,
  cycle-prevention, duplicate-code rejected, tenant isolation, system-account
  deactivation blocked.
- `accounting-period.service.spec.ts` (9 tests): create, overlap rejected (`it.each`
  across 5 overlap shapes), close, close-already-closed rejected, tenant isolation.
- `journal-posting.spec.ts` (11 tests, deliberate in-memory-fake-`tx` exception, same
  convention as Sprint 6's `payment.repository.spec.ts`): system-account resolution,
  open-period resolution, balanced posting succeeds, idempotent on
  `(sourceType, sourceId)`, missing-system-account/no-open-period/unbalanced all
  rejected.
- `journal-entry.service.spec.ts` (13 tests): balanced succeeds, unbalanced rejected,
  inactive/foreign account rejected, `post()` requires `DRAFT`, closed-period post
  rejected, `void()` from either status.
- `ledger.service.spec.ts` (7 tests): running balance across an ordered sequence,
  Trial Balance always balances (property-style assertion), default-POSTED-only
  filtering, tenant scoping on every query.
- Controller specs (`chart-of-account`/`accounting-period`/`journal-entry`/`ledger`,
  16 tests total): audit fires on every write, `ledger` read-only.
- Finance-integration additions to the **existing** `payment.repository.spec.ts`
  (DR Cash/DR Bank line-shape assertion + exactly-one-journal-on-replay),
  `credit-note.repository.spec.ts` (DR Sales Returns line-shape assertion +
  journal-count-unchanged-on-rejected-reissue), and `invoice.service.spec.ts`
  (`NoOpenPeriodError`/`MissingSystemAccountError` translated to `BadRequestException`).
- **Full suite:** 62 test suites, 629 tests, all passing. `tsc --noEmit` clean on both
  `apps/api` and `apps/web`. `eslint --max-warnings=0` clean on both. Production
  builds (`nest build`, `next build`) both succeed.

## 9. Live Verification Performed

Against the actual running application (API on :4000, Web on :3000):

1. **Chart of Accounts** — created `1210 Trade Receivables` under `1200 Accounts
Receivable`; confirmed it renders nested at the correct depth in the tree.
2. **Manual journal** — `DR Bank ₦100,000 / CR Product Sales ₦100,000`, posted via the
   create-then-post dialog; confirmed it appears in Journal Entries (`POSTED`), in the
   General Ledger, and that the Trial Balance updates and stays balanced.
3. **Unbalanced journal** — a direct API call with `DR ₦100,000`/`CR ₦90,000` was
   rejected `400` with "Total debits must equal total credits" (the client button is
   also disabled for this case, but the server rejection was verified independently,
   per the brief's "never rely on frontend validation" instruction).
4. **Invoice** — created and issued a real invoice (`INV-000005`, `SO-000008`) from
   the existing Finance module; confirmed `DR Accounts Receivable / CR Sales Revenue`
   (`JE-000010`) appeared automatically, linked to the invoice.
5. **Payment** — recorded a `CASH` payment against `INV-000005`; confirmed `DR 1110
Cash / CR Accounts Receivable` (`JE-000011`, correctly using the `CASH` system
   account, not `BANK`), and that AR's Trial Balance figure moved correctly.
6. **Credit note** — issued a credit note against `INV-000004`; confirmed `DR Sales
Returns / CR Accounts Receivable` (`JE-000012`).
7. **Tenant isolation** — minted a valid token for a real second-organisation user
   (Sahara Textiles) and confirmed empty/404/403 across every new endpoint: `GET
/accounts`, `/accounting-periods`, `/journal-entries`, `/trial-balance`, `/ledger`
   (all empty lists), a direct `GET` of a real Boby Bites account (`404`), and
   attempted writes (period close, journal void — both `403`).
8. **Closed period** — closed "August 2026"; confirmed a `DRAFT` journal could still
   be _created_ against it (by design — only `post()` requires `OPEN`), then confirmed
   the actual `POST .../post` call was rejected `400` with "The accounting period
   \"August 2026\" is closed — cannot post into it."
9. **Responsive pass (375px)** — Chart of Accounts and Trial Balance render as
   horizontally-scrollable tables (appropriate for hierarchical/columnar data, per the
   brief's own "cards or horizontally scrollable data where appropriate" guidance);
   Journal Entries and General Ledger render as card lists; Accounting Periods renders
   as a small horizontally-scrollable table. No overlap or broken layout at any width.

Seed data verified via direct database inspection (not just the app UI): 24 Chart of
Accounts, 2 Accounting Periods (July `CLOSED`, August `OPEN`), 8 journal entries, every
one individually balanced and the grand total balanced (`Σdebit === Σcredit ===
₦10,538,800`). Re-ran `pnpm db:seed` three times total across the sprint — every count
identical, confirming idempotency held even after a full manual reset-and-rebuild of
the Finance/Accounting tables mid-sprint (needed once, to get a clean baseline after
earlier live-testing sessions had already touched the seed fixtures — see §10).

## 10. Bugs Found and Fixed During This Sprint

- **The only `window.confirm()` call anywhere in the frontend.** The Accounting
  Periods "Close" button initially used a native `confirm()` dialog — foreign to this
  codebase's convention (every other one-way action executes directly on click with a
  loading state, no native dialog). Caught live: the native dialog silently blocked
  automated browser testing (auto-dismissed as "cancel"), which is exactly the kind of
  UX inconsistency worth catching. Removed to match the established pattern.
- **Not a code bug, but worth recording:** mid-sprint live verification required
  fully resetting Finance/Accounting data for the Boby Bites organisation and
  re-running the seed, because earlier live-testing sessions (this sprint's own
  Scenario 2–6 walkthrough plus artifacts from Sprint 6's own verification) had
  already consumed the seed's fixed invoice/payment fixtures before the new
  accounting-posting code in `seedFinance` ever got a chance to run against them
  (the function's own `INV-000001`-existence guard short-circuited before reaching
  the new posting calls). Resolved by deleting the organisation's Payment/CreditNote/
  Invoice/JournalEntry/AccountingPeriod/ChartOfAccount rows and re-seeding from
  scratch — confirmed correct and then re-verified idempotent on top of that.

## 11. Known Limitations

See [`docs/domains/accounting.md`](domains/accounting.md) §11 for the full list.
Highlights: no re-opening a closed period; `VOID` never generates an automatic
reversing entry; General Ledger running balance is most meaningful filtered to one
account; no financial-statement layer on top of Trial Balance; no accounting
integration yet for Procurement/Production/Inventory/Sales Fulfilment/Distribution.

## 12. Deferred / Future Work

Chart of Accounts → financial-statement closing (Trial Balance → P&L, Balance Sheet),
Cash Flow Statement, Bank Reconciliation, Accounts Payable/supplier invoices, payroll
accounting, fixed-asset accounting and depreciation, budgeting, multi-currency
accounting, consolidated accounting, manufacturing variance accounting, inventory
valuation accounting, COGS automation for any inventory movement, year-end closing,
retained-earnings closing automation, and — the largest piece — accounting
integration for every domain other than Finance (Goods Receipt → `DR Inventory / CR
Accounts Payable`; Material Issue → `DR WIP / CR Raw Material Inventory`; Sales
Fulfilment → `DR COGS / CR Finished Goods Inventory`), documented as the intended
future architecture in `accounting.md` §9 but not implemented. See `docs/backlog.md`
Epic 17.

## 13. Documentation Updated

New `docs/domains/accounting.md`, this completion report. Updated:
`docs/domains/finance.md` (§9 rewritten from "deferred" to "integrated," cross-
references added throughout), `docs/domains/README.md` (new Accounting row),
`docs/backlog.md` (new Epic 17, Epic 16's status paragraph extended),
`docs/roadmap.md`, `docs/changelog.md`.

## 14. Constraint

Nothing in this sprint was committed or pushed, per the explicit instruction carried
through the brief. All changes remain in the working tree, pending explicit
instruction from the user to commit.
