# Zentuva

**Zentuva** is a cloud-native **Manufacturing & Commerce Operating System (MCOS)** built for African
businesses. It connects every participant in the manufacturing and commerce value chain —
suppliers, factories, sales teams, distributors, retailers, and eventually consumers — into a
single intelligent platform.

The first tenant is **Boby Bites**, the pilot implementation that validates the platform. Every
feature is built configurably so it can be reused by future tenants without code changes.

> This repository has grown well past the initial engineering foundation. Identity, Product
> Catalogue, Supplier Management, Procurement, Inventory, Production, Customers, Outlets,
> Territories, Retail Network, Sales, and Distribution all have implemented foundations, wired end
> -to-end to a real double-entry Accounting engine (Chart of Accounts, Journal Entries, General
> Ledger) and a Finance domain covering Invoices/Payments/Credit Notes/Accounts Receivable,
> Accounts Payable/Supplier Invoices, read-only Financial Statements & Management Reporting, Cash
> & Bank Management / Reconciliation, a forward-looking Cashflow Management & Forecasting layer
> that is never persisted and never posts a journal entry, a Budgeting & Financial Planning layer
> where a `Budget` holds only planned amounts and is compared live against the Ledger and the
> Cashflow Forecast, a Capital & Debt Management foundation where a `CapitalRequirement` →
> `DebtFacility` → `DebtDrawdown`/`DebtRepayment` chain posts through the same General Ledger
> boundary and feeds the existing Cashflow Forecast as financing outflows, and — most recently —
> an Investment / Capital Project Management foundation where a `CapitalProject` tracks a
> project's own cost plan, funding mix, and Committed/Actual spend (derived from Procurement/AP,
> never re-entered), never a second accounting system or a duplicated forecast engine, and — the
> capstone, closing sprint of the Finance MVP — a Financial Decision & Scenario Analysis layer
> that composes all of the above into ROI/NPV/IRR/Payback/Sensitivity/Funding Comparison and a
> Management Financial Decision Cockpit, computed live from stored assumptions and never a second
> accounting/forecast/amortisation engine; scenario analysis is 100% side-effect-free. The Finance
> MVP, as scoped, is now considered functionally complete. Then, an Asset Register &
> Asset Management foundation opened a new top-level domain — not a Product, not an
> `InventoryStock` row, not a Purchase Order — for the durable physical resources the business
> owns: tenant-scoped hierarchical Asset Categories, a central `Asset` entity with lifecycle kept
> strictly separate from physical condition, a self-referencing asset hierarchy, a purpose-built
> Asset Location, immutable movement history, and optional read-only links to Supplier/Purchase
> Order/Capital Project — zero accounting integration, by construction. Next, a
> Maintenance Management foundation was built on top of that Asset Register — requests, reusable
> plans, date-/meter-based preventive schedules (idempotent by construction — repeat generation
> never creates a duplicate work order), work orders with a mobile-first technician workflow,
> tasks, downtime, parts usage, and operational cost capture — every asset-status interaction
> (`IN_SERVICE ⇄ UNDER_MAINTENANCE`) driven through the Asset domain's own lifecycle service, and,
> again, zero accounting or inventory-mutation side effects, by construction. Then, a
> Maintenance Ecosystem Integration sprint connected that zero-integration foundation to the rest
> of the business — real Inventory part-issuing (one deliberate, structurally-proven exception to
> the domain's own no-cross-domain-writes rule), a Procurement linking boundary, Budget
> cost-vs-budget comparison, and a Maintenance Analytics page — plus the Asset Register detail
> page's extended Maintenance section and a new mobile-first Field Technician surface built on the
> existing `assignedToId` convention, with no new RBAC role and zero accounting postings. Then, an
> HR Employee Lifecycle Foundation opened a new top-level domain — Department/Position
> (organisational units and job titles, explicitly never application permission roles), Employee
> (the central HR record, deliberately separate from `User` — not every employee has a login
> account, not every user is an employee), a real `employmentStatus` lifecycle validated
> server-side the same way Asset's own lifecycle is, and an onboarding checklist — again zero
> accounting/inventory/procurement/production/sales/distribution/asset/maintenance integration and
> no new permission engine, by construction. Most recently, an HR Attendance,
> Training & People Operations sprint extended that foundation with work schedules,
> server-authoritative sign-in/sign-out attendance (one record per employee per
> organisation-local day, privacy-conscious optional location capture that is never
> fabricated, an atomic dedicated correction-request/review flow), a versioned policy
> catalogue (publishing auto-archives the prior version; published versions are
> immutable), and a lightweight training catalogue explicitly not an LMS — plus a new
> dedicated self-service mobile surface at `/attendance`, kept separate from Field Sales
> and Field Maintenance by the same reasoning that already separated those two. Still
> zero accounting/inventory/procurement/production/sales/distribution/asset/maintenance
> integration and no new permission engine, by construction. Most recently, a
> Configurable Access Control sprint finally wired up the `Role`/`Permission`/
> `RolePermission`/`UserRole` tables Identity had seeded since its very first
> implementation sprint but that no guard had ever read — an 88-entry
> `module.resource.action` permission catalogue, an `AccessScope` model where an
> absent or `NONE` scope is never treated as unrestricted access, tenant-configurable
> roles layered on top of the protected system roles, a live-checked
> `EffectiveAccessResolver` so revoking access takes effect on the very next request
> even against an already-issued token, and a `PermissionsGuard` migrated onto 21 of
> the codebase's highest-risk mutation endpoints — with an exhaustive, honest account
> of exactly which domains remain on the older role-name check or no check at all,
> rather than a blanket "authorization added" claim. A hardening sprint then reviewed
> and classified all 534 API routes, eliminated the legacy role-name guard entirely
> (0 routes left on it, down from 261), and extended `PermissionsGuard` to 509 of them
> — including every previously-unguarded sensitive read — growing the permission
> catalogue to 121 entries and adding real, provable scope filtering (`OWN_TEAM`/
> `OWN_RECORDS`) wherever the underlying data could actually support it, honestly
> leaving the rest documented rather than pretended. Then, a Workflow &
> Approval Foundation sprint built a reusable, tenant-configurable sequential
> approval engine on top of that same Access Control layer — zero new authorization
> primitives, eligibility resolved entirely through the existing
> `EffectiveAccessResolver`/`ScopeEvaluator` — with Purchase Order as its first live
> integration, reusing `PurchaseOrderStatus`'s own pre-existing, previously-unreachable
> `PENDING`/`APPROVED` states with zero schema changes to that domain. Most recently, a
> Workflow Hardening sprint completed that engine's lifecycle before Notifications
> arrives: a dedicated resubmission path for a returned request (a new, linked
> `WorkflowInstance` restarting approval from step 1, never a rewind of the original —
> its full decision history stays immutable), a fixed domain-integration-atomicity bug
> (a workflow could previously be marked approved even when the underlying record's own
> update failed, with a safe retry path added), mandatory reject/return comments, a
> deliberate `EXPIRED` transition plus a read-time-only overdue computation with no
> background job, a database-level index closing a genuine concurrent-submission race
> found during the sprint's own audit, and — the sprint's central deliverable — a
> durable, idempotent workflow event log that a future Notifications sprint can consume
> without ever touching the workflow engine's internals. Most recently, a Notifications
> & Activity Centre Foundation sprint became that consumer — an in-app notification
> system built as a pure downstream reader of the workflow event log's own database
> table, never a service call into the workflow engine, proving the boundary the
> previous sprint built actually holds. Zero new authorization primitives; every
> notification is idempotent by a database-level constraint, not an application check;
> recipient eligibility reuses the workflow engine's own eligibility service unchanged,
> so a suspended user is structurally incapable of being notified about something they
> could no longer approve anyway. No queue or cron infrastructure exists yet, so
> processing is triggered on demand — a documented, deliberate MVP choice. Most
> recently, a Notification Reliability, Preferences & Activity Consolidation sprint
> hardened that foundation: an explicit, concurrency-safe processing state machine
> (`PENDING`/`PROCESSING`/`PROCESSED`/`FAILED`) using this codebase's own conditional-
> update claim idiom — live-verified by firing five simultaneous processing requests
> at one event and confirming exactly one succeeded — a bounded retry policy with
> backoff and stale-lease recovery, an operational admin surface to inspect and retry
> failed processing, and a tenant-scoped notification preference system whose
> suppression only ever affects future notification CREATION, never the underlying
> workflow event log or audit trail. Zero new authorization primitives; the two new
> permissions this sprint needed are auto-granted to the Administrator role through
> the existing catalogue-seed loop, unchanged. Deliberately still not email, SMS,
> push, or a second domain integration — those remain explicitly future work. Most
> recently, an Email Notification Delivery Foundation sprint added a second,
> genuinely downstream delivery channel — a real, provider-independent transactional
> email pipeline (a safe in-memory local provider for every automated test, and a
> real ZeptoMail SMTP adapter behind the exact same interface, selected once at boot
> and never silently substituted for each other) that consumes already-created
> in-app notifications, never `WorkflowEvent` or `WorkflowInstanceService` directly —
> `Workflow` remains completely untouched by this sprint. Its own concurrency-safe
> claim-based state machine, its own retry/backoff policy (deliberately longer than
> the in-app processor's, since SMTP failures behave differently), and its own
> asymmetric preference default (email starts OFF where in-app starts ON) — live-
> verified end-to-end, including catching and fixing a real starvation bug found
> during the sprint's own testing (a backlog of ineligible old notifications was
> silently blocking new ones from ever being emailed) and a real attempted send
> through ZeptoMail's SMTP endpoint that reached and authenticated against the real
> provider before being safely, informatively rejected — reported honestly rather
> than claimed as a success it wasn't. Deliberately still not SMS, push, or a
> marketing platform — every email traces back to exactly one real workflow event,
> by construction. See
> [docs/domains/README.md](docs/domains/README.md) for the
> current status of every domain and [docs/roadmap.md](docs/roadmap.md) for the full
> build order.

## Repository Structure

A Turborepo monorepo. See [docs/handbook/folder-structure.md](docs/handbook/folder-structure.md)
for the full breakdown.

```
apps/
  web/          Next.js frontend (desktop + mobile experiences)
  api/          NestJS backend (modular monolith)
packages/
  ui/           Shared shadcn/ui-based React component library
  types/        Shared TypeScript types
  config/       Shared ESLint, TypeScript, and Tailwind configuration
  utils/        Shared framework-agnostic utilities
  validation/   Shared Zod validation schemas
docs/           Handbook, local dev guide, domain docs, ADRs, API/database docs, changelog, roadmap
```

## Getting Started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up    # Postgres + Redis in Docker
pnpm db:generate && pnpm db:migrate
pnpm dev         # apps/web + apps/api on the host, with hot reload
```

Docker is used for infrastructure only (Postgres + Redis) — the apps themselves always run
directly on the host for fast hot reload. See
[docs/handbook/getting-started.md](docs/handbook/getting-started.md) for the quick-start, or the
[Local Development Guide](docs/development/local-development.md) for the full guide (migrations,
Prisma Studio, VS Code debugging, troubleshooting).

## Documentation

- [Engineering Handbook](docs/handbook/engineering-handbook.md)
- [Architecture Overview](docs/handbook/architecture-overview.md)
- [Development Workflow](docs/handbook/development-workflow.md)
- [Local Development Guide](docs/development/local-development.md)
- [Folder Structure](docs/handbook/folder-structure.md)
- [Architecture Decision Records](docs/adr/)
- [Changelog](docs/changelog.md)
- [Roadmap](docs/roadmap.md)
- [Domain Docs](docs/domains/) — start with [Identity](docs/domains/identity.md)
- [Sprint 0 Completion Report](docs/sprint-0-completion-report.md)
- [Sprint 1A Identity Design Report](docs/sprint-1A-identity-design-report.md)
- [Sprint 1B.1 Completion Report](docs/sprint-1B.1-completion-report.md)
- [Sprint 1B.2 Completion Report](docs/sprint-1B.2-completion-report.md)

## License

Proprietary — all rights reserved.
