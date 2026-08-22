# Sprint 4.8 Completion Report — Customer, Territory, Outlet, Retail Network & Sales Foundation

**Date:** 2026-08-21
**Status:** Complete

## 1. Objective

Zentuva is being built as "the Operating System for African Manufacturing." Alongside
the manufacturing ERP (Catalogue → Procurement → Inventory → Production, Sprints
4.1–4.7), the platform's strategic differentiator is a **Retail Intelligence Network** —
a living digital map of the market around a manufacturer, built up progressively as a
sales team discovers it in the field. Sprint 4.8 lays this foundation: `Customer`,
`Territory`, `Outlet`, `DistributionNetworkRelationship`, and `SalesOrder` domains, plus
two UX surfaces (a mobile-first Field Sales workspace and a desktop Admin experience)
sharing one backend.

The sprint's core, non-negotiable architectural principle: **CAPTURE THE MARKET FIRST.
STRUCTURE THE NETWORK PROGRESSIVELY.** A customer must never be required to have a
distributor, a mapped territory, or any distribution relationship before it can be
registered, onboarded, or place an order. Direct sales are always first-class.
Distribution network relationships are a separate, optional, purely-descriptive concept
— adding one later must never rewrite or restrict historical sales.

## 2. What Was Built

### 2.1 Database — one migration, seven new tables

Migration `20260821131419_add_retail_network_and_sales` (purely additive — no
destructive change to any existing table, applied cleanly on the first attempt):

- **`Territory`** — self-referential (`parentTerritoryId`), tenant-defined hierarchy of
  arbitrary depth; free-text `type` (not an enum); `TerritoryStatus` (`ACTIVE`/`INACTIVE`).
- **`Customer`** — the commercial account; only `customerType`/`customerName`/
  `phoneNumber` required; `CustomerType` (9 values, purely descriptive); optional
  nullable `territoryId`.
- **`Outlet`** — the physical place of business, `customerId` required and immutable;
  `OutletType` (14 values, deliberately extensible); optional `territoryId`, optional
  `latitude`/`longitude` (both-or-neither).
- **`OutletPhoto`** — the first multi-file-per-entity model in this codebase; `Cascade`
  from `Outlet`; `photoType` (optional descriptive enum), `caption`.
- **`DistributionNetworkRelationship`** — `sourceCustomerId`/`targetCustomerId` (both
  `Restrict`), `relationshipType`, `effectiveFrom`/`effectiveTo`, `status`. Deliberately
  **no `@@unique`** on the (source, target, type) triple — a lapsed relationship must
  remain re-establishable as a new row; the service rejects a duplicate _active_ triple
  instead.
- **`SalesOrder`** — `customerId` (`Restrict`, immutable), `outletId` (optional,
  `Restrict` — never `SetNull`, so a network change or outlet edit can never silently
  rewrite which outlet an order was attributed to), `salesAgentId` (plain id, no FK),
  `SalesOrderStatus` (`DRAFT`/`CONFIRMED`/`CANCELLED`), server-computed `subtotal`/
  `discount`/`total`.
- **`SalesOrderItem`** — `productId` restricted (service-enforced) to `FINISHED_PRODUCT`
  SKUs from Sprint 4.7's Product Family/Variant/SKU hierarchy, never a Family or Variant
  directly; server-computed `lineTotal`; `@@unique([salesOrderId, productId])`.

Back-relations added to `Organisation` (six new arrays) and `Product`
(`salesOrderItems`).

### 2.2 Backend — five new NestJS modules

`apps/api/src/retail/{territory,customer,outlet,network}/` — four modules in a linear
dependency chain (`TerritoryModule ← CustomerModule ← OutletModule`,
`NetworkRelationshipModule → CustomerModule`), each exporting its own repository for the
next consumer to inject, mirroring the Sprint 4.7 Product Family → Variant chain.
`apps/api/src/sales/` — one flat module (`SalesOrder`+`SalesOrderItem`, no separate item
controller), importing `CustomerModule`+`OutletModule`+`ProductModule` and **deliberately
not** `NetworkRelationshipModule` or `InventoryModule` (see §3 below).

Every module follows the exact repository/service/controller/module shape established
by Sprint 4.7's `ProductFamily`/`ProductVariant`: tenant-scoped repository methods,
`<PREFIX>-000001`-style auto-generated immutable codes with a collision-avoidance loop,
`RolesGuard`-gated writes, inline `AuditService.record(...)` calls, response DTOs mapped
through a local `toXResponse()` function.

### 2.3 Validation — two new shared schema files

`packages/validation/src/retail.ts` and `sales.ts` — Zod schemas mirroring the Prisma
enums as plain string literals (never importing `@prisma/client`, since this package is
shared with the Prisma-free `apps/web`). `createCustomerSchema` enforces the
minimum-onboarding rule (only type/name/phone required); `createSalesOrderSchema` omits
`orderCode`/`salesAgentId`/`status`/`subtotal`/`total`/`lineTotal` entirely, so a client
cannot even attempt to supply a server-computed value.

### 2.4 API surface

```
GET/POST   /api/retail/territories, GET/PATCH .../:id, POST .../:id/{activate,deactivate}
GET/POST   /api/retail/customers, GET/PATCH .../:id, POST .../:id/{activate,deactivate}
GET/POST   /api/retail/outlets, GET/PATCH .../:id, POST .../:id/{activate,deactivate}
POST       /api/retail/outlets/:id/photos (multipart, ≤6 files)
DELETE     /api/retail/outlets/:id/photos/:photoId
GET/POST   /api/retail/network-relationships, GET/PATCH .../:id, POST .../:id/deactivate
GET/POST   /api/sales/orders, GET/PATCH .../:id, POST .../:id/{confirm,cancel}
```

`GET` is authentication-only (Member read-only) everywhere; every write requires
`Owner` or `Administrator`. No `DELETE` on any aggregate root — the one exception is
`DELETE .../photos/:photoId` (disposable media, not a business record).

### 2.5 Frontend — two surfaces, one backend

**Field Sales** (`apps/web/src/app/(field)/`) — a brand-new route group, deliberately
separate from the desktop `(app)` Workspace shell (which has no mobile-first primitives
of its own). Own auth guard (`FieldShell`), slim header, fixed bottom tab bar, sticky
bottom primary actions on every create/edit screen. Covers Home, Customers
(search/detail/progressive-onboarding create), Outlets (search/detail/create with
location capture + photo staging), and a 3-step Sales Order flow (customer → outlet →
SKU picker via the new `Sheet` bottom-sheet component) ending in a clear success screen.
Always rendered narrow (`max-w-md`, centered) even on a desktop viewport — a deliberate
choice not to progressively enhance to a second, wider layout, since the Admin surface
already serves that case.

**Admin** (`apps/web/src/app/(app)/settings/{retail,sales}/`) — tabbed pages following
the existing Production/Inventory conventions, tables on desktop with a card-list
fallback on narrow viewports (a new pattern introduced only in these two folders).

**New shared components**: `Sheet` (`packages/ui`) — a bottom-sheet/full-screen sibling
to the existing centered-modal `Dialog`; a `touch` `Button` size (`h-12`); `MultiImageUploadCard`
(`apps/web/src/components/app/`) — the multi-photo counterpart to `ImageUploadCard`;
`apiFetchFormData` (`apps/web/src/lib/api-client.ts`) — a multipart-POST helper;
`captureCoordinates` (`apps/web/src/lib/geolocation.ts`) — one-shot browser geolocation,
never `watchPosition`.

### 2.6 Seed data (idempotent — verified via two consecutive runs)

7 territories (Oyo State hierarchy), 9 customers spanning every `CustomerType` (one
seeded with only name/type/phone), 7 outlets, 3 network relationships (deliberately
covering only 4 of 9 customers), 5 sales orders demonstrating direct sales both with and
without a network relationship, with and without an outlet.

## 3. The Central Architectural Guarantee

`SalesModule` **never imports** `NetworkRelationshipModule` or `InventoryModule`.
`SalesOrderService` never injects a `NetworkRelationshipRepository` or any inventory
repository. This is enforced structurally, not just by convention — the code that could
check "does this customer have a distributor" or silently deduct stock is not reachable
from the Sales domain at all. `apps/api/src/sales/direct-sales-independence.spec.ts`
verifies this both behaviourally (every `CustomerType`, with zero network relationships,
can place and confirm a direct order; adding a relationship later never rewrites a prior
order) and structurally (asserts the import never appears in `sales.module.ts`'s own
source).

## 4. Migration Strategy / Backward Compatibility

Purely additive — zero existing tables, columns, or constraints changed. All five new
domains are entirely new aggregate roots with no pre-existing data to migrate.

## 5. Tests

**398/398 backend tests passing** (296 pre-existing + 102 new), zero regressions. New
spec files per domain (service + controller), plus the dedicated
`direct-sales-independence.spec.ts` covering the brief's eight mandated business-rule
scenarios. Full quality gate: `prisma validate`, lint (API + web), type-check (API +
web), full production build (API + web) — all clean.

## 6. Live Verification Performed

### 6.1 Bugs found and fixed during this sprint's own verification

Both caught live, neither shipped in the final code:

1. **Empty-string vs. `undefined` in optional Zod fields.** An unselected native
   `<select>` with an empty placeholder option (e.g. Territory "Not set") always submits
   `""`, not `undefined` — `z.string().min(1).optional()` rejects `""` (`.optional()`
   only exempts `undefined`). This silently blocked customer/outlet/territory creation
   whenever an optional picker was left untouched. Fixed by preprocessing `""` to
   `undefined` for every affected optional id/email field in
   `packages/validation/src/retail.ts`.
2. **Next.js 14 vs. 15 `params` API.** Three new `[id]` dynamic routes were written using
   the Next.js 15 `use(params)` pattern (`params: Promise<{id: string}>`) — this project
   runs Next.js 14.2.16, where `params` is a plain object. Fixed to the plain
   `params.id` access every other dynamic route in this codebase already uses.
3. **Async-loaded `<select>` preset-value race.** A picker's preset value (e.g. arriving
   at "Add Outlet" from a customer's own detail page, or editing an outlet/customer/
   territory that already has a value) silently failed to show as selected when its
   option list resolved after `react-hook-form`'s initial mount — the exact race
   `ProductionOrderDialog` had already worked around for its own BOM picker. Applied the
   same `useEffect`-driven re-sync to the Territory/Customer pickers in the Outlet,
   Customer, and Territory dialogs, and to the Field Sales outlet form.

### 6.2 The required end-to-end Boby Bites scenario — performed in full

1. **Market discovery**: Field Sales → New Customer → "Bodija Supermart — Test Branch,"
   type Supermarket, phone only, submitted without opening the optional details section
   (progressive onboarding, no distributor assigned).
2. **Outlet + photo**: Add Outlet → "Bodija Supermart — Main Branch," territory "Bodija,"
   location-capture tested both the denial path (form still submits) and a captured-
   coordinate path; two photos uploaded via the live multipart endpoint and displayed;
   one removed and confirmed gone via both the UI and the API; audit trail confirmed
   `outlet.photo_added` ×2, `outlet.photo_removed` ×1.
3. **Direct sale**: New Order for this customer — no distributor warning or gate
   appeared anywhere; added Plantain Chips Sweet & Spicy 30g × 150 @ 260; confirmed;
   order `SO-000006`, total 39,000.00, matching the client-side preview exactly.
   Confirmed `GET /api/inventory/:productId` for the ordered SKU was byte-identical
   before and after.
4. **Network development**: Created "Ibadan Foods Distribution Ltd" (Distributor) via
   the Admin surface, then the relationship "Ibadan Foods Distribution Ltd → Supplies →
   Bodija Supermart — Test Branch."
5. **Future sale**: A second order (`SO-000007`) for the same customer succeeded with
   zero behaviour change.
6. **History integrity**: Re-fetched `SO-000006` after both the network-relationship
   creation and the second order — **byte-for-byte identical** to its pre-network-change
   snapshot (verified via a structural diff). Its audit trail contains only
   `sales-order.created` and `sales-order.confirmed` — no `updated` event ever fired
   against it.

### 6.3 Mobile viewports (360×800, 375×812, 390×844, 430×932)

All four confirmed: no horizontal scroll, no clipped controls, ≥44px tap targets, sticky
bottom actions clear the bottom nav, zero console errors (confirmed in a fresh browser
tab to rule out stale log accumulation from earlier debugging).

### 6.4 Admin desktop (1440×900)

Confirmed: Retail Network page (Customers/Outlets/Territories/Network tabs, 11
customers including live-test data), Network tab showing exactly 4 relationships (3
seeded + 1 created live), Sales page showing all 7 orders (5 seeded + 2 live-test)
with correct statuses and totals.

### 6.5 Tenant isolation

Registered a second organisation live; cross-tenant reads of a customer and a sales
order by id both returned `404`; the second organisation's own customer list returned
empty — no cross-tenant data leak.

### 6.6 RBAC

`Member`: `200` on `GET /api/retail/customers`, `403` on `POST /api/retail/customers`
and `POST /api/sales/orders` ("You do not have permission to perform this action").

### 6.7 Audit logging

Verified via direct database query: `outlet.created`, `outlet.photo_added` ×2,
`outlet.photo_removed`, `sales-order.created`, `sales-order.confirmed` all present,
correctly ordered, correctly conditional.

## 7. Known Limitations

See each domain's own "Known Limitations" section
([customers.md](domains/customers.md), [outlets.md](domains/outlets.md),
[territories.md](domains/territories.md), [retail-network.md](domains/retail-network.md),
[sales.md](domains/sales.md)) for the complete, per-domain list. Summarised:

- No dedicated Sales Agent role — every write in every Sprint 4.8 domain requires
  `Owner`/`Administrator`; "Sales Agent" today is a tenant-assigned Administrator
  account. See [retail-network.md](domains/retail-network.md) §7 for the documented
  future module-level access architecture this is a placeholder for.
- No GIS, polygons, geofencing, or route optimisation of any kind.
- No continuous location tracking — one-shot `getCurrentPosition` only, never
  `watchPosition`.
- No AI/ML image analysis of outlet photographs.
- No inventory reservation, deduction, or availability gating from Sales Orders.
- No fulfilment states, invoicing, payments, or accounting integration.
- No pricing engine — `unitPrice` is entered freely per line.
- No full Retail Intelligence reporting/analytics engine — the relational structure
  supports building one later (total stock/sales/production by territory/variant/family,
  distribution coverage gaps, purchase recency), but no such query exists yet.
- Outlet photos are not seeded (binary fixtures aren't idempotent) — exercised live in
  verification instead.

## 8. Future Retail Intelligence Capabilities (Explicitly Deferred)

The relational structure this sprint establishes — territory hierarchy, customer/outlet
optional territory linkage, network relationships between customers, sales orders
optionally tied to outlets — is shaped so a future reporting layer could answer: how many
retailers have been discovered and where; which distributors/wholesalers operate in
which territory; which outlets have been visited and what they look like; which
retailers buy directly vs. through a mapped distributor; which areas have weak
distribution coverage; which customers haven't purchased recently. None of this
analytics/dashboard engine exists yet — this sprint is foundation only.

## 9. Future Module-Level Access Architecture (Design Only)

Documented in [retail-network.md](domains/retail-network.md) §7:
`Authentication → Organisation → User → Role/Capabilities → Module Access → Action
Permissions`, with eventual dedicated roles (Sales Agent, Production User, Inventory
User, Procurement User, Finance User, Manager, MD/Executive) scoped to their own
workspaces. No code changes this sprint — today's domain model is not contaminated by
this absence; every domain simply reuses the existing `RolesGuard`.

## 10. Documentation Updated

`docs/domains/customers.md`, `outlets.md`, `territories.md`, `retail-network.md`,
`sales.md` (all new), `docs/domains/README.md`, `docs/backlog.md` (Epic 7, Epic 8),
`docs/roadmap.md` (Phase 2), `docs/changelog.md`, and this completion report.

## 11. Constraint

Per explicit instruction, nothing from this sprint has been committed or pushed.
