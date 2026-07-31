# Database Documentation

Documents the Prisma schema (`apps/api/prisma/schema.prisma`) and every model, grouped by domain.

## Current state

**Identity Domain** (Sprint 1B.1) — implemented exactly per the approved design in
[`docs/domains/identity.md` §9](../domains/identity.md#9-prisma-design). 11 models, 3 enums:

| Model                | Table                   | Tenant-scoped?                                       |
| -------------------- | ----------------------- | ---------------------------------------------------- |
| `Organisation`       | `organisations`         | — (this _is_ the tenant boundary)                    |
| `User`               | `users`                 | Yes (`organisationId`)                               |
| `Role`               | `roles`                 | Yes (`organisationId`)                               |
| `Permission`         | `permissions`           | No — the one genuinely global table (identity.md §7) |
| `UserRole`           | `user_roles`            | Yes (`organisationId`, denormalised)                 |
| `RolePermission`     | `role_permissions`      | Indirectly, via `Role`                               |
| `Invitation`         | `invitations`           | Yes (`organisationId`)                               |
| `Session`            | `sessions`              | Yes (`organisationId`, denormalised)                 |
| `RefreshToken`       | `refresh_tokens`        | Indirectly, via `Session`                            |
| `PasswordResetToken` | `password_reset_tokens` | Indirectly, via `User`                               |
| `AuditLog`           | `audit_logs`            | Yes, nullable (`organisationId`)                     |

The old placeholder `HealthCheck` model has been removed — with 11 real models present, Prisma no
longer needs a placeholder to generate a client. `GET /api/health` is unaffected; it verifies
connectivity with a raw `SELECT 1`, not a model query.

`User` also carries `failedLoginAttempts` (`Int`, default `0`), added in Sprint 1B.2 to drive
automatic account locking — see [identity.md §4](../domains/identity.md#user).

`Organisation` also carries `displayName` (`String?`), added in Sprint 2.1 for the
Organisation Profile feature — see [identity.md §3](../domains/identity.md#organisation-profile).

Authentication (login, JWT, refresh rotation, logout, password reset, invitation acceptance,
account locking) is implemented as of Sprint 1B.2. Sprint 2.1 added the Organisation Profile
API (`GET`/`PATCH /api/organisation/me`) and Sprint 2.2 added the User Management API
(`GET`/`POST /api/users`, `GET`/`PATCH /api/users/:id`), both behind the same minimal
role-name authorization check (`RolesGuard`) — full RBAC evaluation (the
`Permission`/`RolePermission` engine in identity.md §6) and Invitations/Role Management
still don't exist. See
[`docs/sprint-1B.1-completion-report.md`](../sprint-1B.1-completion-report.md),
[`docs/sprint-1B.2-completion-report.md`](../sprint-1B.2-completion-report.md),
[`docs/sprint-2.1-completion-report.md`](../sprint-2.1-completion-report.md), and
[`docs/sprint-2.2-completion-report.md`](../sprint-2.2-completion-report.md) for exactly what
was and wasn't implemented in each sprint.

### Migrations

| Migration                                       | What it did                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `20260728195709_init`                           | Created the placeholder `_health_check` table (Sprint 0)                     |
| `20260729182400_init_identity_domain`           | Dropped `_health_check`; created all 11 Identity Domain tables (Sprint 1B.1) |
| `20260730173455_add_user_failed_login_attempts` | Added `User.failedLoginAttempts` for account locking (Sprint 1B.2)           |
| `20260730180000_add_organisation_display_name`  | Added `Organisation.displayName` for the Organisation Profile (Sprint 2.1)   |

### Seed data

`apps/api/prisma/seed.ts` (`pnpm db:seed`) seeds the "Boby Bites" pilot organisation, its
three system roles (Owner, Administrator, Member), the full Identity permission catalog, and
one development account per system role (the Administrator and Member accounts added
Sprint 2.2 — see [local-development.md](../development/local-development.md) for the
predictable credentials). Every account's email/password come from required environment
variables (`SEED_ADMIN_*`, `SEED_ADMINISTRATOR_*`, `SEED_MEMBER_*` — see
`apps/api/.env.example`); the script fails loudly if they're not set rather than falling back
to a hardcoded credential.

## Conventions for when models are added

- Every tenant-scoped model must include an `organisationId` field (see
  [ADR-003](../adr/ADR-003-multi-tenancy.md) and
  [identity.md §7](../domains/identity.md#7-tenant-isolation-strategy)).
- Document each new model here: its purpose, fields, relations, and indexes.
- Record schema migrations in [`docs/changelog.md`](../changelog.md) when they are user-facing or
  significant.
