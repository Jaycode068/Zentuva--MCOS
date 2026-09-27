# Sprint 30.2 Completion Report — Hiring Request → HR Approval → Public Vacancy Flow Audit

## 1. Executive Summary

This was an audit, not a new build: inspect whether the existing Sprint 30 /
30.1 recruitment implementation actually _enforces_ the intended business
flow —

```
Department requester → Hiring Request → HR approval → Vacancy → HR publish → Public Careers
```

— and fix only what the audit found broken, using the existing architecture.
It found and fixed **one real code defect** and **one real seed/demo gap**
that together meant this flow could never actually be demonstrated end to
end on the seeded Boby Bites organisation, even though every individual
piece (state machine, permissions, Workflow integration) was already
correctly built:

1. **Code defect**: `VacancyService.create()` only checked that a supplied
   `hiringRequestId` _existed_ — never that it had been _approved_. A
   vacancy could be created from a `DRAFT`, `SUBMITTED`, `REJECTED`, or
   `CANCELLED` hiring request. Fixed with a status check; live-verified
   both a `DRAFT` and a `REJECTED` request are now correctly rejected
   (`400`).
2. **Seed/demo gap**: no seeded role anywhere held
   `hr.recruitment.hiring_request.manage` except Administrator — the
   permission was real, correctly catalogued, and correctly enforced, but
   nothing ever granted it to a genuine non-HR department user, so "Finance
   can request a Cashier" was structurally impossible to demonstrate. Fixed
   by granting it (plus `.view` and the prerequisite
   `hr.organisation_structure.view`) to the existing `Head of Finance` role,
   assigned to the existing Finance Officer demo user (Emeka Nwachukwu) —
   no new permission, no new role concept, no new user.

Everything else the audit checked — the `DRAFT→SUBMITTED→APPROVED/REJECTED`
state machine, the `HIRING_REQUEST_APPROVAL` Workflow integration, vacancy
`DRAFT`-by-default + explicit `publish()`, HR-only publish authorization,
and the public careers page's PUBLISHED-only visibility — was already
correctly built and required no change. One additional nuance was _observed_
live (not a defect, not fixed): routing a request through the real Workflow
engine records `requestedById` as whoever clicks "Route via Workflow," so if
HR does that on someone else's already-submitted request while also being
the only assigned approver, `allowSelfApproval: false` correctly finds zero
eligible approvers. Detailed in §5.

## 2. What Was Already Correct (audited, unchanged)

- **Hiring Request state machine** (`hiring-request.repository.ts`): every
  transition is a conditional `updateMany` scoped by `organisationId` AND
  the correct `fromStatuses` — `submit` only `DRAFT→SUBMITTED`, `approve`/
  `reject` only `SUBMITTED→APPROVED`/`REJECTED`, `cancel` only from
  `DRAFT`/`SUBMITTED`. A `REJECTED` request has no path back to
  `APPROVED` — confirmed via the state machine itself, not just the new
  vacancy-conversion check.
- **Workflow integration**: `HiringRequestWorkflowHandler` correctly
  implements `WorkflowSubjectHandler`, injects only `HiringRequestRepository`
  (never `HiringRequestService`/`RecruitmentModule`'s controllers), and both
  the direct-approval path and the Workflow-routed path converge on the
  exact same repository transition methods — one code path for "approved,"
  regardless of trigger. A real `HIRING_REQUEST_APPROVAL` `WorkflowDefinition`
  is seeded and functional.
- **Vacancy creation never auto-publishes**: `Vacancy.status` defaults to
  `DRAFT` in the schema; `createVacancySchema` has no `status` field a
  client could set; `publish()` is a separate, separately-permissioned
  action. Confirmed live: a freshly created vacancy is absent from
  `GET /careers/boby-bites` and its direct detail URL `404`s until
  explicitly published.
- **Publish authorization**: `hr.recruitment.vacancy.manage` gates create/
  update/publish/pause/close/cancel as one permission, granted only to
  Administrator in this org. Live-verified: Emeka (holding only the new
  hiring-request permissions) gets a clean `403` attempting to publish.
- **Public visibility rules**: unchanged from Sprint 30.1's own audit —
  `VacancyRepository.findPublicList`/`findPublicBySlug` filter to
  `PUBLISHED` and non-expired, server-side, not client-side.

## 3. What Was Broken and Fixed

### 3.1 `VacancyService.create()` — missing approval check (real defect)

**File**: [apps/api/src/hr/recruitment/vacancy.service.ts](../apps/api/src/hr/recruitment/vacancy.service.ts)

Before: `create()` called `hiringRequestRepository.findById()` and only
checked the result was non-null. A hiring request in ANY status — including
one that had just been _rejected_ — could be linked to a new vacancy.

After: an additional check throws `BadRequestException` (`Hiring request
must be APPROVED to create a vacancy from it (currently {status})`) unless
the resolved hiring request's `status === 'APPROVED'`. An administrative
vacancy with no `hiringRequestId` at all (a legitimate, pre-existing use
case) is unaffected — the check only runs when one is supplied.

Live-verified via direct API calls: creating a vacancy from a fresh `DRAFT`
request → `400`; submitting and then rejecting that same request, then
retrying → `400` again (`currently REJECTED`); the real, approved "Finance
Officer" request → succeeds.

### 3.2 No non-HR role could create a hiring request (seed/demo gap)

The permission `hr.recruitment.hiring_request.manage` (create/submit/
cancel) already existed in the catalogue and was already correctly checked
by `HiringRequestController`. The gap was entirely in the seed: across every
custom role Boby Bites seeds (Head of Finance, Finance Staff, Production
Manager, Sales Manager, Procurement Officer, Interview Panelist, …), none
held this permission — only Administrator, via the blanket "grant the whole
catalogue" loop. In practice this meant only HR/Administrator could ever
raise a hiring request, collapsing "our department needs someone" and "HR
approves" into the same actor — the opposite of what the brief's own worked
example ("Finance can request a Cashier") describes.

**Fix** (`apps/api/prisma/seed.ts`, new `seedDepartmentRequesterFixtures()`):
grants `hr.recruitment.hiring_request.manage`, `hr.recruitment.hiring_request.view`
(`ORGANISATION` scope), and `hr.organisation_structure.view` to the existing
`Head of Finance` role, and assigns that role to the existing Finance Officer
demo user (Emeka Nwachukwu, `emeka.nwachukwu.demo@bobybites.local`) — who
already existed and already held `Finance Staff` + `Employee Self-Service`.
No new permission, no new role, no new user, no hardcoded department name —
purely existing, configurable role/permission grants.

`hr.organisation_structure.view` was a second finding _inside_ this fix,
caught live: the create-hiring-request form's department/position dropdowns
call `GET /hr/departments`/`GET /hr/positions`, both gated by that permission
— without it, Emeka could open "New Hiring Request" but both dropdowns
rendered empty (`403` on load, silently swallowed by the query client).

**Why its own function, not added inside the existing Sprint 25/30 seed
functions**: those functions (`seedAccessControlFixtures`,
`seedRecruitmentFixtures`) each guard themselves with "if this role/
definition already exists, skip the entire function" — correct for their
own one-time setup, but it means anything added _inside_ them after a
database has already been seeded once (true of this exact dev database,
seeded many sprints ago) would silently never run. `seedDepartmentRequesterFixtures()`
has no such guard — `grantRolePermissions` (`createMany({skipDuplicates:
true})`) and `assignRoleIfMissing` (`upsert`) are both already safe to call
on every run — so it converges to the same correct state whether the
database is brand new or has been seeded 50 times before. Verified: ran the
full seed twice in a row, permission-row count on Head of Finance unchanged
between runs (27 both times).

## 4. Live Verification — Full Flow, Boby Bites

All of the following were executed against the real dev database and a
real browser session, not simulated:

1. **Logged in as Emeka Nwachukwu** (Finance Officer, holds `Head of
Finance` — a genuine non-HR, non-Administrator account) and opened
   `/settings/hr/recruitment/hiring-requests`. Page loaded; "New Hiring
   Request" created a real `DRAFT` `HiringRequest` for a second Finance
   Officer position (department = Finance, position = Finance Officer).
2. Clicked **Submit** → `DRAFT → SUBMITTED`, confirmed in the UI.
3. **Confirmed zero public leakage**: `GET /api/careers/boby-bites` still
   returned only the pre-existing `Cashier` vacancy — a pending hiring
   request has no path to public visibility at all (it isn't even part of
   the public API's data model).
4. **Emeka attempted to approve his own request** (`POST
.../approve`) → `403 Forbidden`. Confirmed a plain requester cannot
   self-approve.
5. Logged in as **Administrator** and approved the same request directly
   (`hr.recruitment.hiring_request.approve`) → `APPROVED`.
6. Attempted vacancy creation from a **separate, still-`DRAFT`** hiring
   request created for this test → `400` ("must be APPROVED... currently
   DRAFT"). Submitted and rejected that same request, retried → `400`
   again ("currently REJECTED"). Both via direct API calls against the real
   database.
7. **Emeka attempted to publish** the eventual vacancy (`POST
.../publish`) → `403 Forbidden` (`Missing required permission:
hr.recruitment.vacancy.manage`).
8. As Administrator, created a real `Vacancy` ("Finance Officer") from the
   now-`APPROVED` hiring request via the UI — confirmed `DRAFT` status,
   `hiringRequestId` correctly linking back to Emeka's request.
9. **Confirmed still not public while `DRAFT`**: `GET
/api/careers/boby-bites` unchanged; direct `GET
/api/careers/boby-bites/finance-officer` → `404`.
10. Clicked **Publish** → `PUBLISHED`.
11. **Confirmed now public**: `/careers/boby-bites` (real browser,
    restarted dev server after a stale-cache issue) now shows both "Finance
    Officer" and "Cashier" as Open Positions.
12. **A real external candidate applied**: opened
    `/careers/boby-bites/finance-officer/apply`, filled in candidate
    details and a cover letter, submitted → real "Application Submitted"
    confirmation screen, no internal id exposed.
13. Confirmed the resulting `Vacancy.hiringRequestId` in the database
    correctly traces back through Emeka's original request — the full
    chain (`requester → request → approval → vacancy → publish → public →
application`) is real, not simulated, end to end.

## 5. Observed, Not Fixed: Self-Approval on Workflow-Routed Requests

While testing the Workflow-routing path (`POST /workflows/instances` +
`.../submit`, as an alternative to direct approve/reject), Administrator
clicked "Route via Workflow" on Emeka's already-submitted request. The
resulting `WorkflowInstance.requestedById` was recorded as **Administrator**
(whoever calls `createWorkflowInstance`, not necessarily the original
`HiringRequest.requestedById`). Since the seeded `HIRING_REQUEST_APPROVAL`
definition's one step is assigned to Administrator and `allowSelfApproval:
false`, `WorkflowEligibilityService.checkStepEligibility` correctly found
Administrator ineligible to approve their own workflow submission — zero
eligible approvers, no notification generated, instance permanently
unapprovable through Workflow.

This is the self-approval guard working exactly as designed, not a defect —
confirmed by tracing `workflow-eligibility.service.ts`'s own documented
logic. It does mean that, in this org's _current_ permission configuration,
only Administrator can call `POST /workflows/instances` at all (no one else
holds `workflow.instance.submit`), so Workflow-routing a Hiring Request only
ever succeeds when the actual original requester — not HR acting on their
behalf — is the one who routes it. The direct `hiring_request.approve`
action (used for the live demo in §4) remains fully correct and available
regardless. No code change was made for this; it's recorded here per the
brief's "document any defects discovered... do not hide defects simply
because they were fixed" — this one didn't need fixing, but is worth an
organisation's attention if they configure Workflow routing for hiring
requests.

## 6. Access Control — Final State

| Role                      | `hiring_request.manage`      | `hiring_request.approve` | `vacancy.manage` |
| ------------------------- | ---------------------------- | ------------------------ | ---------------- |
| Owner / Administrator     | ✅ (bypass / full catalogue) | ✅                       | ✅               |
| **Head of Finance** (NEW) | ✅                           | ❌                       | ❌               |
| Every other seeded role   | ❌                           | ❌                       | ❌               |

Purely additive — no existing grant was removed or narrowed. The pattern
(`.manage` to a department role, `.approve`/`vacancy.manage` reserved for
HR/Administrator) is fully generic and configurable per-organisation; Head
of Finance is simply this seed's one demonstrated example, not a hardcoded
mechanism.

## 7. Testing

- **215 suites / 1861 tests, all passing** (up from 213/1819 before this
  audit).
- **26 new tests**: `hiring-request.repository.spec.ts` (new, 20 tests) —
  the actual conditional `updateMany` each lifecycle transition builds,
  proving every allowed/disallowed status transition and full tenant
  isolation (a cross-tenant id cannot be approved even with the correct
  status). `vacancy.service.spec.ts` (+6 tests) — the §3.1 fix: `DRAFT`/
  `SUBMITTED`/`REJECTED`/`CANCELLED` hiring requests all correctly rejected,
  an `APPROVED` one succeeds, and an administrative vacancy with no hiring
  request at all is unaffected.
- Typecheck: clean (`tsc --noEmit`).
- Lint: 27 pre-existing warnings, 0 new (confirmed unchanged from the
  pre-audit baseline).
- Build: both `nest build` and `next build` succeed.
- `npx prisma validate`: schema valid. `npx prisma migrate status`: database
  schema up to date (no new migration needed — this audit was pure
  application/seed logic, no schema change).
- Seed: idempotent — ran twice in direct succession; `Head of Finance`'s
  permission-row count identical both times (27), no duplicates, no errors.

## 8. Documentation

- [`docs/domains/recruitment.md`](domains/recruitment.md) — new §2.1
  ("Hiring Request → Vacancy Conversion") documenting the fix, the
  requester/approver seed change, and the self-approval nuance; §3 updated
  to reference the new approval requirement; §12 updated with a live-
  demonstrated requester-vs-approver note; §16 updated with the new test
  counts.
- `docs/sprint-30.2-completion-report.md` — this document.

## 9. Final Lifecycle (confirmed, end to end)

```
Head of Finance (Emeka)         →  Create + Submit Hiring Request
                                     (hr.recruitment.hiring_request.manage)
Administrator                   →  Approve (hr.recruitment.hiring_request.approve)
                                     — direct action or real Workflow routing
Administrator                   →  Create Vacancy from the APPROVED request
                                     (hr.recruitment.vacancy.manage; rejects
                                     non-APPROVED requests — §3.1)
Vacancy starts DRAFT            →  Not public
Administrator                   →  Publish (hr.recruitment.vacancy.manage)
Vacancy PUBLISHED               →  Appears at /careers/{organisationSlug}
External candidate              →  Applies — no Zentuva account required
```

## 10. Git Status

- **No commit made.**
- **No push made.**
- Branch: `main`.
- HEAD: `a536feb135b8194458fc2fb4cebe16b470740dfb` — "Sprint 29: WhatsApp
  Notification Delivery Foundation" (unchanged by this audit's work).
- Working tree: 27 modified files, 14 new top-level paths (excluding the
  unrelated `.claude/` tooling directory) — this audit's own new file
  (`apps/api/src/hr/recruitment/hiring-request.repository.spec.ts`, plus the
  new `docs/sprint-30.2-completion-report.md`) sits alongside edits inside
  `apps/api/prisma/seed.ts` and
  `apps/api/src/hr/recruitment/vacancy.service.ts`/`vacancy.service.spec.ts`,
  all already-tracked-as-modified or already-untracked-as-new from prior
  sprints — nothing staged, nothing committed, per this sprint's own
  standing "DO NOT commit. DO NOT push." instruction.
- Two harmless demonstration rows remain in the database, consistent with
  this session's "nothing deletes rows" convention: a `DRAFT`-then-
  `REJECTED` test `HiringRequest` created purely to exercise §3.1's guard,
  and a `Vacancy`-conversion attempt against it that correctly never
  created a row (the `400` responses in §4 item 6 never produced a
  `Vacancy`). The real "Finance Officer" hiring request, its resulting
  published `Vacancy`, and Funke Adebayo's real application all remain in
  place as the live demonstration of the completed flow.
