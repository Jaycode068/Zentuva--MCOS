# Sprint 30.1 Completion Report — Public Recruitment Experience & Candidate Application Flow

## 1. Executive Summary

Sprint 30 built the complete recruitment domain (Hiring Request → Vacancy →
Application → Screening → Interviews → Offer → Employee) but left the
candidate-facing public side functionally correct yet visually minimal —
plain unstyled text, no tenant branding beyond a small logo, raw HTML form
elements, no SEO metadata, and no live end-to-end browser verification of the
actual candidate journey. This sprint's brief asked for an audit first, then
only the improvements the audit justified — not a rebuild of the recruitment
domain itself.

**Audit finding: the backend was already correct.** Tenant resolution,
published/non-expired visibility rules, hand-built response allowlists, rate
limiting, resume validation, duplicate-application protection (a DB unique
constraint, not an application-level check), and the custom-question engine
were all already server-side, already tenant-scoped, and already covered by
tests. Nothing there needed rebuilding. The gap was entirely the frontend
template and one piece of test coverage the original suite never exercised
(the actual visibility-rule `WHERE` clause, since every existing test mocks
`VacancyRepository` itself).

**What changed**: the three public routes were rewritten from client
components polling `useQuery` into Server Components with real per-page
`generateMetadata`, genuine HTTP `404`s via `notFound()`, and a shared,
tenant-agnostic component library (`PublicCareersLayout`, `CareersHero`,
`VacancyCard`/`VacancyList`, `VacancyDetails`, `ApplicationForm`/
`ApplicationSuccess`) built on the existing `@zentuva/ui` kit instead of raw
HTML elements. The organisation's `industry`/`city`/`country`/`description`
columns (already in the schema, never previously read) now feed the landing
page's hero copy. One new repository-level test suite closes the visibility-
rule coverage gap.

**One real defect was found and fixed via live browser verification, not
design review**: `loading.tsx` Suspense boundaries caused Next.js to start
streaming a `200` response before an async page's `notFound()` could run —
the not-found UI rendered correctly, but the HTTP status stayed `200`. Fixed
by removing the two `loading.tsx` files (detailed in §5).

## 2. Audit — What Already Existed vs What Was Missing

| Area                                           | Sprint 30 state                                                                                            | Sprint 30.1 action                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tenant resolution via slug                     | Correct (`OrganisationService.getBySlug` + `status === 'ACTIVE'`)                                          | Unchanged                                                                                                |
| Published-only visibility, deadline check      | Correct, server-side (`VacancyRepository.findPublicList`/`findPublicBySlug`)                               | Unchanged — added the missing direct test                                                                |
| Vacancy list → detail navigation               | Correct, working links                                                                                     | Unchanged                                                                                                |
| Candidate can apply                            | Correct, full flow worked                                                                                  | Unchanged (server logic)                                                                                 |
| Application form fields                        | Complete (candidate fields, resume, cover letter, typed custom questions)                                  | Rebuilt on `@zentuva/ui`, same fields/logic                                                              |
| Application reaches correct tenant/vacancy     | Correct — org/vacancy always server-resolved from the URL, `organisationId` never accepted from the client | Unchanged                                                                                                |
| Public UI suitability                          | **Plain, unstyled — the actual gap**                                                                       | Rebuilt: hero, cards, badges, polished states                                                            |
| Responsive                                     | Technically responsive (Tailwind) but untested live this sprint                                            | Verified live at 375/768/desktop                                                                         |
| Tenant identity reflected                      | Name + logo only                                                                                           | Extended to industry/city/country/description                                                            |
| Unpublished/paused/closed/expired hidden       | Correct, server-enforced                                                                                   | Unchanged — added the missing direct test                                                                |
| Direct access to unpublished vacancy prevented | Correct (`404`)                                                                                            | Unchanged; confirmed the frontend's `notFound()` HTTP status was wrong (found + fixed, §5)               |
| Internal HR data leak                          | None — hand-built allowlist DTOs                                                                           | Unchanged                                                                                                |
| Duplicate application handling                 | DB-constraint-backed (`@@unique([organisationId, vacancyId, candidateId])`), P2002→null→400                | Unchanged                                                                                                |
| Custom questions → HR visibility               | Correct — verified live this sprint (§4)                                                                   | Unchanged                                                                                                |
| SEO metadata                                   | **None — client components can't export `generateMetadata`**                                               | Added: Server Component conversion + `generateMetadata` on all 3 routes                                  |
| Loading/empty/error states                     | Bare "Loading…"/plain error text                                                                           | Rebuilt: skeleton removed after the 404-status finding (§5), polished empty/error/not-found states added |

No part of the Hiring Request → Vacancy → Application → Interview →
Evaluation → Decision → Offer → Employee domain was touched. The public
pages remain a thin, tenant-agnostic presentation layer over that unchanged
domain.

## 3. Implementation

### Backend (minimal — the audit found it already correct)

- `CareersService.getOrganisationCareersInfo` now also returns `industry`,
  `city`, `country`, `description` — pre-existing `Organisation` columns,
  never previously read anywhere. Still an explicit, hand-built allowlist;
  `businessEmail`/`phone`/address lines are still never returned.
- `apps/api/src/hr/recruitment/vacancy.repository.spec.ts` (new) — the one
  real test-coverage gap the audit found. Every other recruitment test mocks
  `VacancyRepository` itself, so nothing before this sprint ever exercised
  the actual Prisma `WHERE` clause `findPublicList`/`findPublicBySlug` send.
  Verifies, against real fixtures: PUBLISHED-with-no-deadline and
  PUBLISHED-with-a-future-deadline are visible; DRAFT/PAUSED/CLOSED/
  CANCELLED and a PUBLISHED-but-expired vacancy are excluded; another
  organisation's vacancy (even with an identical slug) never resolves.
- `careers.service.spec.ts` — 2 new tests for `getOrganisationCareersInfo`
  (tenant-not-found; the branding allowlist never leaking
  `businessEmail`/`phone`/`addressLine1`).

### Frontend (the actual sprint)

- **Server Components + `generateMetadata`**: all three public routes
  (`apps/web/src/app/careers/[organisationSlug]/{page.tsx,
[vacancySlug]/page.tsx, [vacancySlug]/apply/page.tsx}`) converted from
  `'use client'` + `useQuery` to `async` Server Components. `apiFetch`
  already worked server-side unmodified (it only reads `window.localStorage`
  conditionally). Each route exports `generateMetadata()`:
  landing → `"{Organisation} Careers"`; vacancy → `"{Vacancy} — {Organisation}"`;
  apply → `"Apply — {Vacancy} — {Organisation}"`. All three set
  `export const dynamic = 'force-dynamic'` so a vacancy HR just
  published/paused/closed is reflected on the next request, never served
  stale from Next's route cache.
- **Shared component library** (`apps/web/src/components/app/careers/`,
  following this codebase's existing `components/app/*` convention):
  `PublicCareersLayout`, `CareersHero`, `VacancyCard`, `VacancyList`,
  `VacancyDetails`, `ApplicationForm`, `ApplicationSuccess` — the exact names
  the brief itself suggested. None hardcodes an organisation, vacancy, or
  location; every field is a prop. `CareersHero` reuses the existing
  `orgInitialsFor` helper (`WorkspaceHeader`'s own logo-fallback convention)
  for tenants with no uploaded logo.
- **`@zentuva/ui` throughout** — `Button`, `Card`/`CardHeader`/`CardTitle`/
  `CardContent`, `Input`, `Label`, `Select`, `Textarea`, `Badge` — replacing
  Sprint 30's raw `<input>`/`<button>`/`<textarea>` elements. No new UI
  framework or dependency added.
- **`not-found.tsx` / `error.tsx`** at the `[organisationSlug]` segment —
  covers the nested vacancy/apply routes too. `not-found.tsx` renders a
  plain "This careers page or position is no longer available" message with
  no internal HR status ever mentioned; `error.tsx` (client, per Next.js
  convention) catches genuine failures distinctly, with a Retry button, never
  surfacing a raw error message.
- **Custom questions and file upload**: unchanged logic (dynamic
  TEXT/YES_NO/NUMBER/FILE rendering, resume upload via the existing
  multipart flow), rebuilt on `@zentuva/ui` inputs.

## 4. Live Browser Verification

Performed against the real local PostgreSQL database and the real dev
servers (`apps/api` on :4000, `apps/web` on :3000) — every item below is an
actually-executed action, not a description.

**Scenario A — Browse.** `http://localhost:3000/careers/boby-bites` at
desktop width: hero renders "BB" initials avatar (no logo uploaded), "Join
the Boby Bites Team", "Nigeria" (from the seeded `country` column —
`industry`/`city` are null in this seed), and the intro copy. One open
position card: Cashier / Finance / Full Time / On Site / Ibadan, "Applications
close 10/15/2026", "View Position →". Tab title: "Boby Bites Careers"
(confirming `generateMetadata`).

**Scenario B — Vacancy.** Clicked through to
`/careers/boby-bites/cashier`. Tab title: "Cashier — Boby Bites". Full detail
page: openings, apply-by date, "Apply for this Position" CTA (top and
bottom), About/Responsibilities/Requirements/Qualifications/Experience all
populated from the real seeded vacancy content, "← All Open Positions" back
link. Verified at 375px (iPhone) and 768px (tablet) — full-width CTA on
mobile, generous spacing, no horizontal scroll.

**Scenario C — Apply.** Clicked Apply → `/careers/boby-bites/cashier/apply`
(tab title "Apply — Cashier — Boby Bites"). Filled a real application —
first/last name, email, phone, location, a cover letter, and both seeded
custom questions ("Do you have previous cashier experience?" → Yes,
"How many years of cash-handling experience do you have?" → 2) — and
submitted (no resume attached, since resume is optional). Result: the exact
polished confirmation screen from the brief's own worked example — "Application
Submitted… Thank you for applying for the Cashier position at Boby
Bites… Our recruitment team will review your application and contact you if
you are selected for the next stage." No internal status, no promise of an
interview. Verified the same form at 375px (single-column) and 768px
(two-column first/last name and phone/location) — form fields, file input,
and submit button all render correctly at each width.

**Scenario D — HR.** Logged in as the seeded Boby Bites Administrator,
opened `/settings/hr/recruitment/applications`: the just-submitted
application ("Chidinma Okafor · Cashier · chidinma.okafor.sprint301@
example.test") appeared at the top of the list with status "Submitted".
Opened its detail page: cover letter persisted verbatim; both custom answers
persisted and correctly rendered ("Do you have previous cashier
experience?: Yes", "How many years of cash-handling experience do you
have?: 2"); Screening/Shortlist/Reject controls present. Clicked
**Shortlist** — status flipped to "Shortlisted" live, the screening panel
correctly disappeared, and both configured interview stages ("Finance
Interview", "Management Interview") showed a "Schedule Interview" action,
with the Offer section correctly gated ("Available once all required
interview stages have been advanced").

**Scenario E — Interview.** Confirmed the shortlisted application is now
positioned to enter the existing, unmodified interview/evaluation/decision
pipeline (Schedule Interview → Evaluation → Stage Decision → Offer) exactly
as Sprint 30 already built and live-verified end-to-end; this sprint did not
re-run that full chain since the brief explicitly scopes it as "do not
rebuild the interview system" — the connection point (a publicly-submitted
application successfully reaching Shortlisted with real answers/cover letter
intact) is what needed proving, and is proven above.

This demonstration candidate (Chidinma Okafor) and their application were
deliberately left in the database as harmless, documented demonstration
data, consistent with this session's established "nothing deletes rows"
convention from every prior sprint.

## 5. Defect Found and Fixed

**Symptom.** Direct navigation to an unknown organisation slug or an
unpublished/paused/closed/cancelled/expired vacancy correctly rendered the
"Page Not Found" UI, but `curl -o /dev/null -w '%{http_code}'` against both
`http://localhost:3000/careers/definitely-not-a-real-org` and
`http://localhost:3000/careers/boby-bites/<paused-vacancy-slug>` returned
`200`, not `404`.

**Root cause.** Both the `[organisationSlug]` and `[vacancySlug]` route
segments had their own `loading.tsx`, which makes Next.js begin streaming a
`200` response (the loading skeleton) immediately, before the async Server
Component — and therefore before its `notFound()` call — has resolved. Once
the response headers commit to `200` during that initial stream, the status
cannot be changed retroactively; only the streamed body swaps to the
`not-found.tsx` boundary. The page looked correct; the HTTP contract did
not.

**Fix.** Removed both `loading.tsx` files
(`apps/web/src/app/careers/[organisationSlug]/loading.tsx` and
`.../[vacancySlug]/loading.tsx`). Without a Suspense boundary at that
segment, Next.js waits for the Server Component (including any `notFound()`
throw) to fully resolve before committing the response status. The local
Postgres-backed fetch is fast enough that the loading state was rarely
visible in practice; correct HTTP semantics for a public page (crawlers,
uptime monitors, link validators all rely on the real status code) matters
more than a skeleton screen here.

**Regression test.** `apps/web` has no test runner at all (confirmed: no
Jest/RTL config, no test script in `package.json` — true before this sprint
too), so this cannot be captured as an automated frontend test. The
regression check is the live `curl` verification itself, repeated below.

**Live verification (before/after).**

```text
Before fix:
  GET /careers/definitely-not-a-real-org                 → HTTP 200 (wrong)
  GET /careers/boby-bites/definitely-not-a-real-vacancy   → HTTP 200 (wrong)

After fix:
  GET /careers/definitely-not-a-real-org                  → HTTP 404
  GET /careers/boby-bites/definitely-not-a-real-vacancy   → HTTP 404
  GET /careers/boby-bites/cashier (real, published)       → HTTP 200 (control, unaffected)
```

Two dev-server artifacts were also encountered during this sprint and are
recorded here for completeness, though neither was a code defect: (1) the
`next dev` process's CSS asset versioning briefly served a stale/HTML
response instead of a stylesheet after many rapid file edits — resolved by
clearing `.next` and restarting; (2) the same long-running `next dev`
instance served a stale cached page (still showing a vacancy just paused
through the real HR UI) until restarted — also resolved by a clean restart,
and re-confirmed correct immediately after. Neither recurred once the dev
server was restarted cleanly, and neither reflects a `force-dynamic`/caching
defect in the shipped code (a fresh server immediately reflected the paused
vacancy's absence from all three public surfaces, confirmed via direct
`curl` against the API and the Next.js server both).

## 6. Security Verification

- **Tenant/vacancy resolution manipulation**: `GET /careers/<unknown-org>` →
  `404`; `GET /careers/boby-bites/<unknown-vacancy>` → `404`; `GET
/careers/<unknown-org>/cashier` (the real "cashier" slug under a
  non-existent organisation) → `404` — proves resolution is
  organisation-scoped-then-slug, not slug-first, so an identical vacancy
  slug can never leak across a mismatched organisation. Control: `GET
/careers/boby-bites/cashier` → `200`.
- **Vacancy state test** (brief §24): paused the real seeded Cashier vacancy
  through the actual HR UI (`Pause` button on
  `/settings/hr/recruitment/vacancies/:id`). Verified, via direct API calls
  against the running backend: the careers list response's `vacancies` array
  became `[]`; `GET /careers/boby-bites/cashier` → `404`; `POST
/careers/boby-bites/cashier/apply` → `404` (rejected before any
  candidate/application row could be created). Restored the vacancy to
  `Published` via the same HR UI (`Publish` button) and confirmed the
  backend immediately listed it again (`vacancies: ["Cashier"]`).
- **Interview privacy regression** (brief §24, re-confirming the fix already
  shipped and tested earlier this session): not re-run manually this sprint
  — covered by the still-passing `interview-evaluation.controller.spec.ts`
  (4 tests asserting `getOne()` never forwards other evaluators'
  `evaluations`/stage `decisions`) as part of the full 214-suite run below.
  No code in the interview/evaluation path was touched this sprint.

## 7. Verification

- **Test Suites: 214 passed, 214 total** (up from 213 — Sprint 30.1 added 1
  new suite, `vacancy.repository.spec.ts`).
- **Tests: 1835 passed, 1835 total** (up from 1819 — 16 new: 14 in the new
  repository spec, 2 in `careers.service.spec.ts`).
- **Typecheck**: clean (`tsc --noEmit`, both `apps/api` and `apps/web`).
- **Lint**: `apps/api` — 27 pre-existing warnings, 0 errors, identical count
  to before this sprint (confirmed no new warnings). `apps/web` — 0
  warnings, 0 errors.
- **Build**: `nest build` clean; `next build` clean — all three public
  routes now build as dynamic (`ƒ`) Server Components with meaningfully
  smaller client bundles than the Sprint 30 client-component versions
  (landing/vacancy pages: ~129 kB → ~96 kB First Load JS, since most of the
  page no longer ships to the client at all).
- **Prisma**: `npx prisma validate` — schema valid (unchanged this sprint —
  no migration added). `npx prisma migrate status` — database schema up to
  date, 49 migrations.
- **Seed**: unchanged this sprint (no seed edits) — idempotency was already
  reconfirmed at the end of Sprint 30 and nothing since has touched
  `seed.ts`.

## 8. Documentation

- [`docs/domains/recruitment.md`](domains/recruitment.md) — new §4.0 "Tenant-
  Aware Public Template (Sprint 30.1)" documenting the Server Component
  conversion, shared component library, and the `loading.tsx`/404 defect;
  §15 (Frontend) and §16 (Testing) updated with the new counts and
  architecture.
- `docs/sprint-30.1-completion-report.md` — this document.
- `docs/changelog.md`, `docs/roadmap.md`, `docs/backlog.md` — Sprint 30.1
  entries added.

## 9. Deferred / Unchanged Scope

Everything Sprint 30 already deferred remains deferred (job boards, AI/ML
anything, psychometric tests, background checks, video interviewing, digital
signatures, a candidate portal/account). Additionally out of scope for this
sprint, per its own brief: any change to the Hiring Request → Offer →
Employee domain, the HR admin recruitment dashboard's design, and the
mobile interviewer evaluation flow — none of that was touched.

## 10. Git Status

- **No commit made.**
- **No push made.**
- Branch: `main`.
- HEAD: `a536feb135b8194458fc2fb4cebe16b470740dfb` — "Sprint 29: WhatsApp
  Notification Delivery Foundation" (unchanged by this sprint's work).
- Modified files (26, all inherited from Sprint 30, none newly modified by
  30.1 beyond what's listed below): `README.md`, `apps/api/.env.example`,
  `apps/api/package.json`, `apps/api/prisma/schema.prisma`,
  `apps/api/prisma/seed.ts`, `apps/api/src/app.module.ts`,
  `apps/api/src/config/configuration.ts`,
  `apps/api/src/config/env.validation.ts`, `apps/api/src/hr/hr.module.ts`,
  `apps/api/src/identity/authorization/permission-catalogue.ts`,
  `apps/api/src/identity/organisation/infrastructure/local-file-storage.ts`,
  `apps/api/src/notifications/{email-eligibility.service.ts,
notification-category.ts, notification-message-builder.ts,
notification-preference.service.spec.ts, whatsapp-template.ts}`,
  `apps/api/src/workflow/{workflow-independence.spec.ts,
workflow.module.ts}`, `apps/web/src/components/app/hr-tabs.tsx`,
  `docs/{backlog.md, changelog.md, domains/README.md, domains/hr.md,
domains/notifications.md, roadmap.md}`, `packages/validation/src/index.ts`,
  `pnpm-lock.yaml`.
- New top-level paths (12 — 11 from Sprint 30 plus one added this sprint):
  `.claude/` (tooling, not part of this sprint),
  `apps/api/prisma/migrations/20260922090000_sprint30_recruitment_foundation/`,
  `apps/api/src/hr/recruitment/` (contains this sprint's
  `vacancy.repository.spec.ts` and the `careers.service.ts`/
  `careers.service.spec.ts` edits), `apps/api/src/identity/common/
resume-upload-validation.ts`, `apps/api/src/workflow/handlers/
hiring-request-workflow.handler.{ts,spec.ts}`,
  `apps/web/src/app/(app)/hr-interviews/`,
  `apps/web/src/app/(app)/settings/hr/recruitment/`,
  `apps/web/src/app/careers/` (contains this sprint's 3 rewritten pages,
  `not-found.tsx`, `error.tsx`), **`apps/web/src/components/app/careers/`
  (new this sprint — the 7 shared component files)**, `docs/domains/
recruitment.md`, `docs/sprint-30-completion-report.md`,
  `packages/validation/src/recruitment.ts`. Plus **`docs/sprint-30.1-
completion-report.md`** (this document, new this sprint).

The entire working tree remains uncommitted, per the brief's standing "DO
NOT commit. DO NOT push." instruction.
