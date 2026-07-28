/** Root ESLint config — applies to files outside app/package scopes (e.g. root scripts). */
module.exports = {
  root: true,
  extends: ['./packages/config/eslint/base.js'],
  ignorePatterns: ['apps/**', 'packages/**', 'node_modules', '.turbo'],
};
