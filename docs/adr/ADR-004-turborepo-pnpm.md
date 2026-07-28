# ADR-004: Use Turborepo + pnpm workspaces for the monorepo

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The Handbook specifies a Turborepo monorepo containing `apps/web`, `apps/api`, and several shared
`packages/*`. A workspace/package-manager combination and a task-orchestration strategy need to be
chosen.

## Decision

Use **pnpm workspaces** for dependency management and **Turborepo** for task orchestration
(build/dev/lint/type-check/test), with internal packages referenced via `workspace:*`.

## Rationale

- pnpm's content-addressable store and strict node_modules avoid the phantom-dependency and disk
  bloat problems of npm/yarn in a monorepo with many shared packages.
- Turborepo gives dependency-aware task graphs (`^build` before `build`) and caching, which
  matters as the number of `packages/*` grows with future domains.
- Both are explicitly named in the project brief and are the current default choice for
  Next.js/NestJS monorepos.
- pnpm ships via Node's built-in Corepack, so no separate global install step is required.

## Consequences

- Contributors must use `pnpm` (enforced via the root `package.json` `"packageManager"` field and
  `engines`), not `npm`/`yarn`.
- Shared packages (`@zentuva/ui`, `@zentuva/types`, `@zentuva/utils`, `@zentuva/validation`,
  `@zentuva/config`) are consumed via `workspace:*` and must be added as an explicit dependency by
  any app/package that imports them — Turborepo/pnpm do not implicitly hoist them.
