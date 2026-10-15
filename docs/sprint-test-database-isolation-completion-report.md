# Test Database Isolation & Destructive-Operation Safety — Completion Report

**Sprint type:** Safety and infrastructure. No business feature, accounting-policy change, or
financial-record repair was made. No operational database or business record was touched.
**Trigger:** The Phase 2C Financial Integrity Review ([docs/sprint-phase-2c-financial-integrity-review.md](./sprint-phase-2c-financial-integrity-review.md))
identified that the live API, every test, and every ad-hoc script shared one PostgreSQL
instance via a superuser credential, with no enforceable test-database identity guard.
**Date:** 2026-10-13.

---

## A. Initial Database-Usage Findings (Phase A)

Before any change, the repository was inspected (read-only) to map every path that could
reach a database:

- **Operational connection path:** `apps/api/.env` → `DATABASE_URL` → read by (a) NestJS's
  `ConfigModule.forRoot()` at app bootstrap (`apps/api/src/app.module.ts`), which populates
  `process.env` for the running API's `PrismaService`, and (b) the Prisma CLI's own built-in
  `.env` loading for `prisma generate` / `migrate dev` / `db seed` / `studio`.
- **No isolated test database existed.** `jest.config.js` and `jest.integration.config.js` had
  no `DATABASE_URL` override and no `.env.test` file existed anywhere in the repo.
- **Which test types need Postgres:** only `*.integration.spec.ts` files (14 at the time of
  inspection). `jest.config.js` explicitly excludes them (`testPathIgnorePatterns`) — the
  default `pnpm test` is fully mocked and needs no database connection at all. This was
  confirmed by running the full unit suite with no `DATABASE_URL` set in the environment.
- **Commands that create/migrate/seed/reset/clean a database:** `pnpm db:migrate` (`prisma
migrate dev`), `pnpm db:seed` (`prisma db seed` → `ts-node prisma/seed.ts`), `pnpm db:reset`
  (`prisma migrate reset` — drops and recreates the schema, fully destructive), and
  `pnpm infra:reset` (`docker compose down -v` — destroys the entire Postgres/Redis Docker
  volume). Every one of these resolved, with certainty, to the single operational database,
  because no alternative `DATABASE_URL` existed anywhere.
- **Commands that could accidentally target the operational database:** all of the above, with
  100% certainty prior to this sprint — there was no other database to target.
- **A raw `ts-node`/`jest` script's `DATABASE_URL` had no deterministic source at all.** Neither
  NestJS's `ConfigModule` nor the generated Prisma Client auto-loads `.env` outside of a Nest
  bootstrap or the Prisma CLI — confirmed by inspecting the generated client for any
  `dotenv`/env-loading call (none found) and by running a bare `node -e` check with a clean
  environment. Any integration-test file that did `new PrismaClient()` directly (every one in
  this repo) depended entirely on `DATABASE_URL` already being present in the invoking shell,
  through no mechanism this review could identify or reproduce deterministically. This gap is
  exactly why the new test harness (§C–D below) loads its own env file explicitly rather than
  assuming any ambient shell state.
- **Where credentials/permissions are configured:** `apps/api/.env` (`DATABASE_URL`, superuser
  `zentuva` role — confirmed in the Phase 2C review) and `docker-compose.dev.yml`'s
  `POSTGRES_USER`/`PASSWORD`/`DB` defaults for the single `postgres` service, which bootstraps
  that user as a cluster superuser (the official Postgres image's standard behavior).
- **The implicated function:** `cleanupTestData()` in
  `apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts`. Its current
  (already-fixed, pre-sprint) form resolves exact disposable fulfilment ids first and scopes
  every `deleteMany` to them — it no longer uses the bare `sourceType`-only filter that caused
  the incident. **No automated test asserted that property** — the only regression coverage was
  the corrected query text itself, with no test proving cleanup refuses to run against the
  wrong target, as established independently by this sprint before any code was written.
- **No CI configuration exists anywhere in this repository** — no `.github/workflows`, no
  `.gitlab-ci.yml`, no equivalent. `apps/api/package.json` defines `test` and `test:integration`
  as local-only scripts.

---

## B. Chosen Isolation Architecture and Rationale (Phase B)

**A second, separate PostgreSQL _instance_** (a second Docker container, `postgres-test`, in
`docker-compose.dev.yml`, on the `test` Compose profile so it never starts with the plain
`pnpm infra:up`), not merely a second database name inside the existing instance. Rationale:
Postgres roles and authentication catalogs are per-cluster, not per-database — a role created
in one container's data directory has no entry at all in another container's `pg_roles`, so a
connection string naming the test role cannot authenticate against the operational instance
under any circumstance, independent of any application-level check. A same-instance database
would only have relied on `GRANT`/`REVOKE` correctness within one shared catalog; a separate
instance removes that entire class of misconfiguration. This directly follows the task's stated
preference for a disposable instance over same-instance separation.

Properties delivered:

- **Separate credentials:** the test role (`zentuva_test`) is distinct from the operational
  role (`zentuva`), with a different password, defined only in `scripts/db/init-test-role.sql`
  and `apps/api/.env.test(.example)`.
- **Least-privilege test role, no superuser:** `zentuva_test` is created with `NOSUPERUSER
NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION` and owns only the `zentuva_test` database.
  Verified live — see §G.
- **No test credential can access the operational database:** established architecturally, not
  by a live cross-connection attempt (the sprint's own safety rules explicitly forbid using the
  operational database for any destructive-safeguard test, even a negative one) — see §G for
  the exact reasoning and what remains unverified.
- **Explicit environment configuration:** `TEST_DATABASE_URL`, a distinct variable name from
  `DATABASE_URL`, in its own file (`apps/api/.env.test`), never merged with `apps/api/.env`.
- **Fail-closed identity checks before every destructive entry point** — see §D.
- **No silent fallback:** `requireTestDatabaseUrl()` reads only `TEST_DATABASE_URL` and throws
  if it is absent; it has no code path that reads `DATABASE_URL` at all (verified by a unit test
  that sets a conflicting `DATABASE_URL` and confirms it has no effect).
- **Documented commands:** `pnpm infra:test:up` / `infra:test:down` / `infra:test:reset`,
  `pnpm test:db:migrate`, `pnpm test:db:seed`, `pnpm test:integration` — added to
  [docs/development/local-development.md](./development/local-development.md) "Running
  integration tests safely."

**Design decisions recorded for future reference (none required a business decision to
resolve safely):**

- `inet_server_port()` was initially going to be part of the identity check but was dropped
  after live testing showed it reports the port Postgres listens on _inside_ its own container
  (always 5432 for both containers here), not the host-mapped port — it cannot distinguish the
  two instances and would have produced false rejections. Database name + role name + role
  privilege flags are the only checks used now; see §E for how this was caught before shipping.
- The disposable container's bootstrap admin role (`zentuva_test_admin`, superuser) exists only
  to let `scripts/db/init-test-role.sql` create the restricted role once; no test, script, or
  application code ever connects as it. Its password is committed in that SQL file, following
  this repo's existing convention for local-dev-only, non-real credentials (same as the seed
  admin accounts in `apps/api/.env.example`).
- A small, dependency-free `.env.test` parser (`apps/api/test/load-test-env.js`) was written
  instead of adding the `dotenv` package, to keep this sprint's dependency/lockfile footprint at
  zero — it only ever reads one variable and never touches `DATABASE_URL`.

---

## C. Files Added or Modified

**Added:**

- `scripts/db/init-test-role.sql` — one-time init script creating the restricted `zentuva_test`
  role and database ownership, run automatically by Postgres on first container creation.
- `apps/api/.env.test.example` (committed) / `apps/api/.env.test` (gitignored, created locally
  this sprint, no real secret) — the test connection string, under its own variable name.
- `apps/api/src/testing/test-db-guard.ts` — the shared fail-closed identity/privilege guard
  (pure decision logic + a real-connection wrapper).
- `apps/api/src/testing/test-db-guard.spec.ts` — 15 mocked, DB-less unit tests for the guard's
  decision logic (runs under the default `pnpm test`).
- `apps/api/src/testing/db-isolation-safety.integration.spec.ts` — 5 real-infra regression
  scenarios against the disposable database (runs under `pnpm test:integration`).
- `apps/api/test/integration-setup-files.js`, `integration-global-setup.js`,
  `integration-global-teardown.js`, `load-test-env.js` — Jest lifecycle hooks that load
  `TEST_DATABASE_URL` and verify it before any test file runs, and set `DATABASE_URL` from it
  (never from any pre-existing shell value) for the test-file process only.
- `apps/api/scripts/migrate-test-db.js`, `apps/api/scripts/seed-test-db.js` — guarded,
  non-interactive provisioning scripts for the isolated database only.

**Modified:**

- `docker-compose.dev.yml` — added the `postgres-test` service (profile `test`, port 5433,
  separate volume) and its volume declaration. The existing `postgres`/`redis` services and
  every existing default-profile behavior are unchanged.
- `apps/api/jest.integration.config.js` — wired the three lifecycle hooks above.
- `apps/api/package.json` — added `test:db:migrate`, `test:db:seed` scripts.
- `package.json` (root) — added `infra:test:up`/`down`/`reset`, `test:db:migrate`,
  `test:db:seed`, `test:integration` convenience scripts. No existing script was changed.
- `.gitignore` — added `.env.test` (ignored) and `!.env.test.example` (kept committed).
- `apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts` — added a call to
  `verifyConnectedToTestDatabase(prisma)` at the top of `cleanupTestData()` (defense-in-depth;
  the function now refuses to run at all if the connection cannot be verified as the isolated
  test database), and corrected the comment that previously asserted the Phase 2C
  reconstruction was "verified byte-identical" — the Financial Integrity Review found that claim
  inaccurate for the fields it could check and unverifiable for the rest; the comment now points
  to that review instead of repeating the claim.
- `docs/development/local-development.md` — added "Running integration tests safely" and one
  row to the Environment Files table for `apps/api/.env.test`. No other content changed.

No application business logic, schema, migration, or financial posting code was changed.

---

## D. Database and Credential Boundaries

|                             | Operational                                                               | Test                                                                                          |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Container                   | `postgres` (existing)                                                     | `postgres-test` (new, `test` profile only)                                                    |
| Port                        | 5432                                                                      | 5433                                                                                          |
| Database                    | `zentuva`                                                                 | `zentuva_test`                                                                                |
| Application/connecting role | `zentuva` (superuser — unchanged, **not** remediated this sprint, see §I) | `zentuva_test` (no superuser/createdb/createrole/bypassrls)                                   |
| Bootstrap-only role         | n/a                                                                       | `zentuva_test_admin` (superuser, used once by the init script, never by app/test/script code) |
| Env var                     | `DATABASE_URL` (`apps/api/.env`)                                          | `TEST_DATABASE_URL` (`apps/api/.env.test`)                                                    |
| Volume                      | `postgres_dev_data`                                                       | `postgres_test_data`                                                                          |

## Fail-Closed Guard (Phase D)

`apps/api/src/testing/test-db-guard.ts` provides:

- `requireTestDatabaseUrl()` — throws if `TEST_DATABASE_URL` is unset or blank. Never reads
  `DATABASE_URL`.
- `assertSafeTestIdentity(identity)` — pure function; throws unless the database name is on an
  explicit allowlist (`['zentuva_test']`), the connected role name exactly matches
  `zentuva_test`, and every one of `rolsuper`/`rolcreatedb`/`rolcreaterole`/`rolbypassrls` is
  `false`. A matching `NODE_ENV` or database-name substring is never consulted — only what the
  live role reports about itself.
- `verifyConnectedToTestDatabase(prisma)` — runs one read-only query against `pg_roles` /
  `current_database()` / `current_user` and feeds the result through the function above.

This guard is invoked at three independent points: Jest's `globalSetup` (aborts the entire run
before any test file loads), Jest's `setupFiles` (sets `DATABASE_URL` for the test-file process
only, after validating `TEST_DATABASE_URL`'s presence), and inside `cleanupTestData()` itself
(so the function refuses to run even if invoked outside its normal Jest bootstrap). The
PostgreSQL-level role restriction is the primary control; this guard is the secondary,
defense-in-depth layer, per the task's own instruction not to treat an application-level check
as a substitute for real database permission restriction.

---

## E. How to Provision and Run Tests Safely

```bash
pnpm infra:test:up                      # start the disposable Postgres (new container, port 5433)
cp apps/api/.env.test.example apps/api/.env.test   # first time only
pnpm test:db:migrate                    # apply existing migrations (guard-checked)
pnpm test:db:seed                       # optional — reference data some tests expect
pnpm test:integration                   # run the integration suite against it
```

`pnpm infra:test:down` / `infra:test:reset` manage its lifecycle independently of
`pnpm infra:up`/`infra:down`. None of this affects the operational Postgres container, its
volume, or `apps/api/.env`.

## How Destructive Commands Validate Their Targets

`migrate-test-db.js` and `seed-test-db.js` both: load `.env.test`, call
`requireTestDatabaseUrl()`, connect, and call `verifyConnectedToTestDatabase()` — only on
success do they spawn `prisma migrate deploy` / `ts-node prisma/seed.ts` with `DATABASE_URL`
set to the verified test URL for that child process alone. Jest's `globalSetup` does the same
before any `*.integration.spec.ts` file is loaded. `cleanupTestData()` does the same again,
inline, immediately before its first `deleteMany`.

---

## F. Regression Scenarios and Actual Results

All 9 scenarios from the task were addressed; results below are from this sprint's own run,
not claimed from memory.

| #   | Scenario                      | How verified                                                                                                                                                                                                                                                                                                                                                                      | Result                                                                                                                    |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correct isolated database     | Real connection to the disposable DB; read+write fixture created and found                                                                                                                                                                                                                                                                                                        | **PASS** (live, disposable infra)                                                                                         |
| 2   | Operational target rejected   | (a) Mocked `$queryRaw` returning the operational identity, decision logic only; (b) **live**, non-mocked connection to the disposable container's own elevated bootstrap-admin role (`zentuva_test_admin`) — never the operational database                                                                                                                                       | **PASS** both ways — rejected before any mutation in either case                                                          |
| 3   | Missing test URL              | Live run: temporarily removed `apps/api/.env.test` and unset any ambient `TEST_DATABASE_URL`, ran `pnpm test:integration`                                                                                                                                                                                                                                                         | **PASS** — entire run aborted in `globalSetup` before any test file loaded, with a clear message; file restored afterward |
| 4   | Conflicting configuration     | Unit test: `DATABASE_URL` set to the operational-looking string while `TEST_DATABASE_URL` is unset — `requireTestDatabaseUrl()` still throws, proving it never reads `DATABASE_URL`; mocked live-shape test for a mismatched connected identity                                                                                                                                   | **PASS**                                                                                                                  |
| 5   | Insufficient test permissions | Live, against the disposable DB only: queried `pg_roles` for the connected role (confirmed `zentuva_test`, all four privilege flags `false`) and attempted `CREATE DATABASE` as that role, expecting Postgres itself to reject it                                                                                                                                                 | **PASS** — Postgres rejected the privileged statement                                                                     |
| 6   | Test-owned cleanup            | Live, disposable DB: created an "owned" and an "unrelated" JournalEntry, ran the scoped-delete pattern, asserted only the owned one was removed                                                                                                                                                                                                                                   | **PASS**                                                                                                                  |
| 7   | Financial-record isolation    | Live, disposable DB: full before/after snapshot (including lines) of a record outside the cleanup scope, proven `toEqual` after cleanup ran                                                                                                                                                                                                                                       | **PASS**                                                                                                                  |
| 8   | Original regression           | Live, disposable DB: ran the OLD bare-`sourceType` pattern directly (fixture data only) and confirmed it would have deleted an unrelated entry; confirmed the scoped pattern does not                                                                                                                                                                                             | **PASS**                                                                                                                  |
| 9   | Script/CI coverage            | Ran the exact documented root commands (`pnpm test:db:migrate`, `pnpm test:integration`) from a clean shell and confirmed they resolve to the isolated config with no fallback. **No CI pipeline exists in this repository at all** (confirmed in Phase A) — so "CI entry points" could not be checked because there are none; this is reported as a gap, not claimed as verified | **PASS for local commands; N/A/unverified for CI (none exists)**                                                          |

Additionally: the entire pre-existing integration suite (15 files, 88 tests) was run against the
freshly provisioned isolated database. **Zero occurrences of `UnsafeTestDatabaseError` appeared
anywhere in that run** — the guard never rejected a legitimate connection across any file. 9 of
15 suites (61 of 88 tests) passed outright. The other 6 suites' failures were all pre-existing
fixture/seed-data dependencies unrelated to database isolation — e.g. a test requiring "at least
2 seeded organisations" or "at least one seeded Invoice," and the Phase 2C fulfilment test
requiring an `AccountingPeriod` that covers the literal current system date, which
`prisma/seed.ts`'s hardcoded period range does not reach. These are pre-existing business/seed
limitations, not introduced by this sprint, and — per the task's explicit instruction — were
documented rather than fixed here, since fixing them would mean changing seed/accounting logic
outside this sprint's scope.

---

## G. Evidence the Test Role Cannot Access the Operational Database

**Verified directly:** `psql` as the bootstrap admin inside the `postgres-test` container shows
`zentuva_test` with `rolsuper=f, rolcreatedb=f, rolcreaterole=f, rolbypassrls=f`, owning only the
`zentuva_test` database. The same role attempting `CREATE DATABASE` against its own (disposable)
instance was rejected by Postgres itself.

**Verified architecturally, not by a live cross-connection attempt:** this sprint's own safety
rules explicitly prohibit using the operational database to test destructive-operation
safeguards, even as a negative test, and prohibit executing any test against it. A live
"does `zentuva_test` fail to authenticate against the operational container" check was
therefore deliberately not attempted. Instead: PostgreSQL roles and authentication catalogs are
per-cluster. `zentuva_test` was created only inside `postgres-test`'s own data directory, via
`scripts/db/init-test-role.sql`'s one-time init. It has no row at all in the operational
container's `pg_roles` — there is no connection string, correct or not, that could make it
authenticate there, independent of any password or network reachability. **This is a structural
fact about how Postgres role catalogs work, not something this sprint tested live, and the
report states that distinction rather than claiming an end-to-end connection test was run.**

## Confirmation: Separate Instance, Not Just a Separate Database

A separate Docker container (`postgres-test`), separate port (5433), separate named volume
(`postgres_test_data`), separate image instance from `postgres` — not a second database created
inside the existing `postgres` container. Confirmed via `docker inspect`/`docker compose ps`
during this sprint's own verification.

---

## H. Residual Risks and Unverified Controls

- **The operational `zentuva` role remains a PostgreSQL superuser.** This sprint did not change
  it — doing so without separate authorization risked interrupting the live dev API mid-sprint,
  per the task's own instruction to prepare such a change as a separate rollout step rather than
  apply it here. This is the single largest remaining gap relative to the sprint's own stated
  target architecture ("least-privilege test database role" was delivered for the _test_ side
  only).
- **No CI pipeline exists**, so none of this sprint's guards are enforced on every push/PR —
  only when a developer runs the commands locally. Scenario 9 could only be verified for local
  commands as a result.
- **Both Postgres containers currently run on the same Docker host/daemon** and the same Compose
  network namespace. Isolation here rests on separate per-cluster role catalogs (see §G), not on
  network segmentation — a user with direct Docker exec access to the host could still reach
  either container manually. This is unchanged from the pre-sprint state and was out of scope.
- **6 of 15 pre-existing integration spec files cannot be run to a full pass against a freshly
  provisioned isolated database today**, due to pre-existing fixture/seed-data assumptions
  unrelated to isolation (§F). This sprint's own new tests, and the specific file containing the
  originally implicated cleanup function, were verified not to fail due to any guard/isolation
  defect — only due to these separate, pre-existing gaps, which are left for separate
  remediation per the task's own instruction.
- **The bootstrap admin credential (`zentuva_test_admin`) is committed in plaintext** in
  `scripts/db/init-test-role.sql`. This follows the repository's existing convention for
  non-real, local-dev-only credentials (identical in spirit to the seed admin accounts already
  committed in `apps/api/.env.example`) but is recorded here for completeness.
- **No dedicated test exists proving the guard is actually wired into _every_ current and future
  destructive dev script** — it is wired into the two provisioning scripts and the one
  previously-implicated cleanup function added this sprint; a future script that forgets to call
  it would not be caught by anything automatic.

## Operational Credential Migration — Outstanding

Restricting the operational `zentuva` role's privileges (or introducing a separate
least-privilege operational role) remains outstanding and was deliberately not attempted in this
sprint. It requires a separately authorized rollout plan, since changing it live could interrupt
the running dev API, per the task's explicit instruction.

---

## Test Results, Typecheck, Lint, Build

- `pnpm run type-check` (apps/api): **pass**, no errors.
- `pnpm run lint` (apps/api): **pass** — 0 errors; 27 pre-existing warnings in unrelated files
  (`@typescript-eslint/no-explicit-any` in finance/budgeting spec files), none introduced by
  this sprint; the one warning this sprint's own new file produced was fixed before this report.
- `pnpm run build` (apps/api, `nest build`): **pass**, no errors.
- `pnpm run test` (apps/api, DB-less unit suite): **270 suites / 2545 tests, all pass** —
  confirms the default suite remains fully DB-less and unaffected.
- `pnpm run test -- test-db-guard` (new guard unit tests): **15/15 pass**, no database
  connection involved.
- `pnpm run test:integration` (full suite, against the newly provisioned isolated database):
  **9/15 suites, 61/88 tests pass**; the remaining 6 suites fail for the pre-existing,
  unrelated reasons documented in §F/§H — zero guard-related failures anywhere in the run.
- `pnpm run test:integration -- db-isolation-safety` (this sprint's new real-infra scenarios):
  **5/5 pass**.

---

## Final Git Status

Working tree before this sprint (preserved, untouched): the pre-existing untracked `.claude/`
directory and `docs/sprint-phase-2c-financial-integrity-review.md` (the prior review report).

After this sprint:

```
 M .gitignore
 M apps/api/jest.integration.config.js
 M apps/api/package.json
 M apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts
 M docker-compose.dev.yml
 M docs/development/local-development.md
 M package.json
?? .claude/                                                  (pre-existing, unrelated, untouched)
?? apps/api/.env.test.example
?? apps/api/scripts/
?? apps/api/src/testing/
?? apps/api/test/
?? docs/sprint-phase-2c-financial-integrity-review.md         (pre-existing, unrelated, untouched)
?? scripts/
```

`apps/api/.env.test` (the real, local, non-secret test connection file) exists on disk but is
correctly excluded from `git status` by the `.gitignore` change in this same sprint.

Nothing was staged, committed, or pushed. No destructive git command was run.
