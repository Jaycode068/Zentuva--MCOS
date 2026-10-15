#!/usr/bin/env node
// Applies existing Prisma migrations to the ISOLATED TEST database only — never the
// operational one. Deliberately `prisma migrate deploy` (applies existing migration
// files non-interactively), not `prisma migrate dev` (which can prompt for a migration
// name and is meant for the operational dev database only, via `pnpm db:migrate`).
//
// Verifies the connection identity BEFORE running any DDL — fails closed, with no
// fallback to DATABASE_URL, exactly like every other destructive entry point introduced
// in this sprint. See docs/sprint-test-database-isolation-completion-report.md.
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
      '\n[migrate-test-db] Refusing to run migrations — the configured TEST_DATABASE_URL ' +
        'does not verifiably point at the isolated test database.\n\n' +
        (err instanceof Error ? err.message : String(err)) +
        '\n\nIs `pnpm infra:test:up` running? Does apps/api/.env.test exist (copy it from ' +
        '.env.test.example)?\n',
    );
    process.exitCode = 1;
    return;
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    '[migrate-test-db] Identity verified — applying migrations to the isolated test database.',
  );
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
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
