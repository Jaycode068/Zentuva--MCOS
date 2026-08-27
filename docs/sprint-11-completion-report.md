# Sprint 11 Completion Report — Returns, Claims & Reversals Foundation

## 1. Objective

Close the last major gap in the operational architecture Sprints 4.4.1–10 built: a
controlled, auditable reverse-flow — Customer Returns, Supplier Returns, and
Replacement Goods — governed by one central rule stated three separate times in the
brief: **never edit or erase an original transaction to represent a return; a return
is a new business event that references the original event and creates the
appropriate reverse movements.**

```
Original Sale → Fulfilment → Inventory ↓ / COGS ↑
Customer Return → Inventory ↑ / COGS ↓ / Financial adjustment

Goods Receipt → Inventory ↑ / AP-GRNI ↑
Supplier Return → Inventory ↓ / AP-GRNI adjustment
```

## 2. Architecture Decisions

| #   | Question                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module ownership                           | No new generic "Returns" module. `CustomerReturn` lives in `apps/api/src/sales/` (Sales owns customer-return commercial rules). `SupplierReturn` and the Replacement/discrepancy-resolution extension live in `apps/api/src/inventory/`, next to `GoodsReceiptRepository` — the closest existing analog already lives there despite being procurement-triggered. Neither needed a new NestJS module import: both reuse the established "self-owned `$transaction` reaching directly into another domain's tables" exception (`GoodsReceiptRepository.receive`/`SalesFulfilmentRepository.create`'s own precedent), and call `postSystemJournalEntry`/a new `issueCreditNoteWithinTransaction` as plain DI-free functions. |
| 2   | Credit Note reuse                          | Extracted `CreditNoteRepository.issue()`'s `$transaction` callback into an exported plain function `issueCreditNoteWithinTransaction(tx, ...)` — behaviour-preserving (`issue()` becomes a one-line wrapper); `CustomerReturnRepository.receive()` calls `tx.creditNote.create()` then this same function, inside its own outer transaction. Added `CreditNote.sourceType`/`sourceId` (nullable, mirrors `JournalEntry`'s polymorphic pattern, `NULL` for every pre-existing manually-issued credit note).                                                                                                                                                                                                                |
| 3   | Immutability                               | No existing model gets an update-in-place path for returns. `SalesOrder`/`SalesFulfilment`/`Invoice`/`Dispatch`/`Delivery`/`PurchaseOrder`/`GoodsReceipt` are only ever read inside a return's transaction. The only additive columns on existing models are cumulative "already returned/replaced" counters and two narrow discrepancy-resolution fields — never edits to historical quantities or costs.                                                                                                                                                                                                                                                                                                                |
| 4   | Customer Return lifecycle                  | Two-phase: `REQUESTED` (`POST /customer-returns` — no inventory/accounting effect) → `RECEIVED` (`POST /:id/receive` — the one atomic physical+financial event) or `CANCELLED` (`POST /:id/cancel`, releases the reserved quantity). Always references a specific `SalesFulfilmentItem` — never guesses cost from the order alone, and correctly attributes a return to one of several fulfilment batches.                                                                                                                                                                                                                                                                                                                |
| 5   | Disposition (§8)                           | `CustomerReturnItem` gets `quantityResalable`/`quantityDamaged`/`quantityQuarantine`/`quantityScrap`, set at `receive()`, must sum to `quantityReturned`. Only `quantityResalable` ever touches `InventoryStock`/`InventoryTransaction` — the smallest safe extension short of a full quarantine/WMS model, documented as deferred.                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Physical vs. commercial settlement (§36)   | `quantityCredited` is a separate field, defaulting to the full `quantityReturned` (a customer is typically refunded in full regardless of physical disposition), overridable downward at `receive()`. COGS reversal is valued on `quantityResalable × unitCost`; the Credit Note is valued on `quantityCredited × unitPrice` — never assumed equal.                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Cost/price snapshots                       | `CustomerReturnItem.unitCost` snapshots the _specific_ `SalesFulfilmentItem.unitCost` at request time (immutable); `unitPrice` snapshots the original `SalesOrderItem.unitPrice`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | Supplier Return excess-vs-payable (§17-19) | New cumulative `GoodsReceiptItem.returnedQuantity`/`returnedExcessQuantity`. Allocation for a return of quantity `Q`: `excessPortion = min(Q, remainingExcess)`, `remainingExcess = max(0, (acceptedQuantity - payableQuantity) - returnedExcessQuantity)` — **excess is drawn down first**. Reproduces both worked scenarios exactly. Valued at the _original_ `GoodsReceiptItem`'s `PurchaseOrderItem.unitPrice`, never the current `averageUnitCost`.                                                                                                                                                                                                                                                                  |
| 9   | Replacement goods (§21/§39)                | No new accounting logic — a replacement is an ordinary `GoodsReceipt` against the same PO through the existing, unmodified `receive()`, plus `replacesGoodsReceiptId`/`replacesRejectedItemId`/`replacedQuantity` traceability fields. `payableQuantity`'s existing remaining-ordered-quantity cap (Sprint 8) already makes a duplicate payable mathematically impossible — proven with a dedicated correctness argument, not just asserted.                                                                                                                                                                                                                                                                              |
| 10  | Discrepancy resolution (§20)               | New nullable `GoodsReceipt.discrepancyResolutionAction` (`REPLACEMENT`/`RETURN`/`CREDIT`/`ACCEPT_AS_IS`/`PRICE_ADJUSTMENT`/`OTHER`). `REPLACEMENT`/`RETURN` auto-set by the code paths that resolve them; the other three remain a manual `PATCH .../discrepancy` flip (Sprint 4.4.1, unchanged).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | Inventory transaction type                 | One new `InventoryTransactionType.RETURN` value, used for both directions, `referenceType`/`referenceId` pointing at `CustomerReturn`/`SupplierReturn`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | Weighted-average cost on restock           | `CustomerReturnRepository.receive()` restocks `quantityResalable` at the specific original `unitCost` via an inline weighted-average upsert, same shape as `GoodsReceiptRepository.receive()`'s own — each repository owns this formula inline already (existing convention, not duplication-for-duplication's-sake).                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | Idempotency                                | Every new write endpoint checked in the service/repository layer before any business-rule pre-check — the Sprint 9→10 lesson applied from day one, not found live again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 14  | RBAC / approvals                           | No new approval workflow. Existing `@Roles('Owner','Administrator')` write / any-authenticated-member read pattern, unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 15  | Field Sales UI                             | Field gets the request step only — a mobile-first sheet mirroring `FieldFulfilSheet`. The `receive()`/disposition/credit step requires accounting judgement and stays Admin-only, matching how Field never sees cost/COGS fields today (Sprint 10 §14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 3. Database Changes

New migration `20260826070212_sprint11_returns_claims_reversals`:

- New enums: `CustomerReturnReason`, `CustomerReturnStatus`, `SupplierReturnStatus`,
  `DiscrepancyResolutionAction`; `RETURN` added to `InventoryTransactionType`.
- New models: `CustomerReturn`/`CustomerReturnItem` (Sales-owned), `SupplierReturn`/
  `SupplierReturnItem` (Inventory-owned).
- Additive columns: `SalesFulfilmentItem.quantityReturned`; `GoodsReceiptItem.returnedQuantity`/
  `.returnedExcessQuantity`/`.replacedQuantity`/`.replacesRejectedItemId`;
  `GoodsReceipt.replacesGoodsReceiptId`/`.discrepancyResolutionAction`;
  `CreditNote.sourceType`/`.sourceId` (+ index).
- Reused `RejectionReason` (Sprint 4.4.1) for `SupplierReturn.reason` — no new enum.

## 4. API

| Endpoint                                              | Auth              | Notes                                                                    |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `GET/POST /api/sales/customer-returns`                | Any / Owner+Admin | List/request                                                             |
| `GET /api/sales/customer-returns/:id`                 | Any               | —                                                                        |
| `POST /api/sales/customer-returns/:id/receive`        | Owner+Admin       | Atomic disposition + COGS reversal + Credit Note                         |
| `POST /api/sales/customer-returns/:id/cancel`         | Owner+Admin       | `REQUESTED` only                                                         |
| `POST /api/sales/customer-returns/:id/photo`          | Owner+Admin       | Multipart                                                                |
| `GET/POST /api/inventory/supplier-returns`            | Any / Owner+Admin | List/create — single atomic write                                        |
| `GET /api/inventory/supplier-returns/:id`             | Any               | —                                                                        |
| `PATCH /api/inventory/goods-receipts/:id/discrepancy` | Owner+Admin       | Extended with `resolutionAction`                                         |
| `POST /api/inventory/goods-receipts`                  | Owner+Admin       | Extended with `replacesGoodsReceiptId`/per-item `replacesRejectedItemId` |

## 5. Backend Implementation

- **`apps/api/src/sales/customer-return.repository.ts`** — `create()` (idempotency
  check → re-reads referenced `SalesFulfilmentItem`s authoritatively inside the
  transaction → over-return guard → creates the aggregate + increments
  `quantityReturned`); `receive()` (idempotency check → status guard → disposition-sum
  validation → weighted-average restock of the resalable portion → `InventoryTransaction`
  (`RETURN`) → conditional COGS-reversal journal → conditional Credit Note via
  `issueCreditNoteWithinTransaction`); `cancel()` (releases the reserved quantity).
- **`apps/api/src/sales/customer-return.service.ts`/`.controller.ts`** — pre-checks,
  error translation, audit events (`sales.customer-return-requested`/`-received`/
  `-cogs-reversed`/`-credit-note-issued`/`-cancelled`/`-photo-uploaded`).
- **`apps/api/src/inventory/supplier-return.repository.ts`** — `create()` (idempotency
  check → re-reads referenced `GoodsReceiptItem`s → excess-first allocation → over-return
  guard → creates the aggregate → decrements `InventoryStock` (negative-stock guarded)
  → `InventoryTransaction` (`RETURN`) → discrepancy auto-resolution → conditional
  reversal journal).
- **`apps/api/src/inventory/supplier-return.service.ts`** — validation, error translation.
- **`apps/api/src/inventory/goods-receipt.repository.ts`** — extended `receive()` with
  the replacement-item validation/linkage block (`InvalidReplacementError`) and the
  post-creation discrepancy auto-resolution update; `updateDiscrepancyStatus()` extended
  with `resolutionAction`.
- **`apps/api/src/finance/credit-note.repository.ts`** — `issueCreditNoteWithinTransaction`
  extraction (decision 2), behaviour-preserving.
- **Chart of accounts**: zero new `SYSTEM_ACCOUNT_KEYS` — `COGS`/`FINISHED_GOODS_INVENTORY`/
  `SALES_RETURNS`/`AR` (Customer Return) and `AP`/`GRNI_PENDING_APPROVAL`/`INVENTORY`
  (Supplier Return) all pre-existed.

## 6. Frontend Implementation

- **Admin `apps/web/src/app/(app)/settings/returns/`** — `api.ts` (typed client for
  both return types), `labels.ts`, `page.tsx` (two-tab list), `create-customer-return-dialog.tsx`,
  `customer-return-detail-dialog.tsx` (embeds the disposition/receive form), `create-supplier-return-dialog.tsx`,
  `supplier-return-detail-dialog.tsx`.
- **Navigation** — new "Returns" entry (`RotateCcwIcon`, new hand-rolled stroke icon)
  in `navigation-config.ts`.
- **Field Sales** — `field/orders/[id]/page.tsx` gained a "Request Return" sticky
  action (visible whenever the order has any fulfilment history) and
  `FieldReturnRequestSheet`, a full-screen two-step sheet (request → optional
  `ImageUploadCard preferCamera` photo) mirroring `FieldDeliverySheet`'s exact shape.
  `field/api.ts` re-exports `settings/returns/api.ts`.

## 7. Accounting Rules

See `docs/domains/accounting.md` §12 for the full writeup (Customer Return Accounting,
Supplier Return Accounting/excess-first allocation, Replacement Goods, costing
assumptions). Summary:

- Customer Return: `DR Finished Goods Inventory / CR Cost of Goods Sold` (COGS
  reversal, valued at `quantityResalable × unitCost`) + `DR Sales Returns / CR
Accounts Receivable` (Credit Note, valued at `quantityCredited × unitPrice`) — two
  independently zero-skippable postings in one transaction.
- Supplier Return: `DR AP` (payable portion) + `DR GRNI_PENDING_APPROVAL` (excess
  portion) / `CR Inventory` (total), excess drawn down first.
- Replacement Goods: no new posting rule — reuses Goods Receipt's existing
  `DR Inventory / CR AP (+ GRNI_PENDING_APPROVAL)` unmodified.

## 8. Tests

- New `customer-return.repository.spec.ts` (12 tests, deliberate exception to "no
  repository tests for atomic transactions," same justification as
  `goods-receipt.repository.spec.ts`) — covers: full/partial request, over-return
  rejection, duplicate idempotent request, cancel (+ rejecting a double-cancel), the
  Boby Bites 7-resalable/3-damaged/full-credit scenario (exact journal + credit note
  amounts asserted), `quantityCredited` override independent of resalable quantity,
  all-damaged (no COGS journal, still full credit), disposition-sum mismatch
  rejection, duplicate idempotent receive (two journals posted once, not twice on
  replay), no-eligible-invoice rejection, closed accounting period.
- New `supplier-return.repository.spec.ts` (9 tests) — the §17 worked example (exact
  `DR GRNI_PENDING_APPROVAL`/`CR Inventory` journal, no `AP` line), §18 (fully-payable
  receipt, 100% to `AP`), §19 (cumulative partial returns correctly spilling from
  excess into payable once exhausted, plus over-return rejection on a third call),
  duplicate idempotent request, over-return rejection, insufficient-physical-stock
  rejection, discrepancy auto-resolution, closed accounting period.
- New `customer-return-independence.spec.ts` / `supplier-return-independence.spec.ts`
  (4 + 3 tests) — structural guards: only `postSystemJournalEntry`/
  `issueCreditNoteWithinTransaction` allowed, never a direct `JournalEntry` write,
  never an import of a Finance repository/service class or `FinanceModule`.
- Extended `goods-receipt.repository.spec.ts` with 3 new Replacement Goods tests: the
  §39 worked example (a 50-unit replacement correctly completes the order's payable
  total to exactly 1000, never a duplicate, and resolves the discrepancy to
  `RESOLVED`/`REPLACEMENT`), the §17/§21-style case (a replacement against an
  already-fully-consumed PO posts entirely to `GRNI_PENDING_APPROVAL`, never a second
  `AP` line), and over-replacement rejection (`InvalidReplacementError`).
- Updated `inventory.controller.spec.ts`/`inventory.service.spec.ts` fixtures for the
  new schema fields; updated the two pre-existing `updateDiscrepancyStatus` assertions
  for the new `resolutionAction` parameter.
- Full backend suite: **72 test suites / 717 tests, all passing** (up from 68/684
  after Sprint 10).

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`) apps, logged
in as the seeded Owner account. The API's own port had a stale, pre-Sprint-11
compiled-`dist` process running from an earlier session; restarted with the user's
explicit go-ahead before verification, per the Sprint 10 report's own lesson about
stale builds masking real behaviour.

1. **Boby Bites customer-return scenario** (`SO-000006`, seed data): requested
   `RET-000001` for 10 packs of Plantain Chips Classic Salted 500g against the
   200-unit fulfilment batch (`unitCost = ₦426`, `unitPrice = ₦800`). Received with 7
   resalable / 3 damaged, full default credit. Confirmed in the Admin detail dialog
   and via direct database query: `InventoryTransaction` (`RETURN`, qty 7),
   `JE-000029` `DR Finished Goods Inventory ₦2,982 / CR COGS ₦2,982` (exactly 7×426),
   `CN-000002` `₦8,000` `ISSUED` (exactly 10×800), and `JE-000030` posting that credit
   note's own `DR Sales Returns / CR AR`.
2. **Excess-supply supplier-return scenario** (`GRN-000005`, seed data: accepted 1100,
   payable 1000, 100 excess): created `SRET-000001` returning 50 units. Confirmed via
   the Admin detail view and direct database query: `excessPortion = 50`,
   `payablePortion = 0`, journal `JE-000031` `DR GRNI_PENDING_APPROVAL ₦7,500 / CR
Inventory ₦7,500` — **no `AP` line at all**, matching the brief's own worked
   example exactly.
3. **Field Sales mobile return-request flow**: at a 375px viewport, opened
   `SO-000006`'s detail page, confirmed the "Request Return" sticky action renders
   with zero cost/COGS fields, submitted a 5-unit return against the order's other
   (100-unit) fulfilment batch, confirmed `RET-000002` was created `REQUESTED`
   against the correct, distinct `SalesFulfilmentItem` (proving multi-fulfilment
   traceability), and confirmed the two-step photo-upload panel renders identically
   to `FieldDeliverySheet`'s own pattern.
4. **Zero browser console errors** on every page exercised (Admin Returns list/detail,
   Field order detail/return sheet), confirmed via `read_console_messages`.
5. **Full production build** (`next build`) succeeds with `/settings/returns` in the
   route manifest; `tsc --noEmit` and `eslint` clean on both `apps/api` and
   `apps/web`.

## 10. Known Limitations

- **No Admin UI for linking a replacement receipt.** The backend fully supports
  `replacesGoodsReceiptId`/`replacesRejectedItemId` (validated, tested — §8, three
  dedicated repository tests covering both worked scenarios and the over-replacement
  rejection) but the existing `GoodsReceivingDialog` (Sprint 4.4.1, unchanged this
  sprint) has no field to set them — a replacement today can only be created via a
  direct API call, not from the Admin form. Recording an ordinary follow-up receipt
  (no linkage) still works exactly as before. Closing this gap is a small, additive
  frontend-only change (one optional "this replaces GRN-xxx" picker + a per-item
  "replaces this rejected line" select) — deferred here to keep this sprint's already
  large surface area from growing further, not a backend limitation.
- No physical quarantine-location or hold-status model — damaged/quarantine/scrap
  disposition is recorded as data only, never a distinct `InventoryStock` state.
  Documented as deferred, per the brief's own "do not invent a WMS" instruction.
- No `CreditNoteItem` line detail on a return-issued credit note — same pre-existing
  flat-`amount` limitation every manually-issued credit note already has.
- No Supplier Claims/dispute-management workflow beyond the lightweight
  `discrepancyResolutionAction` field — deliberately out of scope (brief §45).
- No approval workflow for either return type — RBAC (`Owner`/`Administrator` write)
  is the only gate, per the brief's explicit "do not over-engineer approvals"
  instruction; the schema (a real `status` column on both aggregates) is additive-
  forward-compatible with a future approval chain.
- Return cost/value reversals use the specific originating transaction's frozen
  cost/price, never the current `averageUnitCost` — a deliberate, documented
  assumption (see accounting.md §12.4), not an oversight.
- Reporting is data-model-only — no dedicated returns analytics/dashboards built this
  sprint (brief §35 explicitly scoped this as future work).

## 11. Deferred / Future Work

- Admin UI for linking a replacement receipt (§10) — the backend is complete and
  tested; only the form field is missing.
- A physical quarantine/hold warehouse capability for damaged/quarantined returned
  stock.
- Supplier Claims / dispute-management workflow, advanced insurance/claims handling.
- Returns reporting/analytics (return rate by SKU/customer/supplier, inventory-loss
  aggregation).
- A future approval workflow layered on top of the existing RBAC-only gate.
- `CreditNoteItem` line-level detail.

## 12. Documentation Updated

`docs/domains/sales.md` (new §4c "Customer Returns," updated §4b/§7/§8/§9),
`docs/domains/procurement.md` (updated Integration Points/Known Limitations),
`docs/domains/inventory.md` (new §11d "Returns & Replacement Goods," updated
§7/§8/§11), `docs/domains/finance.md` (updated §9/§11), `docs/domains/accounting.md`
(new §12 "Return Accounting" with 5 subsections, renumbered API
Reference/Known Limitations to §13/§14, updated §11.8/§11.9/§14),
`docs/domains/README.md` (Procurement/Inventory/Sales/Finance/Accounting status rows),
`docs/backlog.md` (Epic 5/7/17, Current Sprint Status), `docs/roadmap.md` (Phase 2
Inventory/Sales/Distribution/Accounting rows), `docs/changelog.md` (new dated entry),
this completion report.

## 13. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
