# Local Development Guide

This is the complete guide to running Zentuva locally. If you follow it in order, you should be
productive in under 10 minutes.

## Development philosophy

- **Docker runs infrastructure only** — Postgres and Redis. Nothing else.
- **Next.js, NestJS, and Prisma all run directly on the host machine**, not in containers. This
  keeps hot reload fast and lets VS Code debug them directly, with no "attach to container" step.
- The daily loop is two commands:

  ```bash
  pnpm infra:up   # start Postgres + Redis in Docker
  pnpm dev        # run apps/web and apps/api on the host, with hot reload
  ```

  and when you're done:

  ```bash
  pnpm infra:down
  ```

  You should never need to remember a raw `docker compose ...` command — every infra and database
  operation has a `pnpm` script (see [Command reference](#command-reference) below).

## First-time setup

### Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 — enable via Corepack if you don't have it:
  ```bash
  corepack enable && corepack prepare pnpm@9 --activate
  ```
- Docker + Docker Compose (for Postgres/Redis only — see philosophy above)

### 1. Install dependencies

```bash
pnpm install
```

This installs every app and package in the monorepo in one pass.

### 2. Configure environment variables

For local development you only need **two** files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The defaults in both files already point at `localhost` and match the ports
`docker-compose.dev.yml` publishes, so no edits are required to get started. (See
[Environment files](#environment-files) below for why these are the only two files you need, and
when you'd need more.)

### 3. Start infrastructure

```bash
pnpm infra:up
```

Starts Postgres and Redis in Docker, in the background. First run pulls the images, so it may
take a minute; after that it's a few seconds.

### 4. Set up the database

```bash
pnpm db:generate   # generate the Prisma client
pnpm db:migrate    # apply migrations (creates them on first run)
```

### 5. Run the apps

```bash
pnpm dev
```

This runs `apps/web` (http://localhost:3000) and `apps/api` (http://localhost:4000) in parallel
via Turborepo, both with hot reload. Confirm the API is talking to the database:

```bash
curl http://localhost:4000/api/health
```

You should get back `{"status":"ok", ...}`.

That's it — you're set up.

## Command reference

All commands run from the repo root.

### Everyday workflow

| Command           | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `pnpm infra:up`   | Start Postgres + Redis (Docker, background)              |
| `pnpm dev`        | Run `apps/web` + `apps/api` on the host, with hot reload |
| `pnpm infra:down` | Stop Postgres + Redis                                    |

### Infrastructure

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `pnpm infra:up`      | Start Postgres + Redis                                       |
| `pnpm infra:down`    | Stop Postgres + Redis (data is preserved in a Docker volume) |
| `pnpm infra:restart` | Restart the containers without touching their data           |
| `pnpm infra:logs`    | Tail Postgres + Redis logs (Ctrl+C to stop watching)         |
| `pnpm infra:reset`   | **Destroys all local data** and starts fresh containers      |

### Database (Prisma)

| Command            | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm db:generate` | Regenerate the Prisma client from `apps/api/prisma/schema.prisma` |
| `pnpm db:migrate`  | Create/apply a migration in dev mode (`prisma migrate dev`)       |
| `pnpm db:studio`   | Open Prisma Studio, a GUI for browsing/editing the database       |
| `pnpm db:seed`     | Run the seed script (`apps/api/prisma/seed.ts`)                   |
| `pnpm db:reset`    | Drop the database, reapply all migrations, and reseed             |

`pnpm db:seed` creates the "Boby Bites" pilot organisation and one development account per
system role, using the credentials in `apps/api/.env.example` (copy it to `.env` as-is to
get working logins — these are local-only, not real secrets):

| Role          | Email                    | Password                             |
| ------------- | ------------------------ | ------------------------------------ |
| Owner         | `owner@bobybites.local`  | `local-dev-only-not-a-real-password` |
| Administrator | `admin@bobybites.local`  | `local-dev-only-not-a-real-password` |
| Member        | `member@bobybites.local` | `local-dev-only-not-a-real-password` |

### Quality checks

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `pnpm lint`         | Lint every app and package               |
| `pnpm lint:fix`     | Lint and auto-fix every app and package  |
| `pnpm type-check`   | Type-check every app and package         |
| `pnpm test`         | Run tests for every app and package      |
| `pnpm build`        | Build every app and package              |
| `pnpm format`       | Format the repo with Prettier            |
| `pnpm format:check` | Check formatting without writing changes |

## Running Prisma migrations

`apps/api/prisma/schema.prisma` is the single source of truth for the database schema. After
changing it:

```bash
pnpm db:migrate
```

You'll be prompted for a migration name. This creates a new folder under
`apps/api/prisma/migrations/` — commit it along with your schema change (per
[Documentation is Part of Development](../handbook/engineering-handbook.md#5-product-principles),
document the schema change in `docs/database/README.md` too).

To regenerate the Prisma client without creating a migration (e.g. after pulling someone else's
migration):

```bash
pnpm db:generate
```

## Opening Prisma Studio

```bash
pnpm db:studio
```

Opens a browser-based GUI at http://localhost:5555 for browsing and editing rows directly.
Requires `pnpm infra:up` to be running first.

## Running tests

```bash
pnpm test
```

Runs every app/package's test suite via Turborepo. `apps/api` uses Jest; `apps/web` has no test
suite yet. Run a single app's tests directly when iterating:

```bash
pnpm --filter @zentuva/api test
```

## Linting

```bash
pnpm lint       # check
pnpm lint:fix   # check and auto-fix
```

Husky + lint-staged also run ESLint and Prettier automatically on staged files before every
commit, so most style issues are caught before they reach CI.

## Building

```bash
pnpm build
```

Builds every app and package via Turborepo (`apps/web` → `.next/`, `apps/api` → `dist/`, shared
packages → `dist/`), respecting the dependency graph (shared packages build before the apps that
consume them).

## Stopping infrastructure

```bash
pnpm infra:down
```

Stops the Postgres and Redis containers. Your data is preserved in a Docker volume — the next
`pnpm infra:up` picks up where you left off.

## Resetting the database

Two options, depending on what you want to reset:

- **Just the database contents** (keep containers, drop/reapply schema + reseed):
  ```bash
  pnpm db:reset
  ```
- **Everything, including the Postgres/Redis containers and volumes** (rare — e.g. if a container
  got into a bad state):
  ```bash
  pnpm infra:reset
  ```

## Debugging in VS Code

No container attachment is required — both apps run on the host, so standard Node debugging
works. Config lives in `.vscode/launch.json`.

**API (NestJS):**

1. In a terminal, run `pnpm --filter @zentuva/api run dev:debug` (same as `pnpm dev` but opens
   the Node inspector on port 9229).
2. In VS Code, run the **"Attach: API (NestJS)"** launch config (Run and Debug panel, or F5).
3. Set breakpoints in `apps/api/src/**` as normal.

**Web (Next.js):**

Run the **"Debug: Web (Next.js server-side)"** launch config — it starts `pnpm dev` for the web
app itself with debugging attached, no separate terminal needed. Use **"Debug: Web (Chrome
client-side)"** for breakpoints in client components, or the **"Debug: API + Web"** compound to
debug both apps at once (requires `dev:debug` already running for the API, per above).

## Environment files

Zentuva intentionally uses a small number of environment files, each with one clear owner:

| File                                            | Read by                                                   | Why                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/.env`                                 | NestJS (`@nestjs/config`), Prisma CLI                     | NestJS's config module and the Prisma CLI both load `.env` from the app's working directory — there's no alternative filename to use here.                                                                                                                      |
| `apps/web/.env.local`                           | Next.js                                                   | Next.js auto-loads `.env.local` for local overrides, and it's gitignored by default — this is the standard Next.js convention, and the only file you need for local web dev.                                                                                    |
| `.env` (repo root)                              | `docker-compose.dev.yml`, `docker-compose.production.yml` | Optional. Only needed if you want to override the default Postgres/Redis credentials or ports — both compose files have working defaults baked in via `${VAR:-default}`, so `pnpm infra:up` works with zero setup.                                              |
| `apps/api/.env` / `apps/web/.env` (no `.local`) | `docker-compose.production.yml` only                      | The full-stack compose file uses Docker's `env_file` directive, which doesn't understand Next's `.env.local` convention — it just needs a plain `.env`. You only need this if you're running the full containerized stack, which is not the daily dev workflow. |

**In short:** for daily development you need exactly two files —
`apps/api/.env` and `apps/web/.env.local` — copied once from their `.example` counterparts. The
root `.env` and the non-`.local` app `.env` files only come into play if you run
`docker-compose.production.yml`.

## Common troubleshooting

### Port conflicts

If `pnpm infra:up` or `pnpm dev` fails to bind a port, something else on your machine is already
using it. Zentuva's default ports:

| Port   | Used by                              |
| ------ | ------------------------------------ |
| `3000` | `apps/web` (Next.js)                 |
| `4000` | `apps/api` (NestJS)                  |
| `5432` | Postgres (via `pnpm infra:up`)       |
| `5555` | Prisma Studio (via `pnpm db:studio`) |
| `6379` | Redis (via `pnpm infra:up`)          |

To find what's holding a port (macOS/Linux):

```bash
lsof -i :5432
```

Options:

- Stop the conflicting process, or
- Change the port for Zentuva. For Postgres/Redis, set `POSTGRES_PORT`/`REDIS_PORT` in a root
  `.env` (see [Environment files](#environment-files)) before running `pnpm infra:up`. For
  `apps/api`, change `PORT` in `apps/api/.env`. For `apps/web`, run `pnpm --filter @zentuva/web
run dev -- -p 3001`.

### Docker troubleshooting

**`Cannot connect to the Docker daemon`** — Docker Desktop (or your Docker daemon) isn't running.
Start it, wait for it to report "running", then retry `pnpm infra:up`.

**`pnpm infra:up` succeeds but the API can't connect to the database** — the containers may still
be starting. Check their health:

```bash
docker compose -f docker-compose.dev.yml ps
```

Both `postgres` and `redis` should show `healthy`, not `starting` or `unhealthy`. If a container
is unhealthy, check its logs:

```bash
pnpm infra:logs
```

**Everything is broken and you just want a clean slate:**

```bash
pnpm infra:down
pnpm infra:reset
pnpm db:migrate
```

**Stale Prisma client after pulling new migrations from a teammate:**

```bash
pnpm db:generate
```

**`pnpm db:migrate` fails with "environment is non-interactive"** — `prisma migrate dev` requires
a real terminal (it can prompt you for a migration name or a confirmation). Run it directly in
your terminal, not through a script, CI job, or another non-interactive wrapper. Non-interactive
contexts (CI, Docker build steps) should use `prisma migrate deploy` instead, which applies
existing migrations without prompting.

## See also

- [Getting Started](../handbook/getting-started.md) — the condensed quick-start version of this
  guide.
- [Development Workflow](../handbook/development-workflow.md) — conventions for how work gets
  done (branching, Definition of Done, documentation requirements).
- [Architecture Overview](../handbook/architecture-overview.md) — the technology stack and why.
