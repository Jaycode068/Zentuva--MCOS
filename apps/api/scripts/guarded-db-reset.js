#!/usr/bin/env node
// Guarded wrapper for `prisma migrate reset` — the most destructive development
// command (drops and recreates the entire schema). Verifies connection identity AND
// requires explicit, specific confirmation before proceeding — typing "yes" is not
// enough; the resolved database name itself must be typed (or supplied via
// CONFIRM_DB_RESET for non-interactive use), so an operator cannot blindly confirm
// without having actually looked at what they're about to reset.
// See docs/sprint-stage-3a-database-safety-hardening-preflight.md.
const { spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const {
  assertDevelopmentDatabaseReady,
  UnsafeDevelopmentDatabaseError,
} = require('./db-guard-common');
require('ts-node/register/transpile-only');
const { extractHost, buildGuardedSubprocessEnv } = require('../src/prisma/db-identity-guard');

function promptConfirmation(expectedDatabase) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `\nThis will DROP and RECREATE the schema of database "${expectedDatabase}". ` +
        `Type the database name ("${expectedDatabase}") to confirm, or anything else to abort: `,
      (answer) => {
        rl.close();
        resolve(answer.trim() === expectedDatabase);
      },
    );
  });
}

async function main() {
  let url;
  try {
    url = await assertDevelopmentDatabaseReady();
  } catch (err) {
    console.error(
      '\n[db-identity-guard] Refusing to reset — the configured DATABASE_URL does not ' +
        'verifiably point at the designated development database (or it could not be ' +
        `reached).\n\n${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const host = extractHost(url);
  const database = new URL(url).pathname.replace(/^\//, '');
  console.log(
    `[db-identity-guard] Identity verified — host="${host}" database="${database}" (role verified separately).`,
  );

  const nonInteractiveConfirmation = process.env.CONFIRM_DB_RESET;
  const confirmed =
    nonInteractiveConfirmation !== undefined
      ? nonInteractiveConfirmation === database
      : await promptConfirmation(database);

  if (!confirmed) {
    console.error('\nConfirmation did not match. Aborting — nothing was reset.');
    process.exitCode = 1;
    return;
  }

  console.log('[db-identity-guard] Confirmed — running `prisma migrate reset`.');
  const result = spawnSync('npx', ['prisma', 'migrate', 'reset'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: buildGuardedSubprocessEnv(url),
  });
  process.exitCode = result.status ?? 1;
}

main().catch((err) => {
  if (err instanceof UnsafeDevelopmentDatabaseError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
