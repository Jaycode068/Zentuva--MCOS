#!/usr/bin/env node
// Seeds the ISOLATED TEST database only — never the operational one. Needed because
// several pre-existing *.integration.spec.ts files assume the "Boby Bites" reference
// data that `pnpm db:seed` creates (same assumption they had when they ran against the
// single shared database, before this sprint). Same guard-then-act shape as
// migrate-test-db.js: verifies identity before running anything that writes data.
require('ts-node/register/transpile-only');
const { spawnSync } = require('child_process');
const path = require('path');

const { PrismaClient } = require('@prisma/client');
const { loadTestEnvFile } = require('../test/load-test-env');
const {
  requireTestDatabaseUrl,
  verifyConnectedToTestDatabase,
  UnsafeTestDatabaseError,
} = require('../src/testing/test-db-guard');

async function main() {
  loadTestEnvFile();
  const url = requireTestDatabaseUrl();

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await verifyConnectedToTestDatabase(prisma);
  } catch (err) {
    console.error(
      '\n[seed-test-db] Refusing to seed — the configured TEST_DATABASE_URL does not ' +
        'verifiably point at the isolated test database.\n\n' +
        (err instanceof Error ? err.message : String(err)) +
        '\n',
    );
    process.exitCode = 1;
    return;
  } finally {
    await prisma.$disconnect();
  }

  console.log('[seed-test-db] Identity verified — seeding the isolated test database.');
  const result = spawnSync('npx', ['ts-node', 'prisma/seed.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  process.exitCode = result.status ?? 1;
}

main().catch((err) => {
  if (err instanceof UnsafeTestDatabaseError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
