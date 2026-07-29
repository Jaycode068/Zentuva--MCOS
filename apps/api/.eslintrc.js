module.exports = {
  root: true,
  extends: [require.resolve('@zentuva/config/eslint/nestjs.js')],
  ignorePatterns: ['.eslintrc.js', 'jest.config.js'],
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
  ],
};
