-- Runs exactly once, automatically, the first time the `postgres-test` container's data
-- volume is created (Postgres only executes /docker-entrypoint-initdb.d/* on an empty data
-- directory). It runs as the container's bootstrap superuser (TEST_POSTGRES_ADMIN_USER) and
-- creates a SEPARATE, deliberately unprivileged role that the application, integration
-- tests, and the test-database guard actually connect as.
--
-- This is the "least-privilege test database role; no superuser privileges" requirement from
-- docs/sprint-test-database-isolation-completion-report.md — the bootstrap admin role exists
-- only to run this script once and is never used by any test, script, or application code.
--
-- Local-dev-only credential, not a real secret (same convention as the seed admin accounts
-- documented in apps/api/.env.example).
CREATE ROLE zentuva_test LOGIN PASSWORD 'local-dev-only-not-a-real-password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

GRANT ALL PRIVILEGES ON DATABASE zentuva_test TO zentuva_test;
ALTER DATABASE zentuva_test OWNER TO zentuva_test;
