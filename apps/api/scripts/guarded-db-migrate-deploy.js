#!/usr/bin/env node
// Guarded wrapper for `prisma migrate deploy` — the NON-interactive, NON-resetting
// migration-application command, used specifically for reconstructing a fresh
// development database from existing migrations (Stage 3B.1). Deliberately NOT
// `prisma migrate dev` (interactive; can prompt to reset the schema on detected drift)
// — the brief for this stage explicitly requires a workflow that cannot trigger an
// automatic reset or interactive drift recovery. `guarded-db-migrate.js` (which does use
// `migrate dev`) remains the correct script for routine day-to-day schema development.
const { spawnSync } = require('child_process');
const path = require('path');
const { assertDevelopmentDatabaseReady } = require('./db-guard-common');
require('ts-node/register/transpile-only');
const { buildGuardedSubprocessEnv } = require('../src/prisma/db-identity-guard');

async function main() {
  let url;
  try {
    url = await assertDevelopmentDatabaseReady();
  } catch (err) {
    console.error(
      '\n[db-identity-guard] Refusing to deploy migrations — the configured DATABASE_URL ' +
        'does not verifiably point at the designated development database (or it could ' +
        `not be reached).\n\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '[db-identity-guard] Identity verified — running `prisma migrate deploy` (non-resetting) against the development database.',
  );
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: buildGuardedSubprocessEnv(url),
  });
  process.exitCode = result.status ?? 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
