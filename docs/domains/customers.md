# Customer Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Territories](territories.md) (optional).
- **See also:** [Retail Network](retail-network.md) (the keystone doc — read this first
  for the "why"), [Outlets](outlets.md), [Sales](sales.md), [Finance](finance.md) §21
  (receivables/statement/credit-limit/payment-allocation mechanics behind §9's
  Customer Account page),
  [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md),
  [Customer Account Inventory Audit](../customer-account-inventory-audit.md) and its
  [Phase 1 Completion Report](../sprint-customer-account-phase-1-completion-report.md).

## 1. Business Purpose

`Customer` is the commercial account — who the organisation bills and sells to. It exists
so a field sales agent can register any market participant — distributor, wholesaler,
retailer, supermarket, corporate account, restaurant, hotel, or anything else — in under
two minutes, with no prerequisite beyond a name, a type, and a phone number. See
[retail-network.md](retail-network.md) for the architectural principle this domain
exists to serve.

## 2. Key Concepts / Entities

### Customer

- **Responsibility:** the commercial account. Distinct from `Outlet` ([outlets.md](outlets.md))
  — the physical place of business — a customer may have zero, one, or many outlets.
- **Ownership:** owned by `apps/api/src/retail/customer/`.
- **Tenant scoping:** every `Customer` belongs to exactly one `Organisation`
  (`onDelete: Cascade`), same convention as every domain since Identity.
- **Lifecycle:** `ACTIVE`/`INACTIVE` only — never physically deleted.

**Fields:**

| Field                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer Code (`customerCode`)                                        | Auto-generated (`CUS-000001`, ...), globally unique, immutable.                                                                                                                                                                                                                                                                                                                                                                                   |
| Customer Type (`customerType`)                                        | `DISTRIBUTOR`/`WHOLESALER`/`RETAILER`/`SUPERMARKET`/`CORPORATE`/`INSTITUTION`/`RESTAURANT`/`HOTEL`/`OTHER`. **Purely descriptive market intelligence — never a sales restriction.** No code path anywhere checks `customerType` to decide whether an order may be placed; a Distributor, Wholesaler, Retailer, and Supermarket are all equally free to buy direct. Not modelled as mutually-exclusive-forever — correctable any time via `PATCH`. |
| Customer Name (`customerName`)                                        | Required. The formal business name for a registered company, or simply a trader's/shop's name for an informal retailer ("Alhaji Musa Provision Store") — one free-text field deliberately, since the model must not assume every customer is a formal company.                                                                                                                                                                                    |
| Primary Phone (`phoneNumber`)                                         | Required — the one contact detail a field agent can always obtain, even from a market stall with no address or registration number.                                                                                                                                                                                                                                                                                                               |
| Contact Person, Alternate Phone, Email, Address, City, State, Country | All optional.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Territory (`territoryId`)                                             | Optional, nullable, changeable any time. Never required to register a customer or place an order — see [territories.md](territories.md).                                                                                                                                                                                                                                                                                                          |
| Status (`status`)                                                     | `ACTIVE`/`INACTIVE`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Notes                                                                 | Optional free text.                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Deliberately absent:** `distributorId`/`parentCustomerId` or any other column encoding
distribution structure directly on this row. That structure lives entirely in
`DistributionNetworkRelationship` — see [retail-network.md](retail-network.md) §2.

**Added Phase 1 — Customer Account Management** (`docs/customer-account-inventory-audit.md`,
`docs/sprint-customer-account-phase-1-completion-report.md`): `creditLimit Float?` —
`null` means no limit is configured (the default; every pre-Phase-1 row remains valid
unchanged); `0` is a deliberately configured zero-credit account, distinguishable from
`null`. Non-negative, enforced both by a database `CHECK` constraint
(`customers_creditLimit_non_negative`) and by `updateCustomerCreditSchema` (Zod). See
§10 below for how it is used.

## 3. Progressive Onboarding

Only `customerType`, `customerName`, and `phoneNumber` are required by
`createCustomerSchema` (`packages/validation/src/retail.ts`) — every other field is
optional and addable later via `PATCH`. This three-field minimum is the exact enforcement
point for the "onboard a customer in roughly 1–2 minutes" requirement. The Field Sales
"New Customer" screen (`apps/web/src/app/(field)/field/customers/new/page.tsx`) shows
only these three fields above the fold; everything else — including Territory — sits
behind a collapsed "Add more details (optional)" disclosure. No distribution
relationship, no outlet mapping, no photograph, and no GPS coordinate is ever required to
register a customer.

## 4. Workflows

- **Onboard a Customer** — `POST /api/retail/customers` (Owner/Administrator only).
  Always starts `ACTIVE`.
- **Edit a Customer** — `PATCH /api/retail/customers/:id`. `customerCode` is never
  accepted (immutable).
- **Activate/Deactivate** — `POST /:id/activate`, `POST /:id/deactivate`.
- **Browse/Search** — `GET /api/retail/customers` (any authenticated user, Member
  included), filters: `?status=&customerType=&territoryId=&search=` (name/code/phone).
- **Field Sales**: Home → search bar → Customers list (card-based, search-first) →
  Customer detail (profile, Outlets, Recent Orders, Call/Add Outlet/New Order actions).
- **Admin**: `settings/retail` Customers tab — table on desktop, card list on mobile
  widths, filters for type/status.

## 5. RBAC

Reuses `RolesGuard` exactly as every other domain: `GET` is authentication-only (Member
read-only); every write requires `Owner` or `Administrator`.

**Known limitation, deliberate:** the brief's Field Sales UX assumes a "Sales Agent" can
register customers/outlets/orders from their phone. There is no dedicated Sales Agent
role in this codebase yet — introducing one would mean touching Identity's role
registration, the seed script's role block, and the User Management role picker, which is
out of scope for this sprint (the brief itself says: reuse `RolesGuard` as-is, no
permission engine). **Every Sprint 4.8 write endpoint requires `Owner` or
`Administrator`** — a "Sales Agent" today is a tenant-assigned Administrator account.
`Member` has read-only access everywhere, same as every other domain. See
[retail-network.md](retail-network.md) §7 for the documented future module-level access
architecture this decision is a placeholder for.

## 6. Tenant Isolation

Every repository method takes `organisationId` and includes it in the query; a
cross-tenant `id` 404s exactly like a nonexistent one. Verified live: registering a
second tenant and attempting to read another organisation's customer by id returns `404`,
never a data leak.

## 7. Audit Events

`customer.created`, `customer.updated`, `customer.activated`, `customer.deactivated`.

Added Phase 1: `customer.credit_limit_updated` — recorded via the existing
`AuditService` whenever a credit limit is set or cleared (see §9). `metadata` carries
a field-level diff, `{ creditLimit: { old, new } }`. Live-verified: a real credit-limit
change produced a real audit-log row with the correct actor, entity, and
`{old: null, new: 1000000}` diff.

## 8. API Reference

| Endpoint                                    | Auth                             | Notes                                           |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| `GET /api/retail/customers`                 | Any authenticated                | `?status=&customerType=&territoryId=&search=`   |
| `GET /api/retail/customers/:id`             | Any authenticated                |                                                 |
| `POST /api/retail/customers`                | Owner/Administrator              | Only type/name/phone required                   |
| `PATCH /api/retail/customers/:id`           | Owner/Administrator              | `customerCode`/`status` never accepted          |
| `POST /api/retail/customers/:id/activate`   | Owner/Administrator              |                                                 |
| `POST /api/retail/customers/:id/deactivate` | Owner/Administrator              |                                                 |
| `PATCH /api/retail/customers/:id/credit`    | `finance.customer_credit.manage` | Added Phase 1 — set/clear the credit limit (§9) |

## 9. Customer Account Management (Phase 1)

Implemented in the sprint documented by
[`docs/customer-account-inventory-audit.md`](../customer-account-inventory-audit.md)
(the audit) and
[`docs/sprint-customer-account-phase-1-completion-report.md`](../sprint-customer-account-phase-1-completion-report.md)
(the completion report, which is the authoritative record of exactly what shipped).
This section summarises that implementation from the Customer domain's own
perspective; see [Finance](finance.md) §21 for the receivable/statement/payment
mechanics it builds on.

### 9.1 The Customer Account page

`apps/web/src/app/(app)/settings/retail/customers/[id]/page.tsx` — reachable via a
"View Account" action on each row of the existing Customers table at
`/settings/retail`. Six tabs, each independently data-fetched:

- **Overview** — commercial profile, outlets, a period-scoped financial summary
  (invoiced/paid this period, current outstanding, overdue, outstanding/overdue
  invoice counts, pending Sales Order count and unfulfilled value kept as a visibly
  separate figure from receivables — never summed into one number), and the credit
  exposure card (§9.2).
- **Transaction History** — a single chronological, filterable, paginated list
  merging Sales Orders, Invoices, Payments, Credit Notes, and Returns for this one
  customer.
- **Invoices** — the customer's outstanding invoices, reusing the same
  `InvoiceRepository` lookup `InvoiceController` itself uses.
- **Payments** — the customer's payment history, including per-invoice allocation
  breakdown and an `unallocatedAmount` figure (§21.3 in Finance).
- **Statement** — opening balance, chronological debit/credit lines, running
  balance, closing balance, CSV export. See [Finance](finance.md) §21.2 for the exact
  calculation and its one documented limitation.
- **Credit Settings** — only rendered when the viewer holds
  `finance.customer_credit.manage`; the backend never sends the editable control's
  data to a viewer who lacks it (the same "omit, don't merely hide with CSS"
  convention every other permission-gated section in this codebase already follows).

None of these tabs introduce a second customer-balance or accounting engine — every
figure is composed from the **existing** `AccountsReceivableService`,
`InvoiceRepository`, `PaymentRepository`, and `CreditNoteRepository`, the same
Reporting-module composition pattern the Sprint 45/46 dashboards already established
(`CustomerAccountReportService`/`CustomerStatementReportService`, in
`apps/api/src/reporting/reports/`). Each tab's data is independently omitted (never
a fabricated zero, never a 403 for the whole page) when the viewer lacks that
section's own existing permission — Overview/profile needs `sales.customer.view`
(the base gate for the whole page); the financial summary and credit section need
`finance.invoice.view` **and** `finance.payment.view` together; Transaction History's
Sales Order rows need `sales.order.view`, its Credit Note rows need
`finance.credit_note.view`, its Return rows need `sales.customer_return.manage`.

### 9.2 Credit limits — warning-only, not an enforcement engine

`Customer.creditLimit` (§2) plus `AccountsReceivableService.getCustomerBalance()`'s
existing `totalOutstanding` figure drive a read-time-only exposure calculation in
`CustomerAccountReportService`:

- `availableCredit = creditLimit - totalOutstanding` (`null` when unconfigured).
- Status: `NO_LIMIT` · `WITHIN_LIMIT` (`totalOutstanding` below 80% of the limit) ·
  `APPROACHING_LIMIT` (80%–99% of the limit) · `AT_OR_OVER_LIMIT` (`totalOutstanding
  > = creditLimit`). The 80% threshold is a single documented constant
(`CustomerAccountReportService.APPROACHING_LIMIT_THRESHOLD_RATIO`), not yet a
  > per-organisation setting.
- **This is a warning, not a restriction.** No Sales Order, Invoice, or Payment
  creation path reads `Customer.creditLimit` or checks credit status — confirmed by
  inspection of `sales-order.service.ts`, `invoice.service.ts`, and
  `payment.service.ts`, none of which reference the field. A customer at or over
  their configured limit can still be sold to, invoiced, and paid without
  obstruction; the only visible effect is a warning banner on this customer's own
  Overview tab. There is no approval workflow, no credit hold, and no credit
  scoring — §5's "explicitly deferred" framing in Finance still holds for those
  specifically; only the limit-and-warning piece has shipped.
- Setting or clearing a limit requires `finance.customer_credit.manage` — a new
  permission, deliberately **not** folded into `sales.customer.manage` (a Finance-
  owned credit-exposure decision, not a routine Sales Administration edit). Granted
  to Administrator (via its existing blanket grant) and Head of Finance; not granted
  to Member. Every change is audited (§7).

### 9.3 Multi-invoice payment allocation

A `Payment` recorded against this customer can now be split across several of their
invoices in one request — see [Finance](finance.md) §21.3 for the exact mechanics,
constraints (allocations must sum to exactly the payment amount), and the
`void()` reversal behaviour.

### 9.4 Outlet inventory visibility (Phase 2B)

An `Outlet` may now have a dedicated `InventoryLocation` of its own
(`locationType: CUSTOMER_LOCATION`) — see [Inventory](inventory.md) §14 for the full
design. This is a one-to-at-most-one relationship (`InventoryLocation.outletId` is
database-unique): an `Outlet` either has no dedicated location yet, or has exactly
one. Establishing it, viewing its stock, and moving stock into/out of it are all
Inventory-domain actions (`inventory.location.manage`/`inventory.stock.view`/
`inventory.transfer.create`/`inventory.adjustment.create`) — nothing was added to
`sales.customer.manage`/`sales.customer.view`, and no new field was added to
`Customer` or `Outlet` themselves. The relationship stays exactly where it already
lived: `Outlet` is one join away from its `Customer`
(`Outlet.customerId`, unchanged), and a dedicated location is one join away from
its `Outlet` (`InventoryLocation.outletId`, new) — neither record duplicates the
other's data. Collection Point outlets are unaffected: Phase 2B does not create,
assign, or move any Collection Point to a dedicated location (that cutover remains
Phase 2C, per Inventory §14.6/§14.7).

### 9.5 B2B fulfilment ownership transition (Phase 2C)

When a B2B `SalesOrder` with a non-null `outletId` is fulfilled AND that Outlet
already has a dedicated `CUSTOMER_LOCATION` (§9.4), the fulfilled quantity is
now also recognised as `CUSTOMER`-owned stock at that location — see
[Inventory](inventory.md) §15.1 for the full mechanics. This is visibility and
ownership bookkeeping only: no new field was added to `Customer`/`Outlet`, no
new permission was added, and nothing here changes how a Sales Order or
Customer record itself behaves. An Outlet with no dedicated location, or a B2B
order with no `outletId` at all, is completely unaffected — today's behaviour
is exactly preserved in both cases.

A `CustomerReturn` against such a fulfilment also reconciles the Outlet's
`CUSTOMER`-owned claim (§Inventory §15.2) — independent of, and never
conflated with, the existing credit-note/COGS-reversal logic this domain
already relies on.

## 10. Known Limitations

- No dedicated Sales Agent role — see §5.
- No customer merge/deduplication tooling.
- No purchase-history-based segmentation (e.g. "customers who haven't ordered
  recently") — the relational structure supports building this later; no query exists
  yet.
- Codes are globally unique across the shared database, not per-tenant — same convention
  as every other auto-numbered entity in this codebase.
- **Phase 1 Customer Account additions** (§9): the Customer Account page's "View
  Account" entry point was added only to the desktop admin Customers table — the
  mobile Field Sales customer card (`(field)/field/customers/`) and its own detail
  page were left unchanged. The 80% approaching-limit threshold is a single hardcoded
  constant, not yet configurable per organisation. No credit-limit warning was added
  to Sales Order/Invoice/Payment creation flows themselves — the warning is visible
  only on this customer's own Overview tab. See [Finance](finance.md) §21.4 for the
  Customer Statement's own documented limitation (historical point-in-time accuracy
  after a transaction is later voided) and §21.3 for why partial/unallocated advance
  payments remain unsupported.
