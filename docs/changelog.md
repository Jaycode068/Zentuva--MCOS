# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

_Nothing yet._

## [Sprint 0 Finalisation] - 2026-07-29

### Added

- Root convenience scripts for the entire daily dev loop: `infra:up`, `infra:down`,
  `infra:restart`, `infra:logs`, `infra:reset`, `db:generate`, `db:migrate`, `db:studio`,
  `db:seed`, `db:reset` — no developer needs to remember a raw `docker compose` or `prisma`
  command.
- `apps/api/prisma/seed.ts` — placeholder seed script wired up via `pnpm db:seed`, ready for
  domain modules to extend.
- `apps/api` `dev:debug` script (`nest start --watch --debug`) for VS Code debugging.
- `.vscode/launch.json` — shared debug configs for NestJS (attach) and Next.js (server-side +
  client-side), plus a combined compound; `.vscode/extensions.json` and `.vscode/settings.json`
  for a consistent editor setup. (`.gitignore` updated — it previously excluded all of `.vscode/`
  except `extensions.json`, which would have silently dropped `launch.json`.)
- `docs/development/local-development.md` — the complete local development guide (first-time
  setup, command reference, migrations, Prisma Studio, debugging, environment file breakdown,
  port-conflict and Docker troubleshooting).
- Handbook Principle 10 — **Developer Experience Is a Feature** — added to
  [engineering-handbook.md](handbook/engineering-handbook.md) (version bumped to 0.2).

### Changed

- `docker-compose.yml` renamed to `docker-compose.production.yml` and documented as the
  full-stack/production-verification path, **not** the daily development workflow.
  `docker-compose.dev.yml` (Postgres + Redis only) is now the canonical dev-infra file, wrapped by
  the `infra:*` scripts above.
- Simplified the environment file story: local development now needs exactly two files
  (`apps/api/.env`, `apps/web/.env.local`) instead of copying `.env.example` into three or more
  locations. Root `.env` and the non-`.local` app `.env` files are now clearly documented as
  optional/production-compose-only.
- `docs/handbook/getting-started.md` trimmed to a quick-start that links to the full
  [Local Development Guide](development/local-development.md), removing duplicated detail between
  the two documents.
- `docs/handbook/development-workflow.md` and `docs/handbook/architecture-overview.md` updated to
  reflect the `infra:up` / `dev` / `infra:down` workflow and the dev/production compose split.

No business functionality was touched — this sprint was scoped entirely to developer experience
and local development tooling, per the Sprint 0 finalisation brief.

## [Sprint 0 Foundation]

### Added

- Initial engineering foundation: Turborepo monorepo (`apps/web`, `apps/api`, `packages/ui`,
  `packages/types`, `packages/config`, `packages/utils`, `packages/validation`).
- NestJS backend skeleton with global config module, Prisma integration, and a `/api/health`
  endpoint (`@nestjs/terminus`, checks database + heap).
- Next.js frontend skeleton (App Router) with Tailwind CSS, shadcn/ui (`packages/ui`), and
  TanStack Query provider.
- Shared tooling: ESLint, Prettier, Husky + lint-staged, EditorConfig, path aliases, shared
  TypeScript configs.
- Docker Compose for full-stack (`docker-compose.yml`, later renamed to
  `docker-compose.production.yml`) and infra-only local dev (`docker-compose.dev.yml`), plus
  per-app Dockerfiles.
- `docs/` structure: engineering handbook, coding standards, architecture overview, development
  workflow, getting started, ADRs (001–004), API/database/domain doc stubs, roadmap.

No business modules (authentication, users, product catalogue, or any domain module) were
implemented — this is foundation-only, per the task scope.
