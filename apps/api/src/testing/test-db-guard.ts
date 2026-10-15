/**
 * Shared fail-closed guard against running destructive operations (integration test
 * cleanup, fixture seeding, future dev scripts) against anything other than the isolated,
 * disposable test Postgres instance — see docs/sprint-test-database-isolation-completion-report.md.
 *
 * Deliberately split into two layers so each can be tested appropriately:
 *  - `assertSafeTestIdentity` / `requireTestDatabaseUrl` are pure, synchronous, no I/O —
 *    unit-testable with plain mocked inputs (src/testing/test-db-guard.spec.ts).
 *  - `verifyConnectedToTestDatabase` performs the real connection/role lookup and is only
 *    exercised against the real disposable test database in integration tests.
 *
 * This guard is a secondary, defense-in-depth layer. The PRIMARY enforcement is that the
 * `zentuva_test` role (scripts/db/init-test-role.sql) has no privilege outside its own
 * database and cannot authenticate against the operational Postgres instance at all —
 * this guard exists to fail loudly and early if that primary control is ever
 * misconfigured, not to replace it.
 *
 * Deliberately does NOT check `inet_server_port()` — that reports the port Postgres
 * listens on INSIDE its own container (always 5432 for both the operational and test
 * containers here), not the host-mapped port from the connection string. It cannot
 * distinguish the two instances and was dropped after it produced a false rejection
 * against the genuinely correct test connection during this sprint's own verification.
 */

export const ALLOWED_TEST_DATABASES = ['zentuva_test'] as const;
export const EXPECTED_TEST_ROLE = 'zentuva_test';

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

export interface ConnectionIdentity {
  database: string;
  user: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
}

/**
 * Requires an explicitly configured TEST_DATABASE_URL. Never reads DATABASE_URL as a
 * fallback — a missing test config must fail, not silently reuse the operational URL.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new UnsafeTestDatabaseError(
      'TEST_DATABASE_URL is not set. Refusing to proceed, and NOT falling back to ' +
        'DATABASE_URL (the operational database). Copy apps/api/.env.test.example to ' +
        'apps/api/.env.test and start the isolated test database with `pnpm infra:test:up`.',
    );
  }
  return url;
}

/**
 * Pure decision function: given what the connection actually reports about itself, does
 * it look like the isolated test database? Checks database name, connected role name, and
 * every privilege flag that would make the role dangerous — never trusts a database-name
 * substring, an env var label, or NODE_ENV alone. An incorrect or conflicting environment
 * variable cannot bypass this: it only looks at what the server itself reports for the
 * active connection.
 */
export function assertSafeTestIdentity(identity: ConnectionIdentity): void {
  const problems: string[] = [];

  if (
    !ALLOWED_TEST_DATABASES.includes(identity.database as (typeof ALLOWED_TEST_DATABASES)[number])
  ) {
    problems.push(
      `connected database "${identity.database}" is not in the allowed test-database list (${ALLOWED_TEST_DATABASES.join(', ')})`,
    );
  }

  if (identity.user !== EXPECTED_TEST_ROLE) {
    problems.push(
      `connected role "${identity.user}" is not the expected restricted test role "${EXPECTED_TEST_ROLE}"`,
    );
  }

  if (
    identity.rolsuper ||
    identity.rolcreatedb ||
    identity.rolcreaterole ||
    identity.rolbypassrls
  ) {
    problems.push(
      `connected role "${identity.user}" has elevated privileges (rolsuper=${identity.rolsuper}, ` +
        `rolcreatedb=${identity.rolcreatedb}, rolcreaterole=${identity.rolcreaterole}, ` +
        `rolbypassrls=${identity.rolbypassrls}) — a test role must have none of these`,
    );
  }

  if (problems.length > 0) {
    throw new UnsafeTestDatabaseError(
      `Refusing to proceed: this connection does not look like the isolated test database.\n- ${problems.join('\n- ')}`,
    );
  }
}

interface QueryRawCapable {
  $queryRaw<T>(query: unknown): Promise<T>;
}

/**
 * Connects (read-only query) and verifies the live identity/privilege of whatever
 * `prisma` is currently connected to, then runs it through `assertSafeTestIdentity`.
 * Throws before the caller can issue any destructive statement if anything is off.
 */
export async function verifyConnectedToTestDatabase(prisma: QueryRawCapable): Promise<void> {
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
    throw new UnsafeTestDatabaseError(
      'Could not resolve the connected role identity from pg_roles — refusing to proceed.',
    );
  }

  assertSafeTestIdentity({
    database: row.current_database,
    user: row.current_user,
    rolsuper: row.rolsuper,
    rolcreatedb: row.rolcreatedb,
    rolcreaterole: row.rolcreaterole,
    rolbypassrls: row.rolbypassrls,
  });
}
