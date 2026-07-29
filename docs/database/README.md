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

No API, authentication, or authorization logic reads/writes these tables yet — see
[`docs/sprint-1B.1-completion-report.md`](../sprint-1B.1-completion-report.md) for exactly what
was and wasn't implemented this sprint.

### Migrations

| Migration                             | What it did                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `20260728195709_init`                 | Created the placeholder `_health_check` table (Sprint 0)                     |
| `20260729182400_init_identity_domain` | Dropped `_health_check`; created all 11 Identity Domain tables (Sprint 1B.1) |

### Seed data

`apps/api/prisma/seed.ts` (`pnpm db:seed`) seeds the "Boby Bites" pilot organisation, its three
system roles (Owner, Administrator, Member), the full Identity permission catalog, and the
organisation's first (Owner) user. Admin email/password come from required environment variables
(`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` — see `apps/api/.env.example`); the script fails loudly
if they're not set rather than falling back to a hardcoded credential.

## Conventions for when models are added

- Every tenant-scoped model must include an `organisationId` field (see
  [ADR-003](../adr/ADR-003-multi-tenancy.md) and
  [identity.md §7](../domains/identity.md#7-tenant-isolation-strategy)).
- Document each new model here: its purpose, fields, relations, and indexes.
- Record schema migrations in [`docs/changelog.md`](../changelog.md) when they are user-facing or
  significant.
