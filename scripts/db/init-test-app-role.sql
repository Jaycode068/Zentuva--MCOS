-- Runs once, automatically, alongside init-test-role.sql on first creation of the
-- `postgres-test` container's data volume. Creates the role used in disposable
-- verification to model the PROPOSED PRODUCTION "runtime application role" design from
-- docs/sprint-operational-database-privilege-hardening-completion-report.md — deliberately
-- narrower than `zentuva_test` (which owns the whole `zentuva_test` database and stands in
-- for the migration/administrative role in this simulation, the same way the operational
-- `zentuva` role currently both owns the schema and is used by the live API).
--
-- This script ONLY creates the role. It is granted NOTHING here — DML privileges (and
-- default privileges for future tables) are granted separately, by
-- apps/api/scripts/provision-app-role.js, AFTER migrations have created the tables to grant
-- on. That mirrors the real production sequence: the runtime role must exist and be
-- grantable before, but is only usefully privileged after, the schema exists.
--
-- Local-dev-only credential, not a real secret — same convention as init-test-role.sql.
CREATE ROLE zentuva_test_app LOGIN PASSWORD 'local-dev-only-not-a-real-password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
