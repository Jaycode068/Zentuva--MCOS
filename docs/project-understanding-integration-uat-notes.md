# Project understanding for later integration testing and UAT

Prepared 15 October 2026 from documentation and selected implementation reads.
This is an orientation baseline, not a completed code audit, test run, or readiness verdict.
The working tree contained substantial existing uncommitted changes during this review.
Recheck the revision, working tree, migrations, configuration, and database state before assessment.

## What the product is

Zentuva is a configurable, multi-tenant Manufacturing & Commerce Operating System.
Boby Bites is the pilot tenant. The product joins suppliers, procurement, warehouse,
production, customers/outlets, sales/distribution, finance, and consumer commerce.
Additional implemented areas include assets, maintenance, HR/recruitment, access
control, approvals, notifications, promotions/loyalty, and management reporting.

## How it is built

- pnpm/Turborepo monorepo; Next.js 14 App Router/React frontend in `apps/web`;
  NestJS 10 modular-monolith API in `apps/api`.
- PostgreSQL through Prisma; centrally maintained schema and migrations in
  `apps/api/prisma`. Shared UI, types, utilities, validation, and configuration
  live under `packages`.
- Application-enforced shared-database tenancy, predominantly `organisationId`.
  Tenant isolation must be tested at query, mutation, relationship, and report boundaries.
- API bootstrap mounts `/api`, validation, CORS, raw request bodies for webhook
  verification, and local uploads. Frontend API helpers attach bearer tokens.
- Domain ownership is the default; selected operational repositories deliberately
  write stock and accounting inside the same Prisma transaction for atomicity.
  Assess these documented exceptions rather than assuming every cross-domain write is a defect.
- Accounting lives inside Finance. `postSystemJournalEntry` is the shared posting
  boundary; missing system accounts or open periods fail the surrounding operation.
- Access Control resolves active users, active roles, permission keys, and scopes
  live. Authentication, permission grants, record scope, and workflow eligibility
  are separate checks. User login identity is separate from HR Employee identity.
- Desktop administration and mobile field/self-service workflows have distinct surfaces.
- Development runs apps on the host with Docker infrastructure. Redis infrastructure
  does not itself establish that background queues or schedulers are implemented.

## Business chains to assess later

| Chain                                                                                          | Important outcomes and boundaries                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier → PO → approval → goods receipt → supplier invoice/payment                            | Receiving quantities/statuses, discrepancy resolution, stock cost, AP/GRNI recognition, invoice matching without duplicate liabilities, settlement                                                |
| BOM → production order → material issue → completion                                           | Atomic stock changes, weighted-average cost snapshots, WIP and finished-goods postings, partial work and insufficient materials                                                                   |
| Customer/outlet → sales order → fulfilment → dispatch/delivery                                 | Confirmation alone does not deduct stock; fulfilment deducts and posts COGS; distribution must not duplicate that event                                                                           |
| Invoice → payment/allocation → credit note/return                                              | Revenue versus COGS timing, AR, partial settlement, allocation races, return dispositions and reversals                                                                                           |
| Warehouse → customer outlet                                                                    | Location, ownership, and commercial arrangement are independent; B2B outlet recognition can become CUSTOMER/WHOLESALE at fulfilment; transfers preserve ownership                                 |
| WhatsApp → consumer/conversation → order → OPay → collection                                   | Channel adapter reuses conversation/business services; provider callbacks, duplicate messages, payment state, assignment, readiness, pickup, and cancellation require end-to-end proof            |
| Collection point stock                                                                         | Company-owned D2C stock must remain separate from customer-owned wholesale stock; new assignment requires a dedicated eligible location, with documented legacy fallback for existing assignments |
| Workflow → notification → email/WhatsApp delivery                                              | Durable workflow facts differ from recipient notifications and delivery attempts; preferences, claims, retries, stale leases, and eligibility must not alter the source business decision         |
| Recruitment → approved hiring → vacancy/application → interviews → offer → employee/onboarding | Human decisions, evaluator confidentiality, permission revocation, duplicate acceptance, and Employee/User distinction                                                                            |
| Asset → maintenance → parts/procurement/budget                                                 | Asset lifecycle ownership, repeat-safe preventive generation, parts issue side effects, and deliberate limits on financial integration                                                            |
| Operational/financial data → reports/dashboard                                                 | Authoritative source reuse, per-section permissions, tenant isolation, ownership-filtered valuation, date/timezone boundaries, and read-only calculations                                         |

## Testing baseline and constraints

- Default API Jest configuration excludes `*.integration.spec.ts`; `pnpm test`
  therefore does not establish database integration correctness.
- The web package's test script currently reports no tests. Browser acceptance
  coverage must be assessed separately from API unit/integration coverage.
- Sixteen integration spec files were found, covering stock concurrency,
  adjustments/transfers/ownership, fulfilment, payment allocations, promotions,
  WhatsApp dedup/delivery, D2C ordering/configuration, reporting, and DB safeguards.
- Integration Jest hooks require a verified disposable test database and set
  `DATABASE_URL` from `TEST_DATABASE_URL` before test files construct clients.
- `docker-compose.test.yml` uses a separate Compose project from development.
  Compose profiles do not isolate teardown. Prior reports describe operational
  data loss and unsafe cleanup; preserve target verification and fixture ownership.
- Latest account-provisioning report records 13/16 integration suites passing,
  with failures in reporting tenant isolation and two conversation-config suites
  because a second seeded organisation was absent. It also records cascading
  teardown errors. These are historical results, not independently rerun here.
- Before execution, verify isolated targets and provision deterministic disposable
  fixtures for at least two tenants. Never infer passing tenant isolation from
  a skipped test or a single-tenant run.

## Documented concerns requiring fresh verification

1. D2C revenue recognition remains an explicit open accounting policy in the
   Phase 2C report. Payment recording/order confirmation and fulfilment COGS do
   not establish complete consumer revenue accounting.
2. Stage 5A reports proactive consumer WhatsApp notifications using free-form
   messages outside the allowed session window, webhook signature verification
   bypass when the app secret is absent, and ambiguous multi-tenant phone routing.
   Confirm code and intended deployment settings; do not assume old environment observations persist.
3. No stock reservation/refund mechanism is documented for the collection journey.
   Atomic final decrement protects quantity correctness but can still leave paid
   orders needing operational intervention. UAT must exercise that recovery path.
4. Dedicated collection-point cutover was reported incomplete for seeded outlets.
   Verify actual eligible locations, ownership, physical counts, and assignment behaviour.
5. Manual inventory-adjustment accounting/idempotency was recently added. The
   later 4E.4D.1 report supersedes 4E.4D's pending development-account provisioning
   step. Recheck provisioned accounts, rollback/replay behaviour, and historical
   seed-induced reconciliation differences rather than assuming a clean baseline.
6. Scope enforcement varies by resource; use the authorization coverage document
   and actual guards/services rather than interpreting a configured scope as proven enforcement.

## Reading map and evidence precedence

Start with `README.md`, handbook principles, and ADR-001 through ADR-004 for intent.
Use domain documentation and architecture notes for business rules and boundaries.
Use subsequent sprint reports to identify changes, policy decisions, and superseded claims.
Validate current behaviour in code and isolated execution before issuing findings.

The architecture overview still says authentication/business domains do not exist;
the API index says only health exists; the database index describes an early
Identity-only schema. These are historical snapshots, contradicted by current
module registration, schema, and domain documentation. Domain documents also
contain older sprint-specific limitations alongside later implementations.

Key detailed references: `docs/domains/{inventory,accounting,finance,sales,d2c,
workflow,access-control,notifications,reporting}.md`,
`docs/architecture/authorization-coverage.md`,
`docs/architecture/notification-activity-boundaries.md`,
`docs/development/local-development.md`,
`docs/sprint-test-database-isolation-completion-report.md`,
`docs/sprint-phase-2c-financial-integrity-review.md`,
`docs/sprint-stage-4e4d1-inventory-adjustment-account-provisioning-completion-report.md`,
and `docs/sprint-stage-5a-d2c-collection-point-mvp-readiness-assessment.md`.

## Later assessment deliverables

Build a requirements-to-test matrix with actors, permissions, tenant/configuration
prerequisites, happy paths, rejection/recovery paths, and expected database,
ledger, notification, and UI outcomes. Execute isolated integration tests and
role-based browser UAT, preserving evidence and separating product defects,
fixture/environment failures, open business decisions, and deferred capabilities.
Agree business acceptance criteria and sign-off owners before declaring UAT complete.

No application code or database was changed, and no tests or external-provider
operations were executed during this orientation review.
