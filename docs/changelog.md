# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

### Added

- Initial engineering foundation: Turborepo monorepo (`apps/web`, `apps/api`, `packages/ui`,
  `packages/types`, `packages/config`, `packages/utils`, `packages/validation`).
- NestJS backend skeleton with global config module, Prisma integration, and a `/api/health`
  endpoint (`@nestjs/terminus`, checks database + heap).
- Next.js frontend skeleton (App Router) with Tailwind CSS, shadcn/ui (`packages/ui`), and
  TanStack Query provider.
- Shared tooling: ESLint, Prettier, Husky + lint-staged, EditorConfig, path aliases, shared
  TypeScript configs.
- Docker Compose for full-stack (`docker-compose.yml`) and infra-only local dev
  (`docker-compose.dev.yml`), plus per-app Dockerfiles.
- `docs/` structure: engineering handbook, coding standards, architecture overview, development
  workflow, getting started, ADRs (001–004), API/database/domain doc stubs, roadmap.

No business modules (authentication, users, product catalogue, or any domain module) were
implemented — this is foundation-only, per the task scope.
