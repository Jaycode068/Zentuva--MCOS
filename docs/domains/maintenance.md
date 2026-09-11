# Maintenance Management Domain

- **Status:** Foundation implemented — Sprint 21 ("Maintenance Management
  Foundation"); ecosystem integration completed — Sprint 22 ("Maintenance
  Ecosystem Integration"). A dedicated domain built on top of Sprint 20's
  Asset Register, owning requests, plans, schedules, work orders, tasks,
  downtime, and operational cost/parts-usage records. Sprint 22 connected
  this domain to Inventory (real part issuing), Procurement/Supplier/AP
  (a narrow linking boundary), Budgeting (live cost-vs-budget), and added
  a Maintenance-owned Analytics page, an extended Asset detail integration,
  and a Field Technician mobile surface — see
  [Maintenance Ecosystem Integration](maintenance-integration.md) for all
  of that. Still explicitly the **foundation** for future Maintenance
  Intelligence, Reliability Analytics (MTBF/MTTR), predictive maintenance,
  and IoT/sensor integration — none of which are implemented here.
- **Sprint:** 21-22
- **Depends on:** [Asset Register & Asset Management](assets.md) (real
  Prisma FK relations, and — critically — every asset-status interaction
  goes through `AssetService`'s own lifecycle methods, never a raw Prisma
  update), [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `AuditService`, `UserService.listByOrganisation()` for the technician
  picker), Product Catalogue (`ProductRepository`, read-only, for parts
  usage), Suppliers (`SupplierRepository`, read-only, for external-service/
  cost references and procurement-requirement supplier validation) — all
  already-exported, already-small modules (ADR-002). **Sprint 22 adds:**
  [Inventory](inventory.md) (`InventoryStockRepository`/
  `InventoryTransactionRepository`/`InventoryLocationRepository`, read-only
  DI — the one exception is `MaintenancePartUsageRepository.issue()`
  writing `inventoryStock`/`inventoryTransaction` directly inside its own
  transaction, the same narrow ADR-002 exception Sales/Production's own
  stock-issuing writers already establish) and Procurement's
  `PurchaseOrderRepository` (read-only, for procurement-requirement PO
  linking).
- **Explicitly does not depend on:** [Accounting](accounting.md),
  [Finance](finance.md), [Sales](sales.md), [Production](production.md),
  [Distribution](distribution.md) — proven executably by
  `maintenance-independence.spec.ts` (`apps/api/src/maintenance/`), not
  just documented here. `FinanceModule`/`ProductionModule` are never
  imported — Finance exports nothing to import anyway, and Production
  exports nothing either (it has no Asset/equipment concept yet).
- **See also:** [Asset Register & Asset Management](assets.md),
  [Accounting](accounting.md), [Product Catalogue](catalogue.md),
  [Suppliers](suppliers.md), [Procurement](procurement.md),
  [Inventory](inventory.md), [Budgeting](budgeting.md),
  [Maintenance Ecosystem Integration](maintenance-integration.md),
  [Sprint 21 Completion Report](../sprint-21-completion-report.md),
  [Sprint 22 Completion Report](../sprint-22-completion-report.md).

## 1. Business Purpose

Sprint 20 answered _what assets the business has_. Sprint 21 answers _what
needs to happen to keep them running_: what's due for service, what broke
down, who's working on it, what was done, how long the asset was
unavailable, what it cost, and what parts were used — the operational data
foundation every future reliability, cost, and predictive-maintenance
capability will be built on.

```
Asset
 │
 ▼
Maintenance Plan (reusable template)
 │
 ▼
Maintenance Schedule (a concrete, per-asset recurrence — date- or meter-based)
 │
 ▼ (due)                              Maintenance Request (reported problem)
 │                                     │
 │                                     ▼ (approved, converted)
 └──────────────┬──────────────────────┘
                ▼
           Work Order (the core execution record)
                │
      ┌─────────┼─────────┬───────────┬────────────┐
      ▼         ▼         ▼           ▼            ▼
   Tasks    Downtime   Parts Used   Costs      Meter Reading
      │                                             │
      └──────────────────┬──────────────────────────┘
                          ▼
                    Completion
                          │
                          ▼
             Asset returns to IN_SERVICE
                          │
                          ▼
                 Maintenance History
```

## 2. Critical Architectural Principle — Maintenance Is Operational, Not Financial

Recording a maintenance request, plan, schedule, work order, task,
downtime window, part usage, or cost **never** calls
`postSystemJournalEntry` and **never** writes to any Finance/Inventory/
Sales/Production/Distribution table — proven structurally by
`maintenance-independence.spec.ts`, not just documented here. A
`MaintenanceCost` row is an operational fact ("this is what we recorded
this job cost"), never an accounting entry; a `MaintenancePartUsage` row
is an operational fact ("this is what we recorded being used"), never an
inventory deduction. Future accounting/inventory integration is a
deliberate, separate, future decision — see §11.

## 3. What Maintenance Owns vs. What Asset Owns

**Maintenance owns:** `MaintenanceType`, `MaintenancePlan`/
`MaintenancePlanTask`, `MaintenanceSchedule`, `MaintenanceRequest`,
`WorkOrder`/`WorkOrderTask`, `AssetDowntime`, `MaintenancePartUsage`,
`MaintenanceCost`, `MaintenanceDocument`.

**Maintenance does NOT own** (and never duplicates): `Asset`/
`AssetCategory`/`AssetLocation`/`AssetMeter`/`AssetMeterReading` (Sprint
20's own domain — Maintenance reads and, for lifecycle-status only,
transitions these through `AssetService`), `User` (technicians/
custodians are plain-id references, the established convention),
`Product`/SKU (parts are referenced, never re-modelled), `Supplier`
(external-service/cost references only), and — always — any Finance/
Inventory table.

## 4. Maintenance Type — Tenant-Scoped, Never Hard-Coded

`MaintenanceType` (Preventive/Corrective/Breakdown/Inspection/
Calibration/...) is ordinary, user-creatable tenant master data — the
exact `AssetCategory` precedent (Sprint 20), never a fixed enum a
business can't extend. `MaintenanceIssueType` (a lighter classification
of _what kind of problem_ was reported — Noise/Leak/Electrical/...) is
kept deliberately separate: it classifies the _report_, `MaintenanceType`
classifies the _work_.

## 5. Maintenance Plan — a Reusable Template, Not a Fan-Out Trigger

A `MaintenancePlan` ("Compressor Monthly Service") must target **exactly
one** of a specific `Asset` or an `AssetCategory` — never neither
(service-enforced, the Sprint 12 `SupplierInvoiceItem` Path A/B either/or
discipline). A category-level plan is a **shared template**: it never
automatically fans out into a work order for every asset in that
category. Each concrete asset that should follow it gets its own
`MaintenanceSchedule` row (§6) — the plan stays a template, the schedule
is the concrete recurrence. `MaintenancePlanTask` rows are the checklist
template, copied onto a fresh set of `WorkOrderTask` rows every time a
work order is generated from the plan.

## 6. Preventive Scheduling — Idempotent by Construction

`MaintenanceSchedule` is either date-based (`nextDueDate` + frequency) or
meter-based (`nextDueMeterReading` + interval, reading Sprint 20's own
`AssetMeter.currentReading` directly — never a second meter system).
`generate()` is the entire preventive-maintenance engine: when due, it
creates exactly one `WorkOrder` (with tasks copied from the plan's
template) and **immediately advances the due marker to the next
occurrence in the same transaction** — so an immediate repeat call finds
nothing due. No separate duplicate-check bookkeeping is needed;
idempotency is a structural consequence of always moving the due marker
forward before the transaction commits. Live-verified: two consecutive
`generate()` calls against the same due schedule produce exactly one
work order, never two.

## 7. Work Order Lifecycle

```
OPEN ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ⇄ ON_HOLD
  │                                        │
  └──────────────── cancel ────────────────┴──▶ CANCELLED (terminal)
                                           │
                                      complete
                                           ▼
                                     COMPLETED (terminal)
```

No separate `DRAFT` state — a created work order is immediately `OPEN`
(or `ASSIGNED`, if a technician was chosen at creation), since the
brief's own suggested API surface has no separate publish step. No
separate `CLOSED` state distinct from `COMPLETED` — this codebase's
established "don't introduce a state with no second approver/reason to
separate it" discipline (Sprint 16 §5). Both `COMPLETED` and `CANCELLED`
are **hard-terminal** — the `Asset.DISPOSED`/`RETIRED` precedent (Sprint 20) — any further transition attempt, including a repeat completion call,
either throws or (for the exact same idempotency key) returns the
original result unchanged; every non-terminal transition is
soft-idempotent (already-in-target-status returns unchanged, no error).
`maintenancePlanId` set means the work order is preventive (generated
from a plan/schedule); `maintenanceRequestId` set (and no plan) means it
originated from a reported problem; neither set means it was created
directly as ad-hoc corrective/breakdown work — a real structural
distinction, never a redundant stored "kind" flag.

## 8. Work Order Completion — the Central Atomic Transaction

`WorkOrderRepository.complete()` is the single most important transaction
in this domain. Inside one transaction: validates every `mandatory`
`WorkOrderTask` is `COMPLETED` (rejecting with the specific list of
incomplete task titles otherwise — a work order can never be silently
marked done with mandatory steps skipped), writes completion facts
(resolution/root cause/corrective action/timestamps), auto-closes any
still-open `AssetDowntime` window for this work order, and — if a meter
reading was supplied — records it via Sprint 20's own
`recordMeterReadingWithinTransaction()` (extracted from `AssetMeterRepository.
recordReading()` specifically so this transaction can join it, the exact
`issueCreditNoteWithinTransaction` extraction technique Sprint 11 already
established for this identical problem). Idempotency-checked first, before
the mandatory-task precheck — the Sprint 9/10 lesson.

**The Asset lifecycle transition (`UNDER_MAINTENANCE → IN_SERVICE`) is a
deliberate second, best-effort step**, taken by the _service_ layer
immediately after this transaction commits, via `AssetService`'s own
lifecycle methods — never nested inside the same database transaction.
`AssetService`'s lifecycle methods are themselves a second, independent
unit of work through a different repository; nesting them inside
`WorkOrderRepository.complete()`'s own transaction would mean holding that
transaction open across a second service's own calls, which this
codebase's established convention explicitly avoids. The work order's own
completion facts are always atomic on their own; the Asset status flip is
applied only when the asset is actually in the expected prior state
(never forcing an invalid transition), and only when **no other work
order on that asset is still open** (`countOpenForAsset()`) — a
documented, deliberate simplification: this is a simple "any open work
order blocks resume" check, not a full reservation/locking system.
Live-verified: an asset with two work orders open correctly stays
`UNDER_MAINTENANCE` after the first completes, and only returns to
`IN_SERVICE` once the second also completes.

## 9. Asset Status Interaction

`start()` calls `AssetService.startMaintenance()` **only if** the asset is
currently `IN_SERVICE` — never forcing an invalid Asset transition, and
never blocking the work order itself if the asset is in some other state
(e.g. still `DRAFT`/`ACTIVE`, or already `UNDER_MAINTENANCE` from another
concurrent work order, in which case Asset's own soft-idempotent
transition is simply a no-op). `complete()`/`cancel()` call
`AssetService.resumeService()` only when the asset is currently
`UNDER_MAINTENANCE` and no other work order remains open (§8). A work
order **never** transitions an asset to `DISPOSED`/`RETIRED` or
`OUT_OF_SERVICE` — those remain Asset's own lifecycle decisions, reachable
only through Asset's own endpoints.

## 10. Downtime — a Dedicated Table, Duration Never Stored

`AssetDowntime` is its own table (not a single start/end pair on
`WorkOrder`) because an asset can have more than one downtime window per
work order, and future reliability analytics (MTBF/MTTR) need the full
history. `durationMinutes` is **never persisted** — always computed as
`endedAt − startedAt` at read time, since both timestamps are immutable
once set and the duration is trivially, always correctly derivable.
Negative durations (`endedAt` before `startedAt`) are rejected at both
`record()` and `end()` time. `complete()` auto-closes any still-open
downtime window (§8) so a technician who forgets to explicitly end it
never leaves an unbounded-duration record.

## 11. Parts / Material Usage — Foundation in Sprint 21, Real Inventory Integration in Sprint 22

`MaintenancePartUsage` references an existing `Product` (the sole
transactional SKU entity, Sprint 4.1/4.7) — never a duplicate inventory
system. `unitOfMeasure` is snapshotted from `Product.unit` at write time
(an immutable historical fact).

**Sprint 21** left `inventoryTransactionId` always `null` — recording a
part never touched `InventoryStock`/`InventoryTransaction`, a deliberate
foundation-sprint deferral (no sufficiently narrow, safe, atomic,
idempotent, auditable integration point existed yet).

**Sprint 22** ("Maintenance Ecosystem Integration") closed that gap with a
minimal two-step lifecycle — `REQUESTED` (no inventory effect, still the
`record()` behaviour above) → `ISSUED` (real stock deducted) or
`CANCELLED` (only before `ISSUED`). `MaintenancePartUsageRepository.
issue()` is the **one and only** place in this entire domain that writes
`inventoryStock`/`inventoryTransaction` — inside its own transaction,
using the injected `PrismaService` directly, the same deliberate, narrow
exception to ADR-002 that `SalesFulfilmentRepository.create()`/
`ProductionMaterialIssueRepository.issue()` already establish. Every
other file in the domain is still structurally forbidden from touching
those two tables — proven by the extended `maintenance-independence.spec.
ts`, not just documented here. `unitCost`/`totalCost` are snapshotted
from `InventoryStock.averageUnitCost` at the moment of issue (an
immutable historical fact — the live average keeps drifting afterward as
later receipts land, and a Work Order's cost history must not silently
change). Full detail: [Maintenance Ecosystem
Integration](maintenance-integration.md) §1.

## 12. Maintenance Cost — Operational Capture Only

`MaintenanceCost` (`LABOUR`/`PARTS`/`SERVICE`/`TRANSPORT`/`OTHER`) never
creates a `JournalEntry`, `SupplierInvoice`, or `Payment` — proven
structurally. `totalCost` is **always server-computed** (`quantity ×
unitCost`) and persisted as an immutable point-in-time cost fact — a
client-supplied total is never trusted or accepted. This is a deliberate
exception to "don't persist derived values": unlike a work order's own
_aggregate_ total (always derived live as `Σ MaintenanceCost.totalCost`,
never stored on `WorkOrder` itself), a single cost line's own total is an
immutable historical fact that never needs recomputation, the same
justification `Asset.acquisitionCost` already established.

## 13. External Service / Contractor

A work order may be flagged `isExternalService` with an optional
`externalSupplierId` (a real reference to an existing Supplier, read-only
— never a duplicate supplier master), `externalProviderName` (free-text
fallback when no Supplier record exists), `externalReference`,
`externalSentAt`/`externalReturnedAt`. Service cost is captured through
the ordinary `MaintenanceCost` mechanism (category `SERVICE`,
`supplierId` set) — no separate cost mechanism was built for this case.

## 14. Warranty Awareness

Maintenance surfaces — but never recalculates or duplicates — Sprint 20's
own warranty classification (Active/Expired/No Warranty, a simple
`warrantyEndDate` comparison). No warranty claims workflow exists or is
planned for this sprint.

## 15. Meter Integration — Reusing Sprint 20, Never a Second Meter System

Every meter read/write in this domain goes through Sprint 20's own
`AssetMeterRepository`/`AssetMeterService` — schedule due-checking reads
`AssetMeter.currentReading` directly; work order completion records a
reading via the shared, transaction-joinable
`recordMeterReadingWithinTransaction()` function (§8). `WorkOrder.
meterReadingId` stores only a reference to the resulting
`AssetMeterReading` row, never a duplicated value.

## 16. Tenant Isolation / RBAC / Audit

Every tenant-owned table carries `organisationId` directly (or, for the
two pure child tables — `MaintenancePlanTask`, `WorkOrderTask` — is
scoped through its parent's `organisationId`, the exact
`CapitalProjectCostLine` precedent, Sprint 18); every repository query
filters by it. Cross-tenant access fails safely (`404`/`400`) —
live-verified: a second organisation cannot read, list, or reference any
Boby Bites work order/asset/maintenance type.

RBAC follows this codebase's one and only convention, confirmed
exhaustively unchanged since Sprint 20: `JwtAuthGuard` class-level (any
authenticated read), `RolesGuard`+`Roles('Owner','Administrator')` on
every write. **No separate "Technician" role was introduced** — no such
role exists anywhere in this system (Owner/Administrator/Member is the
entire vocabulary), and inventing one for this sprint alone would
contradict the explicit "use existing permission conventions, do not
invent a new authorization framework" instruction. A "technician" is
simply the plain-id `assignedToId` reference on a work order/task — any
organisation member can be assigned, and task-status updates
(`PATCH .../tasks/:id`) are deliberately left reachable by any
authenticated member (not gated to Owner/Administrator) so an assigned
Member can actually update their own work, mirroring how Member already
has broad read access everywhere else in this codebase. Administrative
actions (creating plans/schedules/types, assigning, starting, holding,
cancelling, completing a work order) remain Owner/Administrator-only.

`MAINTENANCE_AUDIT_ACTIONS` follows the `<entity>.<event>` convention
every other domain's audit actions use, wired into the existing
`AuditService` — no competing audit mechanism.

## 17. Known Limitations / Non-Goals

Resolved in Sprint 22 (kept here, struck through, so the history stays
legible — see [Maintenance Ecosystem
Integration](maintenance-integration.md) for the actual implementation):

- ~~No spare-parts inventory management~~ — `MaintenancePartUsage.
issue()` now performs a real, atomic `InventoryStock` deduction +
  `InventoryTransaction`, Sprint 22 §1.
- ~~No procurement linkage when a part is unavailable~~ —
  `MaintenanceProcurementRequirement` now provides the smallest linking
  boundary into Procurement (Maintenance still never creates a Purchase
  Order itself), Sprint 22 §2.
- ~~No maintenance cost reporting/analytics~~ — a Maintenance-owned
  Analytics page now exists (cost breakdown, operational metrics,
  deterministic risk signals, cost-vs-budget), Sprint 22 §6/§9.
- ~~No mobile technician app beyond the Admin responsive UI~~ — a
  dedicated `/field/maintenance` Field Technician surface now exists,
  Sprint 22 §9.

Still deferred (unchanged, or newly explicit) after Sprint 22:

- **No predictive maintenance, AI recommendations, machine learning, IoT,
  sensor integration, or real-time telemetry** — meter readings are
  entered manually, the exact Sprint 20 foundation. Explicitly **not**
  started by Sprint 22's Analytics/risk-signals work, which is
  deterministic threshold logic, never a model.
- **No GPS/fleet tracking, no fleet management.**
- **No automatic supplier invoicing** — external service costs are
  captured as `MaintenanceCost` records only; a linked Purchase Order's
  AP status is read-only visibility, never automated invoice creation.
- **No maintenance accounting integration, depreciation, or fixed-asset
  accounting** — see §2/§12. Still zero `postSystemJournalEntry` calls
  anywhere in this domain, Sprint 21 or 22.
- **No warranty claims management** — classification only, see §14.
- **No insurance management.**
- **No advanced technician payroll, labour scheduling, or shift
  management** — a technician is simply an assignable organisation
  member; no new Technician RBAC role was created in Sprint 22 either —
  every maintenance write still uses the identical Owner/Administrator
  (plus any-authenticated for checklist-task completion) convention
  Sprint 21 established.
- **No external contractor portal** — external service is captured as
  plain fields/cost records on the work order itself.
- **No offline mobile application, push notifications, or WhatsApp
  integration** — the Field Technician workflow (Sprint 22) is a
  responsive, mobile-first web UI only, same as Field Sales.
- **No maintenance marketplace.**
- **No configurable-permission RBAC model** — the same deferred decision
  as every prior sprint in this codebase.
- **A simple "any open work order blocks Asset resume" guard, not a full
  reservation/locking system** — see §8/§9.
- **No automated maintenance optimisation or advanced maintenance
  intelligence** — Sprint 22's risk signals are two named, deterministic
  thresholds (repeat-failure count, cost-vs-category-median), not a
  scoring/optimisation engine.
- **No frontend automated test harness** — `apps/web` has no existing
  Vitest/Jest/RTL setup at all (its `test` script is a no-op stub); Sprint
  22's frontend was verified through live browser + database
  cross-checks, documented in the Sprint 22 completion report, not through
  automated frontend tests. Standing up a test harness is a deliberate,
  separate platform-quality decision, not part of this domain.
