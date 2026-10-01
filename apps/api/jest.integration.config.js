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
};
