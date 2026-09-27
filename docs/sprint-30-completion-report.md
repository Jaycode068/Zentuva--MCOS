# Sprint 30 Completion Report — Recruitment & Candidate Interview Management Foundation

## 1. Executive Summary

Closes the one gap left in Zentuva's HR lifecycle: how a person _becomes_ an
`Employee`. Built a complete recruitment pipeline — hiring request (optionally
routed through the existing Workflow engine for approval), vacancy, a public
unauthenticated careers page, candidate application, HR screening, a
genuinely CONFIGURABLE multi-stage interview process with real
Employee/User-identity panelists, independent 1–5 evaluations, HR-controlled
stage and final hiring decisions, an MVP offer, and a documented,
concurrency-safe hand-off into the EXISTING `Employee`/`EmployeeOnboarding`
architecture. Reuses the existing Workflow engine (hiring-request approval
only — Candidate/Application/Interview are never `WorkflowInstance`s), the
existing Notification/Email/WhatsApp pipeline (interview notifications,
zero changes to the delivery services themselves), and the existing
Employee/Onboarding models — never a second approval engine, notification
system, or employee/onboarding system.

Four real issues were found and fixed DURING this sprint's own implementation
and live verification, not discovered later: (1) an early offer-acceptance
design would have let a genuine race create two `Employee` rows for one
accepted offer — restructured into a claim-then-create sequence before it was
ever tested; (2) a suspended interviewer's still-cryptographically-valid,
pre-suspension JWT was found live to successfully reach the evaluation-
submission code path — an explicit live-status re-check was added and
re-verified; (3) opening the real mobile interviewer page in an actual
browser session (not just API calls) crashed it — the self-scoped endpoint
was fetching the interview without its candidate/vacancy relations; (4) fixing
(3) surfaced that the same endpoint's underlying query also carried every
other evaluator's raw scores and every stage decision into the JSON response
body, which the current frontend never rendered but a network-tab inspection
would still have exposed — the controller now returns only the fields the
self-scoped view needs. All four are detailed in §7, §9, and §12.

## 2. Architecture

```text
Hiring Request
      ↓
      ├── optionally → WorkflowInstance (subjectType 'HIRING_REQUEST',
      │                 the EXISTING generic /workflows/instances endpoints)
      ↓
Vacancy (owns its own InterviewStage config directly)
      ↓
Public Careers Page (no account required)
      ↓
Application (+ ApplicationAnswer against VacancyQuestion)
      ↓
Screening (SUBMITTED → SCREENING → SHORTLISTED / REJECTED)
      ↓
Interview Stage 1 → Interview (per application) → InterviewParticipant (snapshot)
      ↓
Individual Evaluations (one per participant, immutable, independent)
      ↓
HR Stage Decision (ADVANCE / HOLD / REJECT — authoritative, never inferred)
      ↓
Interview Stage 2 → … (HR explicitly advances — never automatic)
      ↓
Application → SELECTED (once the LAST configured stage is advanced)
      ↓
Offer (DRAFT → ISSUED → ACCEPTED)
      ↓
Employee (existing model, DRAFT → ONBOARDING)
      ↓
Existing Onboarding (EmployeeOnboardingService.start(), unchanged)
```

Full rationale: [docs/domains/recruitment.md](domains/recruitment.md).

- **Workflow independence**: `WorkflowInstanceService`/`WorkflowEligibilityService`
  have ZERO changes this sprint. `HiringRequestWorkflowHandler`
  (`workflow/handlers/`) is the one integration point, injecting only the
  exported `HiringRequestRepository` — the exact `PurchaseOrderWorkflowHandler`
  recipe (Sprint 26). `WorkflowModule` gained one import (`RecruitmentModule`)
  and one array entry in its `WORKFLOW_SUBJECT_HANDLERS` factory.
- **No circular module dependency**: `NotificationsModule` imports
  `WorkflowModule`; `WorkflowModule` now imports `RecruitmentModule` for the
  handler. `RecruitmentModule` therefore deliberately does NOT import
  `NotificationsModule` (which would close the loop) — its own
  `RecruitmentNotificationService` writes directly to the shared
  `notifications` table via the globally-registered `PrismaService` instead.
- **Tenant isolation**: every repository method scopes by `organisationId` —
  live-verified across every recruitment surface (§10).
- **Existing authorization reused**: zero new authorization primitives. 11
  new permission-catalogue entries (`hr.recruitment.*`), auto-granted to
  Administrator through the existing catalogue-seed loop.

## 3. Data Model

13 new models, all `organisationId`-scoped, mapped to `hr_recruitment_*`
tables: `HiringRequest`, `Vacancy`, `VacancyQuestion`, `Candidate`,
`Application`, `ApplicationAnswer`, `InterviewStage`,
`InterviewStageParticipant`, `Interview`, `InterviewParticipant`,
`InterviewEvaluation`, `InterviewStageDecision`, `Offer`. New enums:
`HiringRequestReason`, `HiringRequestStatus`, `WorkArrangement`,
`VacancyStatus`, `ApplicationQuestionType`, `ApplicationStatus`,
`InterviewStatus`, `InterviewRecommendation`, `StageDecisionType`,
`OfferStatus`. Reuses the EXISTING `EmploymentType` enum — no duplicate.

Consolidated from the brief's own suggested 13-model list: dropped a separate
"RecruitmentProcess" model (a `Vacancy` owns its `InterviewStage`s directly);
split `InterviewParticipant` into a config/instance pair
(`InterviewStageParticipant` = default panel, `InterviewParticipant` =
per-interview snapshot) mirroring the proven `WorkflowStep`/
`WorkflowStepInstance` definition/instance split.

Key constraints (all live-verified, §10):

- `@@unique([organisationId, email])` on `Candidate` — practical duplicate
  check.
- `@@unique([organisationId, vacancyId, candidateId])` on `Application` —
  duplicate-submission guard.
- `@@unique([vacancyId, sequence])` on `InterviewStage` — stage-ordering
  guard.
- `@@unique([applicationId, interviewStageId])` on `Interview` — one
  interview per candidate per stage, the scheduling concurrency guard.
- `@@unique([interviewId, evaluatorUserId])` on `InterviewEvaluation` — one
  evaluation per evaluator per interview, the independence/duplicate guard.
- `Offer.convertedEmployeeId String? @unique` + a raw-SQL PARTIAL unique
  index (`hr_recruitment_offers_one_active_per_application`, `WHERE status IN
('DRAFT','ISSUED')`) — the duplicate-offer and duplicate-conversion guards.

**One additive change to the EXISTING `Notification` model**: a second,
PARTIAL unique index scoped to `WHERE "sourceType" = 'INTERVIEW'` (full
reasoning, including the unscoped-version failure against real data, in
recruitment.md §9 and notifications.md).

**Migrations** (1 migration folder, applied and verified via `prisma migrate
status` — "Database schema is up to date!"):
`20260922090000_sprint30_recruitment_foundation` — every new enum/table/index
above, plus the two `NotificationType` values and the `NotificationCategory`
value. A first attempt at the Notification partial-unique index (unscoped)
was caught failing against real live data (`P3018`, a genuine constraint
violation) BEFORE being committed — resolved via `prisma migrate resolve
--rolled-back`, the index scoped to `sourceType = 'INTERVIEW'`, and the
migration rebuilt and reapplied cleanly.

## 4. Interview Model

- **Stages**: `InterviewStage` — HR-configured, explicit `sequence`, belongs
  to one `Vacancy`, shared across every candidate applying to it.
- **Participants**: `InterviewStageParticipant` (default panel, config) →
  copied into `InterviewParticipant` (snapshot) at scheduling time. Real
  `User` identity only, validated via `UserService.getById` — never free text.
- **Scheduling**: `InterviewService.schedule()` — validates the stage belongs
  to the same vacancy as the application, validates every participant exists
  in the organisation, creates the `Interview` + snapshot participants, marks
  `Application.status = INTERVIEWING`, and triggers exactly one notification
  event (§5).
- **Evaluations**: `InterviewEvaluationService.submit()` — the interviewer-
  authorization gate (a direct `InterviewParticipant` row check, plus a live
  `User.status === 'ACTIVE'` check added after a real gap was found live,
  §7/§12) + independence (the self-scoped view never includes others'
  evaluations) + immutability (no update route; `reopen` only stamps an audit
  marker).
- **Scoring**: fixed 1–5 (`InterviewEvaluation.score`, app-level validated).
- **Recommendations**: one shared `InterviewRecommendation` enum
  (`PROCEED`/`HOLD`/`REJECT`/`RECOMMEND_HIRE`/`RECOMMEND_REJECT`) for both
  intermediate and final stages — the frontend shows only the relevant
  subset.
- **Aggregation**: `InterviewStageDecisionService.summarize()` — average
  score, recommendation counts, completion — computed on every read, NEVER
  persisted, NEVER used to auto-decide anything.
- **HR Decisions**: `InterviewStageDecision` (append-only, mirrors
  `WorkflowDecision`) — `ADVANCE`/`HOLD`/`REJECT`, concurrency-guarded via a
  conditional `Interview.status: SCHEDULED → COMPLETED` transition performed
  in the same transaction as the decision insert.

## 5. Notification Integration

`RecruitmentNotificationService` creates `Notification` rows directly
(reusing the exact `createMany({ skipDuplicates: true })` idiom
`NotificationRepository` itself uses) — no import of `NotificationsModule`
(would create a circular module dependency, see §2). Two new types,
`INTERVIEW_SCHEDULED`/`INTERVIEW_EVALUATION_REQUIRED`, under a new
`NotificationCategory.RECRUITMENT_INTERVIEWS`, fire together at scheduling
time. `EMAIL_ELIGIBLE_TYPES` gained both types (one-line addition);
`whatsapp-template.ts` gained one new template resolution for
`INTERVIEW_SCHEDULED` only. Zero changes to `EmailDeliveryCreationService`/
`WhatsAppDeliveryCreationService`/their processors — proven live (§10): a
real scheduled interview produced 4 real `Notification` rows, and enabling
one recipient's category preference produced 2 real `SENT` `EmailDelivery`
rows through the completely unmodified existing pipeline.

## 6. Access Control

11 new `hr.recruitment.*` permissions (catalogue 138 → 149), full table in
recruitment.md §12. All auto-granted to Administrator through the existing
catalogue-seed loop. `InterviewEvaluationController` is self-scoped
(`JwtAuthGuard` alone) — a panelist may hold none of the `hr.recruitment.*`
permissions; the real per-interview authorization is always the
`InterviewParticipant` row check, never the coarse permission alone.

## 7. Security

- **Tenant isolation**: every repository scopes by `organisationId`.
  Live-verified: a genuinely separate organisation's list endpoints all
  returned empty; direct cross-tenant `GET`s (vacancy, application,
  interview, the self-scoped interview view) all `404`'d with no existence
  leak; a cross-tenant evaluation-submission attempt `404`'d before the
  participant check ever ran.
- **Interviewer authorization**: live-verified — an unassigned user (holding
  no `hr.recruitment.*` permission) received `403` on both viewing and
  evaluating a real interview.
- **Evaluation independence**: live-verified across a real 3-person panel —
  after the first evaluator submitted, a second evaluator's self-scoped view
  still showed `ownEvaluation: null` with no trace of the first score.
- **Evaluation-independence payload leak — found and fixed via an actual
  browser session (§9 item 15).** The self-scoped `GET /hr-interviews/:id`
  response was, until this fix, also carrying every evaluator's raw
  `evaluations` array and every `InterviewStageDecision` row in the JSON
  body — never rendered by the current frontend, but inspectable by any
  panelist via their browser's network tab, which would have defeated the
  "never see others' evaluations first" guarantee. Fixed by having the
  controller return only the specific fields the mobile view needs,
  omitting `evaluations`/`decisions` entirely.
- **Suspended-user exclusion — found and fixed live.** `JwtAuthGuard` is pure
  authentication and does not re-verify live `User.status`.
  `InterviewEvaluationService.submit()` initially checked only the
  participant row. Live verification surfaced the gap directly: a suspended
  interviewer's still-valid, pre-suspension JWT successfully reached the
  submission code path. Fixed with an explicit
  `UserService.getById(...).status === 'ACTIVE'` check (the same pattern
  `WhatsAppEligibilityService`/`EmailEligibilityService` already use) and
  re-verified live with the identical token — `403`, "Your account is not
  active and cannot submit a new evaluation." Two new unit tests added.
- **Duplicate-conversion guard — restructured before ever being tested.** An
  early `OfferService.accept()` draft created the `Employee` BEFORE claiming
  the offer atomically, which would have let a genuine race create two
  `Employee` rows (only one winning the final claim, the other orphaned).
  Restructured into `claimAcceptance()` (a conditional `ISSUED → ACCEPTED`
  claim) FIRST, then `Employee` creation only by the winner, then
  `confirmConversion()`. Live-verified: 5 concurrent accept requests against
  one issued offer produced exactly one `201` (one real `Employee` created)
  and four `400`s; exactly one `Employee` row existed afterward.
- **Public application security**: rate limiting (`@nestjs/throttler`, new
  this sprint, scoped to the one apply route only — never registered
  globally) and resume file-type/size validation (`assertValidResumeFile`,
  new). Live-verified: a 6th rapid request from one IP within 60 seconds
  returned `429`; duplicate submission returned `400` with zero duplicate
  rows; a missing required answer was rejected before any `Candidate`/
  `Application` row was created.
- **Candidate privacy**: internal screening notes and individual evaluations
  are never returned on any public/candidate-facing response; the public
  apply endpoint's success response carries no candidate/application id.

## 8. Testing

- **213 suites / 1819 tests overall, all passing** (up from 200/1731 at the
  start of this sprint).
- **Recruitment: 13 new suites, 88 new tests** — `hiring-request.service`,
  `vacancy.service`, `interview-stage.service`, `interview.service`,
  `interview-evaluation.service` (including the 2 suspended-user tests added
  after the live-verification finding), `interview-evaluation.controller`
  (4 tests, added after the browser-verification finding in §9 — asserts
  `getOne()` calls `getByIdWithRelations()` and never forwards other
  evaluators' `evaluations` or `decisions`), `interview-stage-decision.service`,
  `offer.service`, `application.service`, `careers.service`,
  `recruitment-notification.service`, `hiring-request-workflow.handler`
  (in `workflow/handlers/`), and `recruitment-independence.spec.ts` (the
  structural guard).
- `workflow-independence.spec.ts` extended with a matching structural guard
  for `HiringRequestWorkflowHandler` (never touches `this.prisma` directly).
- Typecheck: clean (`tsc --noEmit`, both apps).
- Lint: 27 pre-existing warnings (API, none in any Sprint 30 file — confirmed
  the count is unchanged from before this sprint), 0 new; web clean (a
  `no-img-element` warning on the new public careers page was found and
  fixed with the existing `eslint-disable` convention `ImageUploadCard`
  already established, before it could count as a new warning).
- Build: both apps build successfully (`nest build`, `next build`). Two real
  Next.js build errors (`useSearchParams()` needs a Suspense boundary, on
  the Applications and Vacancies list pages) were found by the build itself
  and fixed by splitting each into an outer `Suspense`-wrapped component,
  mirroring the existing `/login` page's own pattern.
- `npx prisma validate`: schema valid. `npx prisma migrate status`: database
  schema up to date.
- Seed: idempotent — re-ran twice; the second run correctly logged "Skipping
  Sprint 30 Recruitment fixtures — already seeded" and created nothing
  further. Verified counts after the first run: 1 hiring request, 1
  vacancy, 2 interview stages, 5 stage participants, 3 candidates, 3
  applications.

## 9. Live Verification

Performed against the real local PostgreSQL database and real authenticated
tokens (Boby Bites tenant: Owner/Administrator for configuration and
decisions, Ibrahim Musa and Grace Effiong as real interview panelists, Member
for authorization negative tests; a freshly-registered second organisation
from an earlier sprint's own test fixture, reused here, for cross-tenant
checks). Every item below is an ACTUAL executed scenario, not a design
description:

1. **Public careers flow**: `GET /careers/boby-bites` returned the real
   published Cashier vacancy; `GET /careers/boby-bites/cashier` returned the
   full detail + its 2 configured questions; a cross-tenant org slug and a
   nonexistent vacancy slug both `404`'d with no leak.
2. **Public application**: a real multipart submission (candidate fields +
   both question answers + a PDF resume) succeeded (`201`,
   `{success:true, submittedAt}`, no id exposed); an immediate duplicate
   returned `400`; a submission missing a required answer returned `400`
   before any row was created; 6 rapid requests from one IP triggered `429`
   on the 3rd+ (rate limiting confirmed active, accounting for prior calls in
   the same 60s window).
3. **Screening**: rejected one seeded candidate (Ngozi Adeyemi) directly at
   screening with internal notes — `Application.status → REJECTED`.
4. **Interview Stage 1 (seeded)**: 3 real panelists (Boby Admin, Ibrahim
   Musa, Grace Effiong) each independently submitted a 1–5 score +
   recommendation for the same seeded candidate (Amaka Chukwu). Verified,
   in sequence: an unassigned user (Member) received `403` viewing AND
   evaluating; after Ibrahim submitted, Grace's own view still showed
   `ownEvaluation: null` with no leak; Ibrahim's attempted second submission
   was rejected as a duplicate (immutability); the HR aggregate summary
   correctly computed `averageScore: 4.3`, `{PROCEED: 3}` from the real
   scores (4, 5, 4); HR's own detail view showed all 3 individual
   evaluations.
5. **Stage 1 decision + concurrency**: fired 5 concurrent `ADVANCE` decision
   requests at the same interview — exactly one `201`, four `400`s
   ("already decided"), exactly one `InterviewStageDecision` row in the
   database afterward. `Application.status` correctly stayed
   `INTERVIEWING` (not auto-`SELECTED`, since stage 1 was not the vacancy's
   last stage).
6. **Interview Stage 2** (real API, not seeded): scheduled the Management
   Interview for the same candidate via `POST /hr/recruitment/interviews` —
   confirmed 4 real `Notification` rows created (2 participants × 2 types)
   with correct titles; enabled one participant's `RECRUITMENT_INTERVIEWS`
   email preference and re-ran the existing `process-events` sweep —
   confirmed 2 real `EmailDelivery` rows created and `SENT` through the
   completely unmodified existing email pipeline.
7. **Stage 2 evaluations + final decision**: both panelists submitted
   `RECOMMEND_HIRE`; the `ADVANCE` decision on this LAST configured stage
   correctly flipped `Application.status → SELECTED`.
8. **Offer lifecycle**: created (`DRAFT`) → issued (`ISSUED`) → a duplicate
   active-offer creation attempt correctly rejected (`400`) → fired 5
   concurrent `accept` requests — exactly one `201` (with a genuinely
   created `Employee`), four `400`s, exactly one `Employee` row in the
   database afterward.
9. **Employee/Onboarding hand-off**: verified directly in the database —
   exactly 1 `Employee` row for the candidate's email, `employmentStatus:
ONBOARDING`, `userId: null` (no auto-provisioned account); exactly 1
   `EmployeeOnboarding` row, `status: IN_PROGRESS`, 7 default tasks
   (the existing checklist, unchanged).
10. **Hiring Request → real Workflow routing** (not the direct-approval
    path): created a fresh hiring request, submitted it directly
    (`DRAFT → SUBMITTED`), then routed it through the ACTUAL Workflow
    engine (`POST /workflows/instances` + `.../submit` against the seeded
    `HIRING_REQUEST_APPROVAL` definition) — the instance correctly reached
    `IN_PROGRESS` with step 1 assigned to Administrator; Administrator's
    `POST .../approve` correctly flipped the `WorkflowInstance` to
    `APPROVED`, and `HiringRequestWorkflowHandler.onWorkflowApproved`
    correctly flipped the underlying `HiringRequest.status → APPROVED` via
    the callback.
11. **Suspended-interviewer exclusion** (the finding in §7): reactivated,
    obtained a fresh token for Ibrahim, immediately suspended him
    (`INACTIVE`), and immediately attempted an evaluation submission with
    that still-valid token against a fresh interview — first attempt (before
    the fix) succeeded incorrectly; after adding the live-status check,
    re-ran the IDENTICAL sequence — correctly `403`'d.
12. **Cross-tenant isolation**: a genuinely separate organisation's
    `GET`s for vacancies/applications/hiring-requests/offers all returned
    empty lists; direct `GET`s by real Boby Bites ids (vacancy, application,
    interview, and the self-scoped `/hr-interviews/:id`) all `404`'d; an
    evaluation-submission attempt against a real cross-tenant interview id
    also `404`'d.
13. **Rejected/held path**: item 3 above (Ngozi Adeyemi, rejected at
    screening) is the required "at least one rejected/held candidate"
    scenario.
14. **Cleanup**: reverted the test email preference toggle to its default
    (`false`); reactivated the suspended interviewer (`ACTIVE`); confirmed
    final interview states are all terminal or a documented, legitimate
    in-progress row (1 `SCHEDULED` — Tobi Fashola's still-pending interview,
    2 `COMPLETED`). The one extra public-application test candidate
    (Temitope Balogun) and the one Workflow-routed hiring request created
    during live verification were deliberately left in place as harmless,
    documented demonstration data, consistent with this session's own
    "nothing deletes rows" convention from every prior sprint.
15. **Mobile interviewer page crash — found and fixed via an actual browser
    session (not just API calls).** Logged into the real dev server at a
    375px viewport, as the seeded interviewer with a genuine "Action needed"
    assignment, and opened `/hr-interviews/:id` for real. The page crashed
    with `Cannot read properties of undefined (reading 'firstName')`.
    Root cause: `InterviewEvaluationController.getOne()` called
    `InterviewService.getById()`, whose repository query joins only the bare
    `application` relation — no `candidate`, no `vacancy` — while
    `getByIdWithRelations()` (already used elsewhere for the HR-facing view)
    joins both. Fixed by switching `getOne()` to `getByIdWithRelations()`.
    That surfaced a second, more serious issue: `getByIdWithRelations()`'s
    include also carries every evaluator's `evaluations` and every
    `InterviewStageDecision` row — unfiltered — which this SELF-SCOPED
    endpoint would then have forwarded verbatim in the JSON response body to
    the requesting panelist, violating "interviewers must never see others'
    evaluations before submitting their own" even though the frontend never
    rendered those fields (a network-tab inspection would still have leaked
    them). Fixed by having the controller return only the specific fields
    the mobile view needs (`id`, `scheduledAt`, `durationMinutes`,
    `location`, `meetingLink`, `status`, `interviewStage`, `application`),
    omitting `evaluations`/`decisions` entirely — the caller's own
    evaluation continues to arrive separately via `ownEvaluation`, exactly
    as the existing code comment already (incorrectly, until this fix)
    claimed. Re-verified live: the page rendered correctly, the raw network
    response contained no `evaluations`/`decisions` keys, and a full
    score-4/`PROCEED`/comment submission completed end-to-end and persisted
    (visible immediately as "Your evaluation has been submitted" with the
    real submitted timestamp). Four regression tests added
    (`interview-evaluation.controller.spec.ts`); full suite, typecheck,
    lint, and `nest build` re-confirmed clean afterward.

## 10. Documentation

- [`docs/domains/recruitment.md`](domains/recruitment.md) — new domain doc.
- `docs/sprint-30-completion-report.md` — this document.
- `docs/domains/hr.md`, `docs/domains/notifications.md`,
  `docs/domains/README.md`, `README.md`, `docs/roadmap.md`,
  `docs/backlog.md`, `docs/changelog.md` — updated with Sprint 30 summaries.
- `apps/api/.env.example` — new resume-upload-size variable documented.

## 11. Deferred Scope

Job board/LinkedIn/Indeed integrations, recruitment agencies, AI/ML anything
(CV ranking, automated rejection, personality inference), psychometric tests,
background/reference checks, automated CV parsing, complex scoring matrices,
video interviewing, digital signatures, payroll/benefits/performance/leave,
advanced recruitment analytics, a candidate portal/account, a chatbot, bulk
recruitment marketing, SMS campaigns, a delayed post-interview evaluation
reminder (no background scheduler exists in this codebase), and WhatsApp
delivery for `INTERVIEW_EVALUATION_REQUIRED` specifically (email + in-app
only for that one type). No automatic hiring decision anywhere — every
transition is an explicit, authenticated HR action; the system computes and
presents evidence, never a decision.

## 12. Git Status

- **No commit made.**
- **No push made.**
- Branch: `main`.
- HEAD: `a536feb135b8194458fc2fb4cebe16b470740dfb` — "Sprint 29: WhatsApp
  Notification Delivery Foundation" (unchanged by this sprint's work).
- Working tree: 20 modified files, 11 new top-level paths (several are
  directories containing many files each — the full recruitment backend
  module, its frontend pages, and the public careers pages) — nothing
  staged, nothing committed, per this sprint's own standing "DO NOT commit.
  DO NOT push." instruction.
