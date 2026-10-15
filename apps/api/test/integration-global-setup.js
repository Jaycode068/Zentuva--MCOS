// Jest `globalSetup` for jest.integration.config.js — runs ONCE, in a separate process,
// before any test file is loaded. Its job is to abort the ENTIRE integration run before a
// single test executes if the real, live connection does not verifiably look like the
// isolated test database (real role lookup against pg_roles, not just a URL string).
//
// This is in addition to, not instead of, the lighter-weight check in
// integration-setup-files.js (which only validates TEST_DATABASE_URL is present and runs
// per test file) — this one actually connects and checks privilege flags for real.
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { loadTestEnvFile } = require('./load-test-env');
const {
  requireTestDatabaseUrl,
  verifyConnectedToTestDatabase,
} = require('../src/testing/test-db-guard');

module.exports = async function globalSetup() {
  loadTestEnvFile();
  const url = requireTestDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await verifyConnectedToTestDatabase(prisma);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '\n[test-db-guard] Integration test run ABORTED before any test executed — the ' +
        'configured TEST_DATABASE_URL does not verifiably point at the isolated test ' +
        `database.\n\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    throw err;
  } finally {
    await prisma.$disconnect();
  }
};
