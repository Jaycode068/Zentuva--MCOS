# Getting Started

Quick-start version. For the full guide — Prisma migrations, Prisma Studio, VS Code debugging,
troubleshooting — see [Local Development Guide](../development/local-development.md).

## Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 (enable via `corepack enable && corepack prepare pnpm@9 --activate`
  if you don't have it)
- Docker + Docker Compose (used for Postgres/Redis only — see
  [development philosophy](../development/local-development.md#development-philosophy))

## Setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up
pnpm db:generate
pnpm db:migrate
```

## Run

```bash
pnpm dev
```

Runs `apps/web` (http://localhost:3000) and `apps/api` (http://localhost:4000) on the host with
hot reload. Check the API:

```bash
curl http://localhost:4000/api/health
```

## When you're done

```bash
pnpm infra:down
```

## Common scripts (run from the repo root)

| Command           | Description                                 |
| ----------------- | ------------------------------------------- |
| `pnpm infra:up`   | Start Postgres + Redis (Docker, background) |
| `pnpm dev`        | Run all apps in dev mode, with hot reload   |
| `pnpm infra:down` | Stop Postgres + Redis                       |
| `pnpm build`      | Build all apps and packages                 |
| `pnpm lint`       | Lint all apps and packages                  |
| `pnpm type-check` | Type-check all apps and packages            |
| `pnpm test`       | Run tests across all apps and packages      |
| `pnpm db:studio`  | Open Prisma Studio                          |

See the [Local Development Guide](../development/local-development.md) for the complete command
reference, migrations, debugging, and troubleshooting; and
[development-workflow.md](development-workflow.md) for day-to-day engineering conventions.
