# Recruitment & Candidate Interview Management Domain

Sprint 30 — Recruitment & Candidate Interview Management Foundation. Closes the
one gap left in Zentuva's HR lifecycle: how a person _becomes_ an `Employee` in
the first place. Built as a genuine extension of the HR domain — never a
separate application — reusing the existing Workflow engine (hiring-request
approval only), the existing Notification/Email/WhatsApp pipeline (interview
notifications), and the existing `Employee`/`EmployeeOnboarding` models (the
final candidate→employee conversion).

```text
Hiring Request
      │
      ├── optionally → WorkflowInstance (subjectType 'HIRING_REQUEST')
      │                 via the EXISTING generic /workflows/instances endpoints
      ↓
Vacancy (owns its own InterviewStage config directly)
      │
      ├── Public Careers Page — /careers/{orgSlug}[/{vacancySlug}[/apply]]
      ↓
Candidate + Application (+ ApplicationAnswer against VacancyQuestion)
      ↓
HR Screening (SUBMITTED → SCREENING → SHORTLISTED / REJECTED)
      ↓
InterviewStage 1 → Interview (per application) → InterviewParticipant (snapshot)
      ↓
InterviewEvaluation (one row per participant, immutable once submitted)
      ↓
InterviewStageDecision (HR-only: ADVANCE / HOLD / REJECT) — authoritative
      ↓
InterviewStage 2 → … (HR explicitly advances each time — never automatic)
      ↓
Application → SELECTED (once the vacancy's LAST stage is advanced)
      ↓
Offer (DRAFT → ISSUED → ACCEPTED/DECLINED/EXPIRED/WITHDRAWN)
      ↓
Offer accepted → Employee (existing model, DRAFT → ONBOARDING)
      ↓
EmployeeOnboarding.start() — EXISTING service, called internally, unchanged
```

## 1. Core Architectural Principle

Recruitment is part of the HR domain, not a separate application. Conceptually:

```text
HR
│
├── Hiring Requests
│
├── Recruitment
│   ├── Vacancies
│   ├── Candidates
│   ├── Applications
│   ├── Interview Stages / Participants
│   ├── Interviews / Evaluations / Stage Decisions
│   └── Offers
│
└── Employees
    └── Onboarding
```

Implemented as its own NestJS module (`apps/api/src/hr/recruitment/`,
`RecruitmentModule`) purely to avoid bloating `HrModule`'s existing provider
list with ~13 new models' worth of services — not because Recruitment is
conceptually separate. It imports `HrModule` for `EmployeeService`/
`DepartmentService`/`PositionService`/`EmployeeOnboardingService` (the last
newly exported this sprint), `FileStorageModule` (candidate resume uploads,
the same `FileStorage` port `EmployeeDocumentService` already uses), and
`IdentityModule`/`AuthModule`.

## 2. Hiring Request

A formal request that a position be filled (`HiringRequest`) —
`organisationId`-scoped, with `departmentId`/`positionId`/`requestedHeadcount`/
`employmentType`/`reason` (`NEW_POSITION`/`REPLACEMENT`/`EXPANSION`/`OTHER`)/
`justification`/`requestedStartDate`/`requestedById`/`status`
(`DRAFT`/`SUBMITTED`/`APPROVED`/`REJECTED`/`CANCELLED`).

**Workflow integration is optional, by design.** `HiringRequestService` exposes
its own `submit()`/`approve()`/`reject()`/`cancel()` (permissions
`hr.recruitment.hiring_request.manage`/`.approve`), so an organisation with no
approval process configured can move a request `DRAFT → SUBMITTED →
APPROVED/REJECTED` directly. An organisation that DOES want approval routing
attaches a `WorkflowInstance` to the request via the SAME generic
`POST /workflows/instances` + `.../submit` + `.../approve` endpoints Purchase
Order already uses (never a recruitment-owned wrapper) — a seeded
`HIRING_REQUEST_APPROVAL` `WorkflowDefinition` (subjectType `HIRING_REQUEST`)
exists for this. `HiringRequestWorkflowHandler`
(`apps/api/src/workflow/handlers/hiring-request-workflow.handler.ts`)
implements the exact `WorkflowSubjectHandler` recipe Purchase Order's own
handler established (Sprint 26): `WorkflowModule` imports `RecruitmentModule`
to construct it, injecting only the exported `HiringRequestRepository` — never
`HiringRequestService`, never any of Recruitment's controllers.
`validateForSubmission` accepts either `DRAFT` or already-`SUBMITTED` (a
request may be routed into approval either freshly or after being moved to
`SUBMITTED` directly), and `onWorkflowSubmitted`/`onWorkflowApproved`/
`onWorkflowExited` all call the SAME `HiringRequestRepository` transition
methods the direct HR action uses — one code path for "a hiring request became
approved," regardless of which trigger reached it. Live-verified end-to-end
(§11): a hiring request routed through a real `WorkflowInstance`, approved by
its assigned approver, correctly flipped to `APPROVED` via the handler
callback.

Candidate/Application/Interview are **never** `WorkflowInstance`s — only the
`HiringRequest` itself is a Workflow subject.

## 2.1 Hiring Request → Vacancy Conversion (audit finding, fixed)

The "Hiring Request → HR Approval → Public Vacancy Flow" audit found a real
gap here: `VacancyService.create()` previously only checked that a supplied
`hiringRequestId` **existed** — never that it had actually been **approved**.
A `Vacancy` could be created from a `DRAFT`, `SUBMITTED`, `REJECTED`, or
`CANCELLED` hiring request, silently collapsing "our department needs
someone" into "HR has approved this opportunity" without HR ever approving
anything. Fixed: `create()` now throws a `BadRequestException` (`Hiring
request must be APPROVED to create a vacancy from it (currently {status})`)
whenever a supplied `hiringRequestId` does not resolve to an `APPROVED`
request. Live-verified: attempting to create a vacancy from a fresh `DRAFT`
request, and separately from a `REJECTED` one, both correctly `400`. An
administrative vacancy with no `hiringRequestId` at all remains a legitimate,
unaffected path (§3).

**Requester vs Approver authorization** — also audited and confirmed correctly
enforced, not just by convention: `hr.recruitment.hiring_request.manage`
(create/submit/cancel) and `hr.recruitment.hiring_request.approve`
(approve/reject) are two separate, independently-grantable permissions in the
existing catalogue (never a hardcoded department check). The audit's actual
gap was that no seeded role held `.manage` except Administrator — the
permission was real and correctly enforced, but nothing in the seed ever
demonstrated a genuine non-HR requester. Fixed in the seed only (no code
change): `Head of Finance` — an existing, real department role, already
assigned to the existing Finance Officer demo user (Emeka Nwachukwu) — now
also holds `hr.recruitment.hiring_request.manage`,
`hr.recruitment.hiring_request.view` (to track their own submissions), and
`hr.organisation_structure.view` (a genuine prerequisite: the create-request
form's department/position dropdowns 403 without it — found live). Deliberately
NOT `.approve` or `hr.recruitment.vacancy.manage` — a department requester can
raise and track a request, never approve their own or anyone else's, and
never create/publish the resulting vacancy. Live-verified: Emeka can create
and submit a hiring request; attempting to approve his own request returns a
clean `403`; attempting to publish the eventual vacancy also returns `403`.

This seed fix lives in its own small, unconditionally-idempotent
`seedDepartmentRequesterFixtures()` function (`prisma/seed.ts`), deliberately
NOT inside the existing `seedAccessControlFixtures()`/`seedRecruitmentFixtures()`
functions — both of those use an "if this role/definition already exists,
skip the entire function" guard, which means a database that had already
passed Sprint 25/30 once (true of every environment this fix ships to)
would silently never receive a grant added inside them afterwards. The new
function has no such guard — `grantRolePermissions`/`assignRoleIfMissing` are
both already safe to call on every run — so it correctly backfills an
already-seeded database as well as seeding a brand-new one identically.

**A genuine, observed (not fixed) nuance**: routing a Hiring Request through
the real Workflow engine records `WorkflowInstance.requestedById` as whoever
clicks "Route via Workflow" — not necessarily the original requester on the
underlying `HiringRequest`. If HR (Administrator) routes someone else's
already-submitted request into Workflow themselves, and Administrator is also
the step's only assigned approver, `allowSelfApproval: false` correctly
finds zero eligible approvers (Administrator would be approving their own
workflow submission) and the instance produces no notification and can never
be approved through it — observed live during this audit. This is the
self-approval guard working exactly as designed, not a defect; the direct
`hiring_request.approve` action, or routing via Workflow as the actual
original requester, both remain fully available and correctly enforced.

## 3. Vacancy

A specific recruitment opportunity (`Vacancy`) — distinct from `Position` (the
reusable organisational job title; a Position may have many Vacancies over
time). Not every Vacancy needs a `HiringRequest` (`hiringRequestId` nullable —
an administrative vacancy is a legitimate use case) — but when one IS
supplied, it must be `APPROVED` (§2.1). Fields: `title`,
`positionId`, `departmentId?`, `numberOfOpenings`, `employmentType` (reuses
HR's existing enum — no duplicate), `workArrangement`
(`ON_SITE`/`REMOTE`/`HYBRID`), `location?`, `salaryMin?`/`salaryMax?`,
`description`/`responsibilities`/`requirements`/`qualifications`/
`experienceRequirements?`, `applicationDeadline?`, `status`
(`DRAFT`/`PUBLISHED`/`PAUSED`/`CLOSED`/`CANCELLED`), `publicSlug`
(`@@unique([organisationId, publicSlug])` — the ONLY identifier ever exposed
publicly).

A `Vacancy` owns its own ordered `InterviewStage`s directly — a deliberate
consolidation versus the brief's own suggested standalone "RecruitmentProcess"
model: no evidence a stage template needs reuse _across_ vacancies for this
MVP, and every worked example in the brief ties a configured process to one
specific vacancy anyway.

### 3.1 Configurable Application Form

`VacancyQuestion` — a genuinely small question engine (`TEXT`/`YES_NO`/
`NUMBER`/`FILE`, `required`, `sortOrder`), never a general-purpose form
builder. `ApplicationAnswer` stores exactly one populated `answer*` column per
question, matching `VacancyQuestion.type` (validated at the service layer —
never a Prisma-level constraint, the same "business rule, not a type
constraint" precedent `Department.departmentHeadEmployeeId` already
establishes in this schema).

## 4. Public Careers Page

`CareersController` (`apps/api/src/hr/recruitment/public/`) — genuinely
public, **no `@UseGuards` decorator at all**, matching `AuthController.
register`'s exact precedent (this codebase has no global `@Public()`
mechanism; a controller/route with no guard decorator IS the public-route
convention). Routes:

```text
GET  /careers/:organisationSlug                        org info + published, non-expired vacancies
GET  /careers/:organisationSlug/:vacancySlug            vacancy detail + its question list
POST /careers/:organisationSlug/:vacancySlug/apply      candidate + answers + optional resume
```

Organisation resolution reuses the ALREADY-EXISTING
`OrganisationService.getBySlug()` (previously used only by `register`),
additionally checked `organisation.status === 'ACTIVE'`. Only `PUBLISHED`
vacancies whose `applicationDeadline` has not passed are ever returned —
enforced server-side in `VacancyRepository.findPublicList`/
`findPublicBySlug`, never a frontend-only filter (Sprint 30.1 added
`vacancy.repository.spec.ts` — the one gap in the original test suite, since
every other recruitment test mocks `VacancyRepository` itself and never
exercised this actual `WHERE` clause — to prove it directly against
PUBLISHED/DRAFT/PAUSED/CLOSED/CANCELLED/expired fixtures, plus cross-tenant
isolation). Response DTOs are hand-built allowlists (`CareersService`'s own
`PublicVacancySummary`/`PublicVacancyDetail` interfaces) — never a raw Prisma
object — explicitly excluding interviewer identity, internal notes, scores,
application status, unpublished salary, and any other internal HR data. A
cross-tenant or nonexistent org/vacancy slug both 404 identically —
live-verified, no existence leak. `getOrganisationCareersInfo` additionally
returns `industry`/`city`/`country`/`description` (all pre-existing,
previously-unused `Organisation` columns) for the landing page's hero copy —
still an explicit allowlist, still never `businessEmail`/`phone`/address
lines.

The apply endpoint's success response is minimal (`{ success: true,
submittedAt }`) — no candidate/application id returned, since there is
deliberately no candidate portal/account this sprint.

### 4.0 Tenant-Aware Public Template (Sprint 30.1)

Sprint 30 shipped a functionally-complete but visually minimal public
surface. Sprint 30.1's audit found the backend (tenant resolution, visibility
rules, security, dedup) already correct and left it untouched; the entire
Sprint 30.1 change is a frontend redesign into a genuine tenant-agnostic
careers template:

- **Server Components, not client `useQuery`.** All three public routes
  (`apps/web/src/app/careers/[organisationSlug]/{page.tsx,
[vacancySlug]/page.tsx, [vacancySlug]/apply/page.tsx}`) are now `async`
  Server Components that fetch via the same `apiFetch`-based functions the
  old client pages used (`apiFetch` already degrades gracefully with no
  `window` — no separate server-fetch helper needed). This gives every page a
  real per-tenant/per-vacancy `generateMetadata()` (`"{Organisation} Careers"`,
  `"{Vacancy} — {Organisation}"`, `"Apply — {Vacancy} — {Organisation}"`) —
  impossible from a `'use client'` page — and a genuine HTTP `404` via
  `notFound()` for an unknown/inactive org or an unpublished/closed/
  cancelled/expired vacancy, rendered by one shared
  `apps/web/src/app/careers/[organisationSlug]/not-found.tsx` (covers the
  nested vacancy/apply routes too) and one `error.tsx` for genuine failures.
  `export const dynamic = 'force-dynamic'` on all three routes so a vacancy
  HR just published/paused/closed is reflected immediately, never served
  from Next's route cache.
- **Shared, tenant-agnostic components**
  (`apps/web/src/components/app/careers/`): `PublicCareersLayout` (the one
  shell every public page renders inside), `CareersHero` (org branding —
  logo or the existing `orgInitialsFor` initials-avatar fallback, name,
  industry/location, description), `VacancyCard`/`VacancyList` (the landing
  page's open-positions list, with the brief's own "No Open Positions" empty
  state), `VacancyDetails` (the full detail page), `ApplicationForm`/
  `ApplicationSuccess` (the apply flow). None hardcodes an organisation or
  vacancy — every field comes from the props/fetch, so the identical template
  serves every tenant.
- **Reuses `@zentuva/ui`** (`Button`, `Card`, `Input`, `Label`, `Select`,
  `Textarea`, `Badge`) instead of Sprint 30's raw HTML form elements — no new
  UI framework, matching brief §18.
- **A defect found and fixed via live browser verification**: `loading.tsx`
  Suspense boundaries on the org/vacancy segments caused Next.js to start
  streaming a `200` response before the async Server Component's `notFound()`
  could run — the not-found UI still rendered correctly, but the actual HTTP
  status stayed `200` instead of `404` (confirmed via `curl -o /dev/null -w
'%{http_code}'` before and after). Removed both `loading.tsx` files — the
  local fetch is fast enough that the loading state was rarely visible
  anyway, and a public page's HTTP status correctness (crawlers, uptime
  checks, link validators) matters more than a skeleton screen. Re-verified:
  both an unknown org slug and an unpublished vacancy now return a genuine
  `404`.

### 4.1 Public Application Security — new, scoped infrastructure

Two additions, both confirmed absent from this codebase before this sprint,
both scoped narrowly to this one endpoint:

- **`@nestjs/throttler`**, applied via `@Throttle({ default: { limit: 5, ttl:
60_000 } })` directly on `CareersController.apply` — deliberately NEVER
  registered via the global `APP_GUARD` token (an early draft did this and
  would have throttled every authenticated route in the entire application to
  5 requests/minute; caught and fixed before shipping). Live-verified: the 6th
  rapid request from one IP within 60 seconds received `429`.
- **`assertValidResumeFile()`** (`identity/common/resume-upload-validation.ts`,
  mirrors the existing `assertValidImageFile()`) — allowlists `application/
pdf`/`.doc`/`.docx`, capped at `UPLOAD_MAX_RESUME_FILE_SIZE_BYTES` (default
  5MB). `LocalFileStorage`'s `EXTENSION_BY_MIME_TYPE` map gained those three
  mimetypes (previously image-only). Filenames are already server-generated
  (`randomUUID()`) — "safe filename handling" was already satisfied by the
  existing `FileStorage` abstraction, no work needed there.

Duplicate submission is DB-constraint-backed
(`@@unique([organisationId, vacancyId, candidateId])` on `Application`) —
live-verified: a second application from the same email to the same vacancy
returned `400` with a clear message, no duplicate row created. Required-
question validation is server-side and authoritative — live-verified: an
application missing a required answer was rejected before any `Candidate`/
`Application` row was created.

## 5. Candidate vs Application

`Candidate` (the person — `firstName`/`lastName`/`email`/`phone?`/`location?`,
`@@unique([organisationId, email])`) is deliberately separate from
`Application` (one candidate's application to one specific `Vacancy`,
`resumeUrl`/`resumeKey`/`coverLetterText` live here, per-application, not on
`Candidate`). A practical email-based duplicate check only — no cross-tenant
identity matching, no fuzzy matching, per the brief's own "do not
over-engineer candidate identity matching" instruction.

`Application.status` (`SUBMITTED`/`SCREENING`/`SHORTLISTED`/`INTERVIEWING`/
`SELECTED`/`REJECTED`/`WITHDRAWN`) is deliberately COARSE — it is never
responsible for individual interview-stage state; see §7 for how per-stage
progress is actually tracked.

## 6. HR Screening

`ApplicationService.screen()`/`.shortlist()`/`.reject()`
(`hr.recruitment.application.screen`) — internal `screeningNotes` are stored
on `Application` but NEVER returned on any public/candidate-facing response
(recruitment.md §"Candidate Privacy"). A shortlisted candidate becomes
eligible for the vacancy's configured interview stages; nothing here creates
an `Interview` automatically.

## 7. Configurable Interview Process

**The core requirement of this sprint.** `InterviewStage` (config, belongs to
one `Vacancy`) — `name`, `description?`, `sequence` (explicit order,
`@@unique([vacancyId, sequence])`, never inferred from creation order),
`isRequired`, `evaluationRequired`. `InterviewStageParticipant` is the
DEFAULT panel for that stage — real `User` identity
(`@@unique([interviewStageId, userId])`), validated against
`UserService.getById` at configuration time — **never a free-text role** like
"Head of Finance."

### 7.1 Interview scheduling — definition/instance snapshot split

`Interview` is the SCHEDULED, per-candidate instance of a stage
(`applicationId` + `interviewStageId`, `@@unique([applicationId,
interviewStageId])` — one interview per candidate per stage, also the
concurrency/duplicate-schedule guard). `InterviewParticipant` is the
SNAPSHOTTED panel for that one scheduled interview — copied from
`InterviewStageParticipant` at schedule time (HR may still adjust the copy).
This is deliberately the exact `WorkflowStep`/`WorkflowStepInstance`
definition/instance split this codebase already established (Sprint 26): a
later edit to a stage's default panel never retroactively alters who was
actually invited to evaluate an already-scheduled candidate — the historical
record stays accurate.

**Interviewer Authorization — the key rule**: `InterviewParticipant` is the
SOLE authorization source for "may this user evaluate this interview." A
direct row lookup (`InterviewRepository.isParticipant`) inside
`InterviewEvaluationService`, gating both viewing and submitting — never
inferred from the coarse `hr.recruitment.interview.evaluate` permission alone,
never trusted to the frontend. Live-verified: a user holding no
`hr.recruitment.*` permission at all, and separately a user WITH the
`interview.evaluate` permission but not assigned to this specific interview,
both received `403` on both the view and the evaluate routes.

Interview scheduling triggers exactly ONE notification event (§9) and marks
the `Application` `INTERVIEWING` (if it was `SHORTLISTED`). A stage is never
marked `COMPLETED` merely because its `scheduledAt` time passed — only an
explicit HR stage decision (§8) transitions it.

## 8. Individual Evaluations, Scoring, and Stage Decisions

`InterviewEvaluation` — one row per (interview, evaluator),
`@@unique([interviewId, evaluatorUserId])` (the "each interviewer submits
independently, exactly once" DB guard). Fixed 1–5 `score`, one shared
`InterviewRecommendation` enum (`PROCEED`/`HOLD`/`REJECT`/`RECOMMEND_HIRE`/
`RECOMMEND_REJECT` — the SAME enum serves both intermediate and final stages,
per the brief's own "prefer the simpler architecture" hint; the frontend shows
only the relevant subset per stage), optional `comments`. **Immutable once
inserted** — no update route exists for `score`/`recommendation`/`comments`;
`reopenedAt`/`reopenedByUserId` plus an explicit, audited `POST
/hr-interviews/evaluations/:id/reopen` action (`hr.recruitment.interview.
decide`) is the only sanctioned correction path, and it deliberately does
**not** unlock further editing this sprint — "Do not implement unrestricted
editing" is read as the stronger, safer instruction, since the brief's own
corrections path is explicitly optional.

**Independence**: the self-scoped `GET /hr-interviews/:id` response
(`InterviewEvaluationController`) NEVER includes other participants'
evaluations — only the caller's own (`ownEvaluation: null` until they submit).
Live-verified across a real 3-person panel: after the first evaluator
submitted, a second evaluator's view still showed `ownEvaluation: null` with
no trace of the first evaluator's score anywhere in the response.

**Found and fixed via an actual browser session** (sprint-30-completion-report.md
§9 item 15): opening `/hr-interviews/:id` for real, at 375px, as a genuine
assigned interviewer, crashed the page — `getOne()` was calling
`InterviewService.getById()`, which doesn't join `application.candidate`/
`application.vacancy`. Switching it to `getByIdWithRelations()` fixed the
crash but exposed that method's `evaluations`/`decisions` includes are
unfiltered — every evaluator's score and every stage decision were present
in the raw JSON response, never rendered by the frontend but visible to a
network-tab inspection, defeating the independence guarantee described above.
`getOne()` now returns only the specific fields the mobile view needs,
omitting `evaluations`/`decisions` entirely.

**Stage Summary** (`InterviewStageDecisionService.summarize`) — computed on
EVERY READ, never persisted, never auto-applied: `evaluatorsAssigned`,
`evaluationsCompleted`, `averageScore` (rounded to 1 decimal), and a
recommendation-count breakdown. This is evidence presented to HR, never a
decision the system makes itself (§"No Automatic Hiring Decision" below).

**HR Stage Decision** (`InterviewStageDecision`, `ADVANCE`/`HOLD`/`REJECT`) —
the authoritative decision, append-only (mirrors `WorkflowDecision`'s own
immutable-log convention). The CONCURRENCY guarantee comes from a conditional
`Interview.status` transition (`SCHEDULED → COMPLETED`) performed in the SAME
database transaction as the decision insert (`InterviewStageDecisionRepository.
record`) — only the request that wins that conditional claim may insert a
decision row at all. Live-verified: 5 concurrent decision requests against one
interview produced exactly ONE `201` and four `400`s ("already decided"), and
exactly one `InterviewStageDecision` row existed afterward.

`ADVANCE` on a vacancy's LAST configured stage sets `Application.status =
SELECTED` (ready for HR's Offer decision — issuing/withholding an Offer IS the
"final hiring decision," no separate model exists for it, per the brief's own
"you may simplify" allowance). `ADVANCE` on a non-last stage leaves
`Application.status` at `INTERVIEWING` — HR must explicitly schedule the next
stage separately (brief: "do not automatically schedule the next stage merely
because all evaluations were submitted"). `REJECT` always sets `REJECTED`.
`HOLD` never changes `Application.status`. Live-verified end-to-end across a
real 2-stage Cashier process (Finance Interview → Management Interview), plus
a separate rejected-at-screening path.

## 9. Notification Integration

**No second notification system.** `Candidate`/`Application`/`Interview` are
never `WorkflowEvent`-sourced, so `RecruitmentNotificationService`
(`recruitment-notification.service.ts`) creates `Notification` rows DIRECTLY
against the shared `notifications` table — reusing the exact
`createMany({ skipDuplicates: true })` idiom `NotificationRepository` itself
uses. It injects `PrismaService` directly (globally registered, `@Global()`)
rather than importing `NotificationsModule`, which would create a circular
module dependency (`NotificationsModule` imports `WorkflowModule`, and
`WorkflowModule` now imports `RecruitmentModule` for the Hiring Request
handler — importing `NotificationsModule` from `RecruitmentModule` too would
close the loop).

Two new `NotificationType` values, `INTERVIEW_SCHEDULED` and
`INTERVIEW_EVALUATION_REQUIRED` (the brief's own explicit "at minimum" pair),
under a new `NotificationCategory.RECRUITMENT_INTERVIEWS`. Both fire
TOGETHER, once, inside the same call that creates the `Interview` +
`InterviewParticipant` rows — naturally idempotent, since that call only ever
succeeds once (the `Interview`'s own `@@unique([applicationId,
interviewStageId])`). A genuinely DELAYED post-interview evaluation reminder
is explicitly deferred — no background scheduler exists anywhere in this
codebase to drive one (an established, repeatedly-documented architectural
constraint, not a new shortcut this sprint introduces).

**One small, additive schema change** to the _existing_ `Notification` model:
a second, PARTIAL unique index, scoped to `WHERE "sourceType" = 'INTERVIEW'`
only:

```sql
CREATE UNIQUE INDEX "hr_recruitment_notifications_source_recipient_channel_key"
  ON "notifications" ("organisationId", "sourceType", "sourceId", "type", "recipientUserId", "channel")
  WHERE "sourceType" = 'INTERVIEW';
```

The existing `sourceEventId`-keyed constraint gives no duplicate protection
for a non-Workflow-sourced row (`sourceEventId` is null there, and Postgres
treats every NULL as distinct). A first attempt at this index was UNSCOPED
(no `WHERE` clause) and failed against real live data with a genuine
constraint violation: the same `WORKFLOW_APPROVAL_REQUIRED` type legitimately
recurs for the same subject/recipient/channel across a Purchase Order's
lifetime (step 1's approval-required, then later step 2's, for the same PO
and the same approver) — an unscoped index would have been WRONG for
Workflow's own existing rows, not just redundant. Scoping it to `sourceType =
'INTERVIEW'` gives Recruitment's own notifications the same DB-backed
idempotency Workflow's rows already have, without touching Workflow's
semantics at all.

`EMAIL_ELIGIBLE_TYPES` (`email-eligibility.service.ts`) gained both new
types — a one-line addition; `EmailTemplateRenderer` needed zero changes
since it already reuses `Notification.title`/`body`/`actionUrl` generically.
`whatsapp-template.ts`'s registry gained ONE new template resolution,
`INTERVIEW_SCHEDULED` → `zentuva_interview_scheduled` (same "unverified
against a real account" caveat Sprint 29 already documented for its own
template — `documentNumber` falls back to `describeSubject`'s generic `#<last
8 chars>` since no `WorkflowSubjectHandler` is registered for `INTERVIEW`, a
known, accepted limitation rather than coupling this shared Workflow utility
to Recruitment-specific data). `INTERVIEW_EVALUATION_REQUIRED` remains
WhatsApp-ineligible this sprint (email + in-app only) — a deliberate scope
cut.

**No changes whatsoever** to `EmailDeliveryCreationService`/
`WhatsAppDeliveryCreationService`/their processors — they already scan
`Notification` generically, by type, regardless of source. Live-verified
end-to-end: scheduling a real interview created 2 `Notification` rows (one
per participant) × 2 types = 4 rows with correct titles/recipients; after
enabling one recipient's `RECRUITMENT_INTERVIEWS` email preference, the
EXISTING `process-events` sweep created and `SENT` 2 real `EmailDelivery` rows
for that recipient with zero code changes to the email pipeline.

## 10. Offer

An MVP offer (`Offer`) — no payroll/compensation system, no digital
signatures. `proposedSalary?`, `employmentType` (reused enum),
`proposedStartDate?`, `offerDate`, `expiryDate?`, `status`
(`DRAFT`/`ISSUED`/`ACCEPTED`/`DECLINED`/`EXPIRED`/`WITHDRAWN`), `notes?`.

A migration-level PARTIAL unique index enforces at most one non-terminal
(`DRAFT`/`ISSUED`) offer per `Application` at a time — live-verified: a second
offer-creation attempt while one was already active returned `400`.

## 11. Candidate → Employee → Onboarding

**Chosen transition point** (documented explicitly, per the brief's own
requirement to pick and document exactly one model): **the `Employee` is
created at the moment HR records an offer as ACCEPTED**, inside
`OfferService.accept()`.

**Concurrency-safe by construction — a real bug avoided during
implementation.** An early draft created the `Employee` FIRST, then tried to
atomically claim the offer — under a genuine race, this would have let TWO
concurrent `accept()` calls both pass the initial status check and both
create an `Employee`, with only one winning the final claim (leaving an
ORPHAN `Employee` row from the loser). Caught and fixed before this was ever
live-tested: `accept()` now calls `OfferRepository.claimAcceptance()`
FIRST — a conditional `ISSUED → ACCEPTED` `updateMany` — and only the request
that actually WINS that claim goes on to create an `Employee` at all. A
losing concurrent request's `updateMany` affects 0 rows and it stops
immediately, before touching `EmployeeService` at all. Live-verified: 5
concurrent accept requests against one issued offer produced exactly ONE
`201` (with a genuinely created `Employee`) and four `400`s, and exactly one
`Employee` row existed in the database afterward.

The winning request then:

1. Maps `Candidate.firstName/lastName/email/phone` → `EmployeeService.
create()`'s existing input shape (`personalEmail`, `phoneNumber`,
   `departmentId`/`positionId` from the `Vacancy`, `employmentType`/
   `hireDate` from the `Offer`) — **reusing `EmployeeService.create()`
   completely unchanged**; the new `Employee` starts `employmentStatus: DRAFT`
   exactly like every other employee-creation path already does.
2. Confirms the conversion (`OfferRepository.confirmConversion`, setting
   `Offer.convertedEmployeeId`).
3. Immediately calls `EmployeeOnboardingService.start(organisationId,
employee.id)` — **reusing it completely unchanged** — which flips the
   employee to `ONBOARDING` and generates the EXISTING default 7-task
   checklist. No new onboarding model, no new task template.
4. Sets `Application.status = SELECTED` → stays as the historical record;
   `Offer.status = ACCEPTED` is the terminal record of the hire.

**No `User` account is auto-created** (brief §31) — `Employee.userId` stays
`null`; provisioning a login remains the existing separate administrative
step (`EmployeeController`'s existing `linkUser`/invite flow). Live-verified:
the converted `Employee` row had `userId: null` and `employmentStatus:
ONBOARDING`, with a real `EmployeeOnboarding` row (`status: IN_PROGRESS`, 7
tasks) created for it.

## 12. Access Control

New `hr.recruitment.*` permission family (catalogue 138 → 149 entries),
following the exact `entry(key, scopeType, description)` convention:

| Permission                              | Scope    | Purpose                                                              |
| --------------------------------------- | -------- | -------------------------------------------------------------------- |
| `hr.recruitment.hiring_request.view`    | SCOPABLE | View hiring requests                                                 |
| `hr.recruitment.hiring_request.manage`  | NONE     | Create/submit/cancel a hiring request                                |
| `hr.recruitment.hiring_request.approve` | NONE     | Approve/reject directly, or as a Workflow step's required permission |
| `hr.recruitment.vacancy.view`           | SCOPABLE | View vacancies                                                       |
| `hr.recruitment.vacancy.manage`         | NONE     | Create/edit/publish/pause/close a vacancy + configure stages/panels  |
| `hr.recruitment.application.view`       | SCOPABLE | View candidate applications                                          |
| `hr.recruitment.application.screen`     | NONE     | Screen/shortlist/reject                                              |
| `hr.recruitment.interview.manage`       | NONE     | Schedule an interview                                                |
| `hr.recruitment.interview.evaluate`     | NONE     | Coarse "may act as a panelist" gate — never sufficient alone (§7.1)  |
| `hr.recruitment.interview.decide`       | NONE     | Stage decisions, final hiring decision, evaluation reopen            |
| `hr.recruitment.offer.manage`           | NONE     | Issue/accept/decline/withdraw + conversion                           |

All auto-granted to Administrator through the existing catalogue-seed loop —
zero manual seed code. `interview.evaluate` is deliberately broad (any
employee an org grants it to can be a panelist); the real per-interview
authorization is always the `InterviewParticipant` row check (§7.1).

**Self-scoped exception**: `InterviewEvaluationController`
(`/hr-interviews/*`) uses `JwtAuthGuard` alone — the same "my own data"
precedent `AccountController` established — since a panelist may hold NONE of
the `hr.recruitment.*` permissions. Only its `reopen` route is HR-gated
(`hr.recruitment.interview.decide`).

**Requester vs. approver, live-demonstrated** (§2.1 audit): `.manage` and
`.approve` are independent grants by design — an organisation can hand
`.manage` to any department role (e.g. `Head of Finance`, per the seed) so its
own staff can raise a hiring request, while keeping `.approve` (and
`vacancy.manage`, the ability to create/publish the resulting vacancy)
restricted to HR/Administrator. Never a hardcoded department name or a new
authorization mechanism — purely existing configurable role/permission
grants, seeded once as a demonstration and reusable by any organisation.

## 13. Security & Tenant Isolation

Every repository method scopes by `organisationId` in its `WHERE` clause —
the same convention every other domain in this codebase already follows.
Live-verified against a genuinely separate organisation: `GET` list endpoints
for vacancies/applications/hiring-requests/offers all returned empty; direct
`GET` by a real cross-tenant id (vacancy, application, interview, and the
self-scoped `/hr-interviews/:id`) all returned `404` with no existence leak;
an evaluation-submission attempt against a real cross-tenant interview id
also `404`'d before ever reaching the participant check.

**Suspended-user exclusion — a real gap found and fixed live this sprint.**
`JwtAuthGuard` is pure authentication and does NOT re-verify live `User.
status` (an already-issued JWT stays cryptographically valid after
suspension — confirmed by this codebase's own Identity architecture).
`InterviewEvaluationService.submit()` initially checked ONLY the
`InterviewParticipant` row, not live account status. Caught during this
sprint's own live verification: a suspended interviewer's still-valid,
pre-suspension JWT successfully reached the evaluation-submission code path.
Fixed by adding an explicit `UserService.getById(...).status === 'ACTIVE'`
check — the same pattern `WhatsAppEligibilityService`/`EmailEligibilityService`
already use for their own recipient checks — before accepting a submission.
Re-verified live: the identical still-valid token, replayed after the fix,
correctly received `403` ("Your account is not active and cannot submit a new
evaluation").

Candidate data is treated as private HR information throughout — screening
notes, individual evaluations, and interview configuration are never exposed
to an ordinary organisation user merely because they belong to the
organisation; access is controlled entirely through the permissions in §12,
no new authorization framework.

## 14. Audit

`RECRUITMENT_AUDIT_ACTIONS` (`recruitment-audit-actions.ts`) — the exact
`HR_AUDIT_ACTIONS` `<entity>.<event>` convention, recorded via the EXISTING
`AuditService.record()` against the SAME `AuditLog` table, from each
controller after its service call succeeds: hiring request created/submitted/
approved/rejected/cancelled; vacancy created/updated/published/paused/closed/
cancelled; application screened/shortlisted/rejected; interview stage
configured/participant assigned; interview scheduled; evaluation submitted/
reopened; stage decision recorded; offer created/issued/accepted/declined/
withdrawn; candidate converted to employee.

## 15. Frontend

Internal (`apps/web/src/app/(app)/settings/hr/recruitment/`) — a new
"Recruitment" tab on the existing `HrTabs` navigation: dashboard (client-
composed from the existing list endpoints, deliberately not a dedicated
reporting endpoint), hiring requests, vacancies (list + detail with stage/
panel configuration), applications (list + detail with screening, per-stage
scheduling, aggregate summaries, decisions, and offer management), offers.
Follows the HR domain's own established conventions exactly — TanStack Query,
`apiFetch`, `@zentuva/ui` components, a `labels.ts` per new enum set, no new
frontend architecture.

A separate, SELF-SCOPED surface — `apps/web/src/app/(app)/hr-interviews/` —
is the interviewer's own "my evaluations" page, reachable by ANY authenticated
user (not just HR staff). Built mobile-first (large tap targets, a `touch`
button size, a simple numbered 1–5 score picker) and verified at 375px — this
is the page a notification's `actionUrl` points to.

Public (`apps/web/src/app/careers/`, outside the authenticated route group,
matching how `/login`/`/register` already sit outside it):
`[organisationSlug]/`, `[organisationSlug]/[vacancySlug]/`,
`[organisationSlug]/[vacancySlug]/apply/` — unauthenticated Server Component
pages rendering the shared tenant-agnostic template described in §4.0
(Sprint 30.1). No dependency anywhere on a Zentuva login, HR account, or
`PermissionsGuard` — a public candidate is an external actor, never a role in
the existing Access Control system.

## 16. Testing

The "Hiring Request → HR Approval → Public Vacancy Flow" audit added 2 more
suites / 26 tests: `hiring-request.repository.spec.ts` (20 — the actual
conditional `updateMany` each lifecycle transition builds, proving
DRAFT→SUBMITTED→APPROVED/REJECTED only moves in the allowed directions, that
an already-REJECTED request can never be re-approved, and full tenant
isolation) and 6 new `VacancyService.create()` tests in
`vacancy.service.spec.ts` (§2.1's fix — DRAFT/SUBMITTED/REJECTED/CANCELLED
hiring requests all correctly rejected, an APPROVED one succeeds, and an
administrative vacancy with no hiring request at all is unaffected).

Sprint 30.1 added 2 suites / 30 tests: `vacancy.repository.spec.ts` (14 —
the actual `WHERE` clause for PUBLISHED/DRAFT/PAUSED/CLOSED/CANCELLED/
expired/cross-tenant, described in §4) and 2 new `CareersService` tests for
`getOrganisationCareersInfo` (tenant-not-found, and the branding allowlist
never leaking `businessEmail`/`phone`/address). `apps/web` has no test
runner/config at all (no Jest/RTL, no test script in `package.json`) — this
was true before Sprint 30.1 too — so the frontend redesign's correctness was
established through the live browser verification in
`docs/sprint-30.1-completion-report.md` instead, per brief §22's own
"where the existing frontend test architecture supports it" scoping.

Sprint 30's own suite (unchanged, still passing): 13 new suites, 88 new
tests, covering hiring-request
lifecycle/authorization, vacancy lifecycle/public-visibility rules, public
application validation/duplicate-prevention/tenant-isolation, screening,
interview-stage configuration/ordering/participant-validation, scheduling +
notification creation, evaluation (assigned-vs-unassigned, duplicate-
prevention, immutability, independence, suspended-interviewer rejection),
the self-scoped `InterviewEvaluationController.getOne()` composition (4
tests, added after the browser-verification finding above — asserts it
fetches WITH relations and never forwards other evaluators' `evaluations`/
`decisions`), stage-summary aggregation, stage decisions
(advance/hold/reject/concurrency), offers (create/issue/accept/decline/
expiry/duplicate-protection), employee conversion, notification integration
(recipient correctness, no direct provider coupling), and a structural
`recruitment-independence.spec.ts` guard.

## 17. Deferred Scope

Job board/LinkedIn/Indeed integrations, recruitment agencies, AI/ML anything
(CV ranking, scoring, automated rejection), psychometric tests, background/
reference checks, automated CV parsing, complex scoring matrices, video
interviewing, digital signatures, payroll/benefits/performance/leave,
advanced recruitment analytics, a candidate portal/account, a chatbot, bulk
recruitment marketing, SMS campaigns, a delayed (post-interview-time)
evaluation reminder (no scheduler exists in this codebase), and WhatsApp
delivery for `INTERVIEW_EVALUATION_REQUIRED` specifically.

**No automatic hiring decision, anywhere** — `InterviewStageDecisionService.
summarize()` computes evidence (average score, recommendation counts,
completion) on every read; nothing in this codebase ever derives or applies a
stage/hiring decision from that evidence automatically. Every transition —
`ADVANCE`/`HOLD`/`REJECT`, `SELECTED`, offer issuance/acceptance — is an
explicit, authenticated HR (or, for acceptance, candidate-communicated-then-
HR-recorded) action.
