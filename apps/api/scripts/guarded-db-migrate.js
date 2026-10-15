#!/usr/bin/env node
// Guarded wrapper for `prisma migrate dev` against the DEVELOPMENT database. Verifies
// connection identity (apps/api/src/prisma/db-identity-guard.ts) before running any DDL.
// See docs/sprint-stage-3a-database-safety-hardening-preflight.md.
const { spawnSync } = require('child_process');
const path = require('path');
require('ts-node/register/transpile-only');
const { assertDevelopmentDatabaseReady } = require('./db-guard-common');
const { buildGuardedSubprocessEnv } = require('../src/prisma/db-identity-guard');

async function main() {
  let url;
  try {
    url = await assertDevelopmentDatabaseReady();
  } catch (err) {
    console.error(
      '\n[db-identity-guard] Refusing to run `prisma migrate dev` — the configured ' +
        'DATABASE_URL does not verifiably point at the designated development database ' +
        `(or it could not be reached).\n\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '[db-identity-guard] Identity verified — running migrations against the development database.',
  );
  const result = spawnSync('npx', ['prisma', 'migrate', 'dev'], {
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
