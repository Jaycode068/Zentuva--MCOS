/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // Sprint 37.1 — `.integration.spec.ts` files need a real, running Postgres database
  // (genuine concurrency tests against `inventory-stock-concurrency.util.ts` can't be
  // proven any other way — a mock has no real row locks to race against). Excluded from
  // the default, fully-mocked, DB-less suite `pnpm test` runs everywhere; run explicitly
  // with `pnpm run test:integration` against a real dev database. See
  // `jest.integration.config.js`.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
