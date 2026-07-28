module.exports = {
  root: true,
  extends: [require.resolve('@zentuva/config/eslint/nestjs.js')],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ['.eslintrc.js', 'jest.config.js'],
};
