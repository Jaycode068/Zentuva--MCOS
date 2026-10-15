module.exports = {
  root: true,
  extends: [require.resolve('@zentuva/config/eslint/nestjs.js')],
  ignorePatterns: ['.eslintrc.js', 'jest.config.js', 'jest.integration.config.js'],
  overrides: [
    {
      // tsconfig.json's rootDir is ./src, so type-aware linting can't apply to
      // files outside it (e.g. prisma/seed.ts, run standalone via ts-node).
      // Lint them with syntax-only rules instead of excluding them entirely.
      files: ['prisma/**/*.ts'],
      parserOptions: {
        project: null,
      },
    },
    {
      // Same reasoning as the prisma override above, for the plain-JS guarded
      // DB scripts and Jest integration-test setup/teardown files — also
      // outside ./src and never part of the type-aware tsconfig.json project.
      // These are genuine CommonJS scripts (run directly via `node`, never
      // compiled), so `no-require-imports` — a TypeScript-module-system rule
      // — does not apply to them either.
      files: ['scripts/**/*.js', 'test/**/*.js'],
      parserOptions: {
        project: null,
      },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
