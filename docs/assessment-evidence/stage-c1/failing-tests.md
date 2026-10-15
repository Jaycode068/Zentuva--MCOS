# Exact failing integration cases — Stage C1

Both unchanged runs fail the same 16 cases. Each failure is raised in suite setup before the business assertion executes.

## apps/api/src/reporting/reporting-tenant-isolation.integration.spec.ts

- Receivables: Org A and Org B never see each other's outstanding balance or customers
- Payables: Org A and Org B never see each other's supplier obligations
- Inventory valuation: Org A and Org B never see each other's stock lines
- Sales performance: Org A's order table and revenue breakdown never include Org B's orders/customers
- Workforce summary: Org A's headcount/department breakdown never includes Org B's employees or departments
- Production performance: Org A's production orders never appear in Org B's report, and vice versa
- Procurement summary: Org A's open purchase orders and supplier ids never appear in Org B's report, and vice versa
- Executive dashboard: composing every section for Org A never surfaces any of Org B's sales orders, production orders, or employees — Sprint 46's Final Architectural proof

Setup error: `This test requires at least one other seeded organisation.`

## apps/api/src/d2c/conversation-config/d2c-conversation-config-active-safety.integration.spec.ts

- an admin config save mid-flight never touches an active conversation's persisted state (separate tables, no cascade)
- the very next config resolution DOES reflect the admin's change — no stale caching, takes effect starting the next turn
- Final Architectural Test (brief) — getAdminView/getPreview for two real tenants, through the real admin service methods, never cross-contaminate

Setup error: `This test requires at least 2 seeded organisations.`

## apps/api/src/d2c/conversation-config/d2c-conversation-config-concurrency.integration.spec.ts

- two genuinely concurrent updates to the SAME message key on the SAME tenant resolve to exactly one final, uncorrupted value (never a torn write)
- two concurrent updates to DIFFERENT message keys on the same tenant never interfere with each other
- a concurrent update and reset-to-default on the same message key resolve to exactly one consistent final state — either the update survives, or the row is genuinely gone (never a half-written row)
- concurrent capability saves for Tenant A and Tenant B never cross-contaminate — each tenant reads back ONLY its own write
- a read for Tenant A during a concurrent write storm for Tenant B never observes Tenant B data

Setup error: `This test requires at least 2 seeded organisations.`

## Teardown errors

Both conversation-config suites additionally fail with `PrismaClientValidationError`: `in: [undefined, undefined]`. Full stacks are in run-1.log and run-2.log. The active-safety cleanup first executes a delete with an undefined conversation ID; the verified table was empty.

## Repeat comparison

Identical failing-case sets: True. No changed assertions or excluded suites.
