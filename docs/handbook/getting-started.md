# Getting Started

## Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 (enable via `corepack enable && corepack prepare pnpm@9 --activate`
  if you don't have it)
- Docker + Docker Compose (for Postgres/Redis, or full-stack runs)

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure environment variables

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Adjust values as needed. See [configuration reference](../database/README.md) and each app's
`.env.example` for what every variable does.

## 3. Start infrastructure (Postgres + Redis)

```bash
docker compose -f docker-compose.dev.yml up -d
```

## 4. Generate the Prisma client

```bash
pnpm --filter @zentuva/api run prisma:generate
```

## 5. Run the apps

```bash
pnpm dev
```

This runs `apps/web` (http://localhost:3000) and `apps/api` (http://localhost:4000) in parallel
via Turborepo. Check the API health endpoint:

```bash
curl http://localhost:4000/api/health
```

## Alternative: full stack in Docker

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
docker compose up --build
```

## Common scripts (run from the repo root)

| Command           | Description                            |
| ----------------- | -------------------------------------- |
| `pnpm dev`        | Run all apps in dev mode (Turborepo)   |
| `pnpm build`      | Build all apps and packages            |
| `pnpm lint`       | Lint all apps and packages             |
| `pnpm format`     | Format the repo with Prettier          |
| `pnpm type-check` | Type-check all apps and packages       |
| `pnpm test`       | Run tests across all apps and packages |

See [development-workflow.md](development-workflow.md) for day-to-day conventions.
