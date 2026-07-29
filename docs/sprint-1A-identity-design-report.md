# Sprint 1A Completion Report — Identity Domain Design

**Sprint:** 1A — Identity Domain Design
**Date:** 2026-07-29
**Scope:** Design and documentation only. No API, frontend, authentication logic, or migrations
were implemented — per the Sprint 1A brief.

## Summary

The full Identity Domain design is documented in
[`docs/domains/identity.md`](domains/identity.md): domain overview, business rules, the
Organisation Registration/Profile split, all ten entities (Organisation, User, Role, Permission,
UserRole, RolePermission, Invitation, Session, RefreshToken, PasswordResetToken, AuditLog),
authentication and authorisation design, tenant isolation strategy, audit strategy, a validated
Prisma schema, an API contract sketch, six sequence diagrams, and a risks/future-expansion table.
This is the domain every other module (Product Catalogue, Procurement, Inventory, Production,
Sales, Distribution, Finance) will depend on for "who is this, and are they allowed to do this."

The one piece of implementation performed was validating the draft Prisma schema
(`prisma validate` / `prisma format`) against a scratch file — **not** written into
`apps/api/prisma/schema.prisma`. This confirms the schema in the design doc is syntactically and
relationally sound (all relations resolve, no naming conflicts) before Sprint 1B implements it for
real, per the brief's "no migrations unless needed to validate the design" allowance.

## Design decisions made

1. **Tenant = Organisation, 1:1, no separate Tenant entity.** The architectural "tenant" concept
   from [ADR-003](adr/ADR-003-multi-tenancy.md) and the business "Organisation" concept are the
   same row. Simpler than modeling a Tenant → Organisation hierarchy that nothing currently needs.

2. **Users belong to exactly one Organisation in MVP** (`User.organisationId`, not a join table),
   but **`User.email` is globally unique** rather than unique-per-organisation. This is the
   single most consequential forward-compatibility decision in the design: it costs nothing now
   and is what makes a future migration to true multi-organisation membership (§12 of the domain
   doc) additive rather than requiring a data-deduplication pass across existing emails.

3. **`Owner` bypasses the permission-grant table entirely** rather than being seeded with every
   permission explicitly. The alternative (explicitly granting Owner every permission) creates an
   ongoing maintenance burden — every future domain's developer would need to remember to also
   grant their new permissions to Owner, and this will eventually be forgotten. Treating "has the
   Owner role" as an automatic authorization pass removes that failure mode structurally.

4. **Flat RBAC, no role inheritance.** Simpler to reason about and audit ("what can this role do"
   is one query) at the cost of some duplication across similar custom roles. Explicitly flagged
   as a candidate future enhancement rather than built speculatively now.

5. **Denormalised `organisationId` on `UserRole` and `Session`**, even though both are derivable
   via a join (through `Role` and `User` respectively). This trades a small amount of write-time
   redundancy for making every tenant-scoped table directly, uniformly filterable by
   `organisationId` — which is what the recommended Prisma Client Extension isolation layer
   (domain doc §7) depends on to be simple and uniform rather than needing per-table special
   cases.

6. **`RefreshToken` is a separate entity from `Session`, with an explicit rotation chain
   (`replacedByTokenId`).** This is what makes refresh-token-reuse detection possible (a stolen,
   already-rotated token being replayed is detectable and triggers revoking the whole session) —
   a meaningfully stronger security posture than a single long-lived refresh token per session,
   for one extra table.

7. **`PasswordResetToken` kept separate from `Invitation`**, despite both being "prove you own
   this email" tokens. Their side effects differ enough (invitation creates a User; reset only
   changes a password) that a shared entity would need conditional branching that makes both flows
   harder to reason about — judged not worth the row-count savings.

8. **Permission registered as the one genuinely global (non-tenant-scoped) table.** Every other
   table in the domain carries `organisationId`; `Permission` deliberately doesn't, because it
   represents the platform's capability catalog (contributed by every domain as it's built), not
   per-organisation data.

9. **Organisation Registration is deliberately minimal** (6 fields, per the brief's
   recommendation) with everything else deferred to an optional Organisation Profile filled in
   post-signup — prioritising time-to-first-value over collecting complete data upfront.

## Assumptions

- **Argon2id for password hashing**, over bcrypt — no legacy system to match, and argon2id is the
  current general recommendation for new systems. Not validated against any Zentuva-specific
  requirement; worth confirming there's no constraint (e.g. a compliance requirement) pointing
  elsewhere before Sprint 1B.
- **JWT access tokens are not stored server-side** (stateless, verified by signature); only
  `Session`/`RefreshToken` rows are persisted. Assumes short-lived access tokens (implementation
  detail for Sprint 1B — a lifetime wasn't specified in the brief, and isn't fixed in the design
  doc beyond "short-lived").
- **No platform-admin approval step for new Organisations** — registration is fully self-service.
  Assumed from the brief's "who can create organisations?" phrasing and the minimal registration
  form it specifies; flagged as an open question below in case that assumption is wrong.
- **Organisations are never hard-deleted**, only status-transitioned to `CLOSED` — assumed from
  general audit/legal-retention good practice, not stated explicitly in the brief.
- **DigitalOcean Spaces for logo storage** — assumed from the existing
  [architecture overview](handbook/architecture-overview.md)'s storage decision; no upload flow is
  designed here (that's frontend/Sprint 1B+ scope), only that `Organisation.logoUrl` stores a URL.

## Open questions

1. **Should Organisation registration require email verification before the org becomes `ACTIVE`
   (vs. `PENDING`)?** The domain doc's Organisation lifecycle (§4) implies verification gates
   `PENDING → ACTIVE`, but the brief doesn't specify this, and the registration sequence diagram
   (§11) doesn't include a verification step. Needs a product decision before Sprint 1B.
2. **What should the JWT access token lifetime and refresh token lifetime actually be?** The
   design says "short-lived" / "long-lived" deliberately without committing to numbers — this is
   a security/UX tradeoff (shorter = safer, more re-auth friction) that should be a conscious
   product decision, not an implementation default chosen incidentally.
3. **Does `Admin` need any restriction beyond "cannot touch the `Owner` role"?** E.g. can an Admin
   remove another Admin? Can an Admin see the audit log entries of the Owner? The domain doc grants
   Admin fairly broad user/role/audit-log permissions (§6, §10); worth a deliberate review of
   exactly which `identity.*` permissions Admin gets by default versus which are Owner-only.
4. **Is a single Organisation `Address` (§3) sufficient, or does Boby Bites already have multiple
   physical locations that Sprint 1B's Organisation Profile needs to account for?** The design
   defers multi-location to "future" (§3), which may need revisiting if it's actually near-term.
5. **Should failed-login audit events for unknown emails be rate-limited/throttled at the API
   layer?** Not part of this domain's data model, but worth flagging now since `AuditLog` will
   record every attempt (§8) and a brute-force/enumeration attempt would otherwise generate
   unbounded rows.

## Recommendations before implementation (Sprint 1B)

1. **Implement the Prisma Client Extension for tenant isolation first**, before any domain
   controller/service code, so every subsequent piece of Identity (and later, every other domain)
   is built on top of the automatic scoping rather than retrofitted onto it.
2. **Add the cross-tenant-isolation test helper** described in the domain doc (§7) as part of the
   Identity implementation itself, not deferred — it's cheap to write once and should become the
   standard pattern every future domain's tests reuse.
3. **Resolve the open questions above** (especially #1 and #2) before writing code — they affect
   the shape of the registration flow and token issuance, which are foundational enough that
   getting them wrong means revisiting already-written code rather than an unwritten design.
4. **Update [`packages/types/src/tenant.ts`](../packages/types/src/tenant.ts)'s `TenantContext`**
   to align field names with the finalized schema (e.g. confirm `tenantId` ↔ `Organisation.id`,
   `tenantSlug` ↔ `Organisation.slug`) as part of Sprint 1B, since that shared type currently
   predates this design and was written before Identity's shape was known.
5. **Register Identity's own permissions (§6 of the domain doc) as a seed/migration step**, not
   ad-hoc — since every future domain will follow the same "register permissions into the shared
   catalog" pattern, Identity's implementation should establish that pattern cleanly as the first
   example.
6. **Keep `docs/domains/identity.md` in sync as Sprint 1B implements it** — per
   [Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles), if
   implementation reveals the design needs to change, update the design doc in the same PR, don't
   let them drift apart.
