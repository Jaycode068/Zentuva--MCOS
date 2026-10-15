/**
 * Fail-closed identity guard for commands that affect the DEVELOPMENT database
 * (`db:reset`, `db:migrate`, `db:seed`, `db:studio`) — the counterpart to
 * `apps/api/src/testing/test-db-guard.ts`, which protects the isolated test database.
 *
 * Context: before this guard existed, every `db:*` script connected to whatever
 * `DATABASE_URL` happened to resolve to (the value in `apps/api/.env`, or — because
 * dotenv never overwrites an already-set variable — a stale value left in the invoking
 * shell from an earlier, unrelated command) with no verification at all. `db:reset` in
 * particular (`prisma migrate reset`) would drop and recreate the schema of whatever
 * that turned out to be. This guard requires the connection to positively identify
 * itself as the designated development database before any of those scripts proceed.
 *
 * Classification is based on what the SERVER reports about the live connection
 * (`current_database()`, `current_user`, `pg_roles` privilege flags) plus the hostname
 * actually present in the resolved connection string — never on the fact that an
 * environment variable happens to be named `DATABASE_URL`, and never on `NODE_ENV`.
 *
 * Honest limitation, stated plainly rather than overclaimed: Zentuva has no deployed
 * production environment yet, and `docker-compose.production.yml` currently defaults to
 * the SAME role/database names (`zentuva`/`zentuva`) as local development. This guard
 * cannot distinguish "the designated local development database" from "a hypothetical
 * future production deployment that reused the same names" by name alone — no
 * production-specific naming convention exists in this codebase to check against yet.
 * Host + database + role + privilege-signature together (see below) are the strongest
 * check available with today's naming conventions; none of them can yet produce a
 * uniquely trusted "this is definitely dev, not some other same-named environment"
 * guarantee on their own. Requiring the host to be a recognized local address is a
 * real, meaningful backstop against the actual future danger (a real remote production
 * host) even though it cannot yet separately recognize "local dev" from "a theoretical
 * local-only production instance." This is not a substitute for the production-credential
 * separation already proposed (and intentionally not yet implemented) in the Operational
 * Database Privilege Hardening work this incident interrupted.
 *
 * Environment-loading discovery (Stage 3B.1): requiring `@prisma/client` has the side
 * effect of auto-loading `apps/api/.env` into `process.env` — but ONLY for variables not
 * already set (verified empirically: an already-exported `DATABASE_URL` is left
 * untouched). The real Prisma CLI subprocess behaves the same way (confirmed by running
 * `prisma migrate status` with an explicit, deliberately-fake `DATABASE_URL` and
 * observing it attempt that exact fake address, not `.env`'s real one). This means the
 * guard's captured value is exactly what both the verification step and the spawned
 * Prisma subprocess will use — see `buildGuardedSubprocessEnv` below, which is the one
 * place that property is enforced and unit-tested, rather than re-implemented per
 * wrapper script.
 */

export type DatabaseEnvironmentClassification = 'development' | 'test' | 'unknown';

export const EXPECTED_DEVELOPMENT_DATABASE = 'zentuva';
export const EXPECTED_DEVELOPMENT_ROLE = 'zentuva';
export const RECOGNIZED_LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

/** Database/role names that belong to the isolated test environment, never development. */
const TEST_DATABASE_NAMES = ['zentuva_test'] as const;
const TEST_ROLE_NAMES = ['zentuva_test', 'zentuva_test_app', 'zentuva_test_admin'] as const;

export class UnsafeDevelopmentDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDevelopmentDatabaseError';
  }
}

/**
 * Requires an explicitly configured DATABASE_URL (whether set in the shell or
 * auto-loaded from apps/api/.env by requiring @prisma/client — see the module comment
 * above). Reads ONLY `DATABASE_URL`: an unrelated `TEST_DATABASE_URL` being ALSO present
 * in the environment at the same time (e.g. left over from a prior `pnpm
 * test:integration` run in the same shell) has no bearing on this function's result —
 * there is no code path here that reads it, so "contradictory" test/dev configuration
 * present simultaneously cannot influence which value a development command uses.
 */
export function requireDevelopmentDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new UnsafeDevelopmentDatabaseError(
      'DATABASE_URL is not set. Refusing to proceed — copy apps/api/.env.example to apps/api/.env first.',
    );
  }
  return url;
}

export interface DbConnectionIdentity {
  /** Hostname parsed from the resolved connection string, not server-reported. */
  host: string;
  database: string;
  user: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
}

/**
 * The development role's KNOWN, EXPECTED privilege signature today — `zentuva` is a
 * Postgres bootstrap-created superuser (unchanged, not yet hardened; see the completion
 * report's residual-risk section). This is not a restriction ("dev must not be
 * superuser") — it is an additional identity signal: a role that is merely NAMED
 * `zentuva`/`zentuva` but does NOT carry this exact signature is not actually the known
 * development role, and that mismatch itself is worth surfacing rather than ignoring.
 * Update this alongside EXPECTED_DEVELOPMENT_ROLE if the role is ever hardened.
 */
export const EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES = {
  rolsuper: true,
  rolcreatedb: true,
  rolcreaterole: true,
} as const;

/** Parses only the hostname out of a Postgres connection URL. Never logs or returns the rest. */
export function extractHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new UnsafeDevelopmentDatabaseError(
      'DATABASE_URL could not be parsed as a URL — refusing to proceed.',
    );
  }
}

function looksLikeTestIdentity(identity: Pick<DbConnectionIdentity, 'database' | 'user'>): boolean {
  return (
    TEST_DATABASE_NAMES.includes(identity.database as (typeof TEST_DATABASE_NAMES)[number]) ||
    TEST_ROLE_NAMES.includes(identity.user as (typeof TEST_ROLE_NAMES)[number])
  );
}

/**
 * Pure, synchronous classification — no I/O. Given what a connection reports about
 * itself, is it the designated development database, the isolated test database (which
 * a development command must never touch), or neither?
 */
export function classifyDatabaseIdentity(
  identity: DbConnectionIdentity,
): DatabaseEnvironmentClassification {
  if (looksLikeTestIdentity(identity)) {
    return 'test';
  }
  if (
    identity.database === EXPECTED_DEVELOPMENT_DATABASE &&
    identity.user === EXPECTED_DEVELOPMENT_ROLE
  ) {
    return 'development';
  }
  return 'unknown';
}

/**
 * Pure decision function for development-targeted commands. Throws unless the
 * connection positively identifies as the designated development database: a
 * recognized local host, the expected database name, the expected role name, AND the
 * expected (known-superuser) privilege signature for that role — see
 * `EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES` for why checking privileges here is an
 * identity signal, not a restriction.
 */
export function assertSafeDevelopmentTarget(identity: DbConnectionIdentity): void {
  const problems: string[] = [];

  if (!RECOGNIZED_LOCAL_HOSTS.includes(identity.host as (typeof RECOGNIZED_LOCAL_HOSTS)[number])) {
    problems.push(
      `host "${identity.host}" is not a recognized local-development host (${RECOGNIZED_LOCAL_HOSTS.join(', ')}) — refusing to treat a non-local host as the development database`,
    );
  }

  if (looksLikeTestIdentity(identity)) {
    problems.push(
      `connected database/role ("${identity.database}"/"${identity.user}") matches the ISOLATED TEST environment, not development — a development-targeted command must never run against it`,
    );
  } else {
    if (identity.database !== EXPECTED_DEVELOPMENT_DATABASE) {
      problems.push(
        `connected database "${identity.database}" does not match the expected development database "${EXPECTED_DEVELOPMENT_DATABASE}"`,
      );
    }
    if (identity.user !== EXPECTED_DEVELOPMENT_ROLE) {
      problems.push(
        `connected role "${identity.user}" does not match the expected development role "${EXPECTED_DEVELOPMENT_ROLE}"`,
      );
    }
    if (
      identity.rolsuper !== EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolsuper ||
      identity.rolcreatedb !== EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolcreatedb ||
      identity.rolcreaterole !== EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolcreaterole
    ) {
      problems.push(
        `connected role "${identity.user}" has privilege flags (rolsuper=${identity.rolsuper}, rolcreatedb=${identity.rolcreatedb}, ` +
          `rolcreaterole=${identity.rolcreaterole}) that do not match the known development role's expected signature ` +
          `(rolsuper=${EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolsuper}, rolcreatedb=${EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolcreatedb}, ` +
          `rolcreaterole=${EXPECTED_DEVELOPMENT_ROLE_PRIVILEGES.rolcreaterole}) — this may not be the genuine development role`,
      );
    }
  }

  if (problems.length > 0) {
    throw new UnsafeDevelopmentDatabaseError(
      `Refusing to proceed: this connection does not verifiably look like the designated development database.\n- ${problems.join('\n- ')}`,
    );
  }
}

interface QueryRawCapable {
  $queryRaw<T>(query: unknown): Promise<T>;
}

/**
 * Connects (read-only query) and verifies the live identity of whatever `prisma` is
 * currently connected to, combined with the hostname from the connection string it was
 * constructed with, then runs it through `assertSafeDevelopmentTarget`.
 */
export async function verifyConnectedToDevelopmentDatabase(
  prisma: QueryRawCapable,
  databaseUrl: string,
): Promise<void> {
  const host = extractHost(databaseUrl);

  const rows = await prisma.$queryRaw<
    {
      current_database: string;
      current_user: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }[]
  >`
    SELECT current_database() AS current_database,
           current_user AS current_user,
           r.rolsuper,
           r.rolcreatedb,
           r.rolcreaterole,
           r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `;

  const row = rows[0];
  if (!row) {
    throw new UnsafeDevelopmentDatabaseError(
      'Could not resolve the connected role identity from pg_roles — refusing to proceed.',
    );
  }

  assertSafeDevelopmentTarget({
    host,
    database: row.current_database,
    user: row.current_user,
    rolsuper: row.rolsuper,
    rolcreatedb: row.rolcreatedb,
    rolcreaterole: row.rolcreaterole,
    rolbypassrls: row.rolbypassrls,
  });
}

/**
 * The ONE place that builds the environment a guarded wrapper passes to its spawned
 * Prisma subprocess. Every `apps/api/scripts/guarded-db-*.js` wrapper calls this instead
 * of inlining `{ ...process.env, DATABASE_URL: url }` itself, so the "the subprocess
 * gets EXACTLY the validated string, never anything re-read from the environment in
 * between" property has exactly one implementation and is unit-tested directly
 * (db-identity-guard.spec.ts), rather than trusted by convention across five scripts.
 */
export function buildGuardedSubprocessEnv(
  validatedDatabaseUrl: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...baseEnv, DATABASE_URL: validatedDatabaseUrl };
}
