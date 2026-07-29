# Sprint 0 Completion Report

**Sprint:** 0 — Engineering Foundation & Developer Experience
**Date:** 2026-07-29
**Scope:** Local development experience only. No business functionality, authentication, users,
products, or domain modules were added — per the Sprint 0 finalisation brief.

## Summary

Sprint 0 is complete. The engineering foundation (Turborepo monorepo, NestJS + Prisma + Postgres,
Next.js + Tailwind + shadcn/ui, shared packages, CI-quality tooling, docs) was built first; this
finalisation pass optimised it for daily local development. Docker now runs infrastructure only
(Postgres + Redis); both apps run on the host for fast hot reload and native VS Code debugging;
the entire workflow is driven by a small set of memorable `pnpm` scripts instead of raw `docker
compose`/`prisma` commands.

## Changes made

### Docker

- `docker-compose.yml` → renamed to **`docker-compose.production.yml`**, header comment now
  explicitly states it is not the daily dev workflow.
- `docker-compose.dev.yml` confirmed as strictly Postgres + Redis (it already was), header comment
  now points developers at the `infra:*` scripts instead of raw compose commands.

### Root package scripts

Added to `package.json`:

- `infra:up`, `infra:down`, `infra:restart`, `infra:logs`, `infra:reset`
- `db:generate`, `db:migrate`, `db:studio`, `db:seed`, `db:reset`

Added to `apps/api/package.json`:

- `dev:debug` (`nest start --watch --debug`, for VS Code attach)
- `prisma:seed` + a `"prisma": { "seed": ... }` config block
- `apps/api/prisma/seed.ts` — placeholder seed script (no business data exists yet)

### Environment files

Simplified from "copy `.env.example` to three-plus places" down to **two files for daily dev**:

- `apps/api/.env` (NestJS + Prisma CLI)
- `apps/web/.env.local` (Next.js, its own auto-loaded convention)

Root `.env` and the non-`.local` `apps/*/.env` files are now clearly documented as optional,
needed only for `docker-compose.production.yml`. Every `.env.example` file explains, in comments,
who reads it and why.

### VS Code

- `.vscode/launch.json` — attach config for NestJS (port 9229, via `dev:debug`), launch configs for
  Next.js server-side and Chrome client-side debugging, plus an "API + Web" compound.
- `.vscode/extensions.json`, `.vscode/settings.json` — recommended extensions and consistent
  format-on-save/lint-on-save behaviour.
- **Fixed a real bug while doing this:** `.gitignore` previously excluded everything under
  `.vscode/` except `extensions.json`, which would have silently prevented `launch.json` and
  `settings.json` from ever being committed/shared with the team.

### Documentation

- **New:** [`docs/development/local-development.md`](development/local-development.md) — the
  canonical, complete guide (first-time setup, full command reference, migrations, Prisma Studio,
  tests, linting, building, stopping infra, resetting the database, VS Code debugging, environment
  file breakdown, port-conflict and Docker troubleshooting).
- `docs/handbook/getting-started.md` — trimmed to a genuine quick-start that links to the guide
  above, removing the duplicated/conflicting detail that used to live in both places.
- `docs/handbook/development-workflow.md` — added a "Daily local development" section at the top.
- `docs/handbook/architecture-overview.md` — Deployment section updated for the dev/production
  compose split.
- `docs/handbook/folder-structure.md` — updated for `docs/development/`, `.vscode/`, the renamed
  compose file, and `prisma/seed.ts`.
- `README.md` — Getting Started section now shows the real `infra:up` / `dev` / `infra:down` loop.
- `docs/changelog.md` — restructured with a proper `[Unreleased]` at top, this sprint's changes
  recorded as `[Sprint 0 Finalisation] - 2026-07-29`, and the original foundation work relabelled
  `[Sprint 0 Foundation]`.
- **New handbook principle:** Principle 10 — _Developer Experience Is a Feature_ — added to
  `docs/handbook/engineering-handbook.md` (version bumped 0.1 → 0.2), per your explicit request.

## Commands available

| Category   | Commands                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Daily loop | `pnpm infra:up`, `pnpm dev`, `pnpm infra:down`                                                                 |
| Infra      | `pnpm infra:up`, `pnpm infra:down`, `pnpm infra:restart`, `pnpm infra:logs`, `pnpm infra:reset`                |
| Database   | `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`, `pnpm db:seed`, `pnpm db:reset`                       |
| Quality    | `pnpm lint`, `pnpm lint:fix`, `pnpm type-check`, `pnpm test`, `pnpm build`, `pnpm format`, `pnpm format:check` |

Full descriptions in [`docs/development/local-development.md`](development/local-development.md#command-reference).

## Local development workflow

```bash
# First time only
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Every day
pnpm infra:up
pnpm dev
# ... work ...
pnpm infra:down
```

## Verification performed

All of the following were actually executed and observed to work, not just inspected:

| Check              | Result                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm infra:up`    | ✅ Starts exactly `postgres` + `redis`, both report `healthy`                                                                                           |
| `pnpm infra:down`  | ✅ Removes containers, preserves the named Docker volumes                                                                                               |
| `pnpm dev`         | ✅ `apps/web` on :3000, `apps/api` on :4000, API connects to live Postgres                                                                              |
| `pnpm lint`        | ✅ Clean across all 7 packages                                                                                                                          |
| `pnpm type-check`  | ✅ Clean across all 7 packages                                                                                                                          |
| `pnpm test`        | ✅ Passes (no tests yet in either app — expected, foundation-only)                                                                                      |
| `pnpm build`       | ✅ Clean build of all apps/packages from a fully clean state                                                                                            |
| `pnpm db:studio`   | ✅ Serves on :5555, returns HTTP 200                                                                                                                    |
| Next.js hot reload | ✅ Edited `apps/web/src/app/page.tsx`, change appeared without restart                                                                                  |
| NestJS hot reload  | ✅ Edited `apps/api/src/health/health.controller.ts`, `nest --watch` recompiled and restarted automatically, change reflected in `/api/health` response |

## Remaining known issues

- **`pnpm db:migrate` needs a real terminal.** `prisma migrate dev` refuses to run in a
  non-interactive shell (this surfaced while verifying in this automated session, not something a
  developer at a real terminal will hit). Documented in the troubleshooting section; CI/scripted
  contexts should use `prisma migrate deploy` instead.
- **VS Code debug configs are set up per Nest/Next's own documented patterns but not
  machine-verified inside an actual VS Code session** in this environment (no VS Code available
  here). Worth a quick manual sanity check by a developer with VS Code installed.
- **`apps/web` has no test suite yet** (`pnpm --filter @zentuva/web test` is a placeholder
  no-op). Not a Sprint 0 blocker, but Sprint 1 should introduce at least a smoke test setup
  (e.g. Vitest/RTL) before UI logic accumulates.
- **`docker-compose.production.yml` is scaffolded but not deeply exercised** beyond confirming it
  builds (verified in the prior session). It's explicitly out of the daily-dev critical path, so
  this is acceptable for now, but it hasn't been used as a real deployment target yet.

## Recommendations before Sprint 1

1. **Do a five-minute onboarding dry run with a fresh clone** before anyone else joins — the
   `docs/development/local-development.md` "under 10 minutes" claim should be validated by someone
   who didn't write it.
2. **Decide where the first real domain (Identity/Organisation) will introduce its first Prisma
   model**, since that's also when the placeholder `HealthCheck` technical model
   (`apps/api/prisma/schema.prisma`) should be removed per its own doc comment.
3. **Wire `apps/api/prisma/seed.ts`** with real seed data as soon as the first domain model lands,
   so `pnpm db:seed` stops being a no-op.
4. **Add a smoke test to `apps/web`** early in Sprint 1, before component count grows — retrofitting
   test infrastructure is more expensive than starting with it.
5. **Apply Principle 10 (DX Is a Feature) as a review lens going forward**: when Sprint 1 adds the
   first domain module, explicitly check whether it keeps `pnpm dev` fast and `pnpm infra:up`
   sufficient, or whether it quietly needs something more (e.g. a new infra service) — if so, that
   decision should get its own ADR, the same way the original architecture decisions did.
