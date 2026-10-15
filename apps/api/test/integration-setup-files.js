// Jest `setupFiles` entry for jest.integration.config.js.
//
// `setupFiles` run in the SAME process/realm as the test file that follows them, which is
// why DATABASE_URL is set HERE and not in globalSetup (globalSetup runs in a separate
// process and its process.env mutations never reach the test files). `*.integration.spec.ts`
// files construct `new PrismaClient()` directly, which reads `process.env.DATABASE_URL` at
// construction time — this must already be the verified test URL by then.
//
// Plain CommonJS + ts-node/register (not a `.ts` file run through Jest's own transform)
// so this loads identically regardless of how Jest handles transforms for lifecycle files.
require('ts-node/register/transpile-only');
const { loadTestEnvFile } = require('./load-test-env');
const { requireTestDatabaseUrl } = require('../src/testing/test-db-guard');

// Fills in TEST_DATABASE_URL from apps/api/.env.test if it isn't already set in the
// environment (e.g. by a shell export or CI) — see load-test-env.js.
loadTestEnvFile();

// Throws loudly if TEST_DATABASE_URL is still missing — never falls back to any existing
// DATABASE_URL value a developer's shell might already have set.
process.env.DATABASE_URL = requireTestDatabaseUrl();
