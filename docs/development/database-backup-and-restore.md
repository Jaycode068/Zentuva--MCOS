# Development Database Backup and Restore

Procedure for backing up the local development PostgreSQL database and verifying a
restore, established and proven in Stage 4A.1 of the post-incident recovery work (see
[docs/sprint-test-database-isolation-completion-report.md](../sprint-test-database-isolation-completion-report.md)
for the incident this exists to protect against — a Compose teardown command that
deleted the operational database with no backup available at the time).

This document covers the development database only. It does not apply to the isolated
test database (`zentuva-dev-test`, disposable by design — see
[local-development.md](./local-development.md) "Running integration tests safely") or to
any future production environment, which will need its own, separately authorized backup
policy before going live.

## Database backup vs. source-code backup — these are different things

- **Source-code backup** = your Git history, plus anything uncommitted. Protected by
  committing and pushing normally; a separate filesystem copy (like
  `Zentuva--MCOS-SAFE-COPY-*`, created during this incident's recovery) is only a
  stop-gap when work is uncommitted.
- **Database backup** (this document) = the actual _data_ inside PostgreSQL —
  organisations, users, products, journal entries, everything seeded or entered through
  the app. Git does not and cannot capture this; the `.sql`/`.dump` file described below
  is the only thing that does. Losing the database and having perfect source code still
  means losing every record that was ever created — they are independent risks and need
  independent backups.

## Creating a backup

Run `pg_dump` **inside the running Postgres container** — never on the host — so no
credential ever needs to appear in a host-level command or shell history. Write to the
container's `/tmp` first (ephemeral, NOT the mounted data volume), then copy it out:

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME="zentuva-dev-${TIMESTAMP}.dump"

docker exec zentuva-dev-postgres-1 pg_dump -U zentuva -d zentuva -Fc -f "/tmp/${FILENAME}"
docker cp "zentuva-dev-postgres-1:/tmp/${FILENAME}" "/Users/user/Zentuva--MCOS-backups/${FILENAME}"
docker exec zentuva-dev-postgres-1 rm "/tmp/${FILENAME}"
```

- `-Fc` (custom format): compressed, and the only format `pg_restore` can selectively
  inspect/filter — always use it over plain-SQL dumps for this purpose.
- Backups live in `/Users/user/Zentuva--MCOS-backups/` — a sibling directory to the repo,
  **not inside it** (never committed, never confused with source control) and **not
  inside any Docker-managed volume** (so an `infra:reset`/`infra:test:reset` or volume
  removal can never also destroy your backups).
- The filename always carries a timestamp. Never overwrite an existing backup file —
  each run produces a new one.

## Verifying backup integrity

Two checks, both read-only, neither touches any database:

```bash
# 1. Checksum — record this alongside the backup for later tamper/corruption detection.
shasum -a 256 "/Users/user/Zentuva--MCOS-backups/${FILENAME}" > "/Users/user/Zentuva--MCOS-backups/${FILENAME}.sha256"

# 2. Structural check — lists every object the archive contains without connecting to
#    any database. pg_restore isn't installed on the host; run it inside any Postgres
#    16 container (e.g. by copying the file in temporarily, as below).
docker cp "/Users/user/Zentuva--MCOS-backups/${FILENAME}" "zentuva-dev-postgres-1:/tmp/${FILENAME}"
docker exec zentuva-dev-postgres-1 pg_restore --list "/tmp/${FILENAME}"
docker exec zentuva-dev-postgres-1 rm "/tmp/${FILENAME}"
```

A healthy archive's `--list` header reports the source `dbname`, a `TOC Entries` count in
the thousands (one per table/type/constraint/etc.), and `Format: CUSTOM`.

## Restoring into an isolated database — never over development or test

**Never run `pg_restore` against `zentuva-dev-postgres-1` or
`zentuva-dev-test-postgres-test-1`.** Always restore into a disposable target with its
own container, its own port, and its own named volume that doesn't share a prefix with
either:

```bash
docker run -d \
  --name zentuva-restore-verify \
  -e POSTGRES_USER=restore_verify_admin \
  -e POSTGRES_PASSWORD=<local-only-password> \
  -e POSTGRES_DB=zentuva_restore_verify \
  -p 5435:5432 \
  -v zentuva_restore_verify_data:/var/lib/postgresql/data \
  postgres:16-alpine

docker cp "/Users/user/Zentuva--MCOS-backups/${FILENAME}" "zentuva-restore-verify:/tmp/${FILENAME}"
docker exec zentuva-restore-verify pg_restore -U restore_verify_admin -d zentuva_restore_verify \
  --no-owner --role=restore_verify_admin "/tmp/${FILENAME}"
docker exec zentuva-restore-verify rm "/tmp/${FILENAME}"
```

This container is deliberately **not** part of either `docker-compose.dev.yml` or
`docker-compose.test.yml` — a plain `docker run`, not a Compose service — so it carries no
`com.docker.compose.project` label matching either project and can never be affected by
`pnpm infra:up/down/reset` or `pnpm infra:test:up/down/reset`, in either direction.

**How to avoid accidentally restoring over development or production:** the port
(`5435`, distinct from dev's `5432` and test's `5433`), the volume name
(`zentuva_restore_verify_data`, sharing no prefix with `zentuva-dev_*` or
`zentuva-dev-test_*`), and the database name (`zentuva_restore_verify`, not `zentuva`)
are all deliberately different from every existing environment. Before restoring,
confirm the target you're about to run `pg_restore` against by checking its container
name and `docker inspect ... --format '{{index .Config.Labels "com.docker.compose.project"}}'`
— if it returns `zentuva-dev` or `zentuva-dev-test`, stop; that is a real database, not a
disposable target.

## After verifying

The verified backup stays in `/Users/user/Zentuva--MCOS-backups/`. The disposable
`zentuva-restore-verify` container/volume can be torn down once no longer needed
(`docker rm -f zentuva-restore-verify && docker volume rm zentuva_restore_verify_data`)
— since it shares no project or volume prefix with development or test, removing it
cannot affect either.

## Recommended cadence (not yet automated)

This document describes a manual, on-demand procedure, proven once. Scheduling it (e.g.
before any risky infrastructure change, or periodically) and retention policy are not
yet decided — treat this as the starting point for that decision, not a substitute for
it.
