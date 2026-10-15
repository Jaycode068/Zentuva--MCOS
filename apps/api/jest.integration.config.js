/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  // Real concurrency tests take longer than a mocked unit test — several hundred
  // milliseconds of actual Postgres round trips per `Promise.all` batch, not
  // microseconds of in-memory Map access.
  testTimeout: 30_000,
  // Test Database Isolation & Destructive-Operation Safety sprint (see
  // docs/sprint-test-database-isolation-completion-report.md): every integration test must
  // run against the isolated, disposable test Postgres instance, never the operational
  // database — both hooks below fail the whole run closed if that cannot be verified.
  // globalSetup runs once, in a separate process, before any test file loads, and
  // performs the real connection/role-privilege check. setupFiles runs in the SAME
  // process as each test file (which is why DATABASE_URL is actually *set* there, not in
  // globalSetup — see apps/api/test/integration-setup-files.js for why).
  globalSetup: '<rootDir>/test/integration-global-setup.js',
  globalTeardown: '<rootDir>/test/integration-global-teardown.js',
  setupFiles: ['<rootDir>/test/integration-setup-files.js'],
};
