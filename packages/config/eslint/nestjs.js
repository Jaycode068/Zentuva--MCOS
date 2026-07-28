/** Shared ESLint rules for Zentuva NestJS services. */
module.exports = {
  extends: ['./base.js'],
  parserOptions: {
    project: true,
    tsconfigRootDir: process.cwd(),
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
